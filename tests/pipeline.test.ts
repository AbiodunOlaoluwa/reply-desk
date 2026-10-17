import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/lib/db";
import { disclosureText } from "@/lib/facts";
import { scriptedModel } from "@/lib/model/scripted";
import { approveDecision, handBack, handleWebhook, operatorSend } from "@/lib/pipeline";
import { sendMessage } from "@/lib/send";
import { updateSettings } from "@/lib/settings";
import { sign } from "@/lib/signature";

const SECRET = "test-secret";
let db: Db;
let n = 0;

function payload(text: string, from = "+15550100101", id = `msg_${++n}`) {
  return JSON.stringify({ id, from, text });
}
const deliver = (raw: string, secret = SECRET) => handleWebhook(db, raw, sign(raw, secret), SECRET, scriptedModel);
const outbound = async (contact = "kemi") =>
  db.query<{ actor: string; body: string }>("select actor, body from messages where contact_id = $1 and direction = 'out' and actor <> 'automation' order by id", [contact]);
const decisions = async (contact = "kemi") =>
  db.query<{ id: number; status: string; attempts: unknown }>("select id, status, attempts from decisions where contact_id = $1 order by id", [contact]);

beforeEach(async () => {
  db = await createMemoryDb();
});

describe("webhook", () => {
  it("rejects a forged signature and stores nothing", async () => {
    const res = await deliver(payload("hi"), "wrong-secret");
    expect(res.status).toBe(401);
    const [{ c }] = await db.query<{ c: number }>("select count(*)::int as c from messages where direction = 'in'");
    expect(c).toBe(0);
  });

  it("processes a redelivered message exactly once", async () => {
    const raw = payload("hi");
    await deliver(raw);
    const again = await deliver(raw);
    expect(again.body).toEqual({ duplicate: true });
    const [{ c }] = await db.query<{ c: number }>("select count(*)::int as c from messages where direction = 'in'");
    expect(c).toBe(1);
    expect(await outbound()).toHaveLength(1);
  });

  it("ignores numbers that aren't in the CRM", async () => {
    const res = await deliver(payload("hi", "+15550199999"));
    expect(res.body).toEqual({ ignored: "unknown sender" });
  });
});

describe("decisions", () => {
  it("replies to a greeting with the link", async () => {
    await deliver(payload("Hi"));
    const [d] = await decisions();
    expect(d.status).toBe("SENT");
    expect((await outbound())[0].body).toContain("https://tallyhouse.example");
  });

  it("catches an invented price and sends the rewrite", async () => {
    await deliver(payload("How much does it cost?"));
    const [d] = await decisions();
    expect(d.status).toBe("SENT");
    const attempts = (typeof d.attempts === "string" ? JSON.parse(d.attempts) : d.attempts) as { checks: { id: string; ok: boolean }[] }[];
    expect(attempts).toHaveLength(2);
    expect(attempts[0].checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(expect.arrayContaining(["money_from_facts", "no_promises"]));
    expect((await outbound())[0].body).toContain("$29");
    expect((await outbound())[0].body).not.toContain("$19");
  });

  it("answers the bot question with fixed text and hands over", async () => {
    await deliver(payload("Am I talking to a bot?"));
    const [d] = await decisions();
    expect(d.status).toBe("HANDOVER");
    expect((await outbound())[0].body).toBe(disclosureText);
    // The assistant now stays quiet in this conversation.
    await deliver(payload("hello?"));
    const all = await decisions();
    expect(all[1].status).toBe("SKIPPED");
    expect(await outbound()).toHaveLength(1);
  });

  it("treats an office visit as a handover, not an opt-out", async () => {
    await deliver(payload("Can you stop by our office on Tuesday?"));
    expect((await decisions())[0].status).toBe("HANDOVER");
    const [c] = await db.query<{ opted_out_at: string | null }>("select opted_out_at from contacts where id = 'kemi'");
    expect(c.opted_out_at).toBeNull();
  });

  it("hands a call request to a person without replying", async () => {
    await deliver(payload("Can we talk tomorrow at 10?"));
    expect((await decisions())[0].status).toBe("HANDOVER");
    expect(await outbound()).toHaveLength(0);
  });

  it("says nothing when they owe the next move", async () => {
    await deliver(payload("Noted, I'll have a look later today"));
    expect((await decisions())[0].status).toBe("WAITING");
    expect(await outbound()).toHaveLength(0);
  });

  it("holds low-confidence drafts for approval, and approval sends once", async () => {
    await deliver(payload("Is this related to the tender we discussed?"));
    const [d] = await decisions();
    expect(d.status).toBe("HELD");
    const [row] = await db.query<{ reason: string }>("select reason from decisions where id = $1", [d.id]);
    expect(row.reason).toMatch(/^Low confidence/);
    expect(await outbound()).toHaveLength(0);
    await approveDecision(db, d.id, "Not that one, but happy to explain what we do: https://tallyhouse.example");
    await approveDecision(db, d.id);
    expect(await outbound()).toHaveLength(1);
  });

  it("does not reply to automatic greetings", async () => {
    await deliver(payload("Thank you for contacting Brightpath Studio! How may we help you?"));
    expect((await decisions())[0].status).toBe("SKIPPED");
  });
});

describe("rails", () => {
  it("saves an opt-out first, then blocks every sender, people included", async () => {
    await deliver(payload("stop"));
    expect((await decisions())[0].status).toBe("OPTED_OUT");
    expect((await sendMessage(db, { contactId: "kemi", body: "one more thing", actor: "ai", dedupeKey: "x1" })).status).toBe("BLOCKED");
    expect((await operatorSend(db, "kemi", "sorry, one more thing")).status).toBe("BLOCKED");
    expect(await outbound()).toHaveLength(0);
  });

  it("the kill switch stops automated sends but not a person", async () => {
    await updateSettings(db, { sendingEnabled: false });
    await deliver(payload("Hi"));
    expect((await decisions())[0].status).toBe("BLOCKED");
    expect((await operatorSend(db, "kemi", "Hello from Ada")).status).toBe("SENT");
  });

  it("dry run checks everything and sends nothing", async () => {
    await updateSettings(db, { dryRun: true });
    await deliver(payload("Hi"));
    expect((await decisions())[0].status).toBe("DRY_RUN");
    expect(await outbound()).toHaveLength(0);
  });

  it("respects the daily cap", async () => {
    await updateSettings(db, { dailyCap: 3 }); // the three seeded openers already used it
    await deliver(payload("Hi"));
    expect((await decisions())[0].status).toBe("BLOCKED");
  });

  it("a retried send with the same key goes out once", async () => {
    const a = await sendMessage(db, { contactId: "tom", body: "hello", actor: "ai", dedupeKey: "same" });
    const b = await sendMessage(db, { contactId: "tom", body: "hello", actor: "ai", dedupeKey: "same" });
    expect([a.status, b.status]).toEqual(["SENT", "DUPLICATE"]);
  });

  it("handing back lets the assistant reply again", async () => {
    await deliver(payload("Can we talk tomorrow?"));
    await handBack(db, "kemi");
    await deliver(payload("Hi again"));
    expect((await decisions())[1].status).toBe("SENT");
  });
});
