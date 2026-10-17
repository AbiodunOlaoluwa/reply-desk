// The only way a message leaves. Every rail lives here, so no caller can skip one.
import type { Db } from "./db";
import { logEvent } from "./events";
import { getSettings } from "./settings";

export type SendActor = "ai" | "automation" | "operator";
export type SendResult =
  | { status: "SENT"; messageId: number }
  | { status: "DRY_RUN" }
  | { status: "DUPLICATE" }
  | { status: "BLOCKED"; reason: "opted_out" | "kill_switch" | "daily_cap" | "unknown_contact" };

export async function sendMessage(
  db: Db,
  m: { contactId: string; body: string; actor: SendActor; dedupeKey: string; decisionId?: number },
): Promise<SendResult> {
  const [contact] = await db.query<{ opted_out_at: string | null }>("select opted_out_at from contacts where id = $1", [m.contactId]);
  const log = (tone: "ok" | "blocked" | "held" | "info", summary: string, detail: unknown = {}) =>
    logEvent(db, { contactId: m.contactId, decisionId: m.decisionId, kind: "send", tone, summary, detail: { actor: m.actor, ...(detail as object) } });

  if (!contact) {
    await log("blocked", "Send blocked: the number isn't in the CRM.");
    return { status: "BLOCKED", reason: "unknown_contact" };
  }
  // Opt-out binds everyone, people included.
  if (contact.opted_out_at) {
    await log("blocked", "Send blocked: this person opted out.");
    return { status: "BLOCKED", reason: "opted_out" };
  }

  const settings = await getSettings(db);
  if (m.actor !== "operator") {
    if (!settings.sendingEnabled) {
      await log("blocked", "Send blocked: the kill switch is off.");
      return { status: "BLOCKED", reason: "kill_switch" };
    }
    const [{ n }] = await db.query<{ n: number }>(
      "select count(*)::int as n from messages where direction = 'out' and actor in ('ai', 'automation') and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'",
    );
    if (n >= settings.dailyCap) {
      await log("blocked", `Send blocked: today's cap of ${settings.dailyCap} is used up.`);
      return { status: "BLOCKED", reason: "daily_cap" };
    }
    if (settings.dryRun) {
      await log("held", "Dry run: every check passed, nothing was sent.", { body: m.body });
      return { status: "DRY_RUN" };
    }
  }

  // The dedupe key makes a retried step a no-op instead of a second message.
  const rows = await db.query<{ id: number }>(
    "insert into messages (contact_id, direction, actor, body, dedupe_key) values ($1, 'out', $2, $3, $4) on conflict (dedupe_key) do nothing returning id",
    [m.contactId, m.actor, m.body, m.dedupeKey],
  );
  if (rows.length === 0) {
    await log("info", "Already sent once under this key. Nothing sent twice.", { dedupeKey: m.dedupeKey });
    return { status: "DUPLICATE" };
  }
  await log("ok", m.actor === "operator" ? "Sent by the operator." : "Sent.", { messageId: rows[0].id });
  return { status: "SENT", messageId: Number(rows[0].id) };
}
