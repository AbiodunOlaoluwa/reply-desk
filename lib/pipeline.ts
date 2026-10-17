import { z } from "zod";
import type { Db } from "./db";
import { logEvent } from "./events";
import { disclosureText } from "./facts";
import type { Draft, ReplyModel, Turn, Usage } from "./model/types";
import { isAutoGreeting, isOptOut } from "./optout";
import { sendMessage } from "./send";
import { getSettings } from "./settings";
import { verify } from "./signature";
import { type Check, failed, validateReply } from "./validate";

export type Status = "PENDING" | "SENT" | "HELD" | "HANDOVER" | "WAITING" | "SKIPPED" | "BLOCKED" | "DRY_RUN" | "OPTED_OUT" | "APPROVED" | "DISCARDED";

const Inbound = z.object({
  id: z.string().min(1).max(200),
  from: z.string().min(5).max(20),
  text: z.string().min(1).max(1000),
  timestamp: z.number().optional(),
});

type ContactRow = { id: string; name: string; company: string; opted_out_at: string | null; operator_owned: boolean };
type MessageRow = { id: number; direction: "in" | "out"; actor: string; body: string; dedupe_key: string | null };

// ---------------------------------------------------------------- webhook

export async function handleWebhook(db: Db, rawBody: string, signature: string | null, secret: string | undefined, model: ReplyModel) {
  // 1. Signature first, over the raw bytes, before the body is trusted for anything.
  if (!verify(rawBody, signature, secret)) {
    await logEvent(db, { kind: "webhook.rejected", tone: "blocked", summary: "Signature didn't match. Rejected before the body was read." });
    return { status: 401 as const, body: { error: "invalid signature" } };
  }
  const parsed = Inbound.safeParse(safeJson(rawBody));
  if (!parsed.success) {
    await logEvent(db, { kind: "webhook.invalid", tone: "blocked", summary: "Signed, but not a message we understand. Ignored." });
    return { status: 400 as const, body: { error: "invalid payload" } };
  }
  const msg = parsed.data;

  const [contact] = await db.query<ContactRow>("select * from contacts where phone = $1", [msg.from]);
  if (!contact) {
    await logEvent(db, { kind: "webhook.unknown", tone: "held", summary: "Message from a number that isn't in the CRM. Nobody replies automatically." });
    return { status: 200 as const, body: { ignored: "unknown sender" } };
  }

  // 2. Exactly once: the provider's message id is unique, so a redelivery inserts nothing.
  const inserted = await db.query<{ id: number }>(
    "insert into messages (contact_id, direction, actor, body, provider_message_id) values ($1, 'in', 'prospect', $2, $3) on conflict (provider_message_id) do nothing returning id",
    [contact.id, msg.text, msg.id],
  );
  if (inserted.length === 0) {
    const [existing] = await db.query<{ id: number }>("select id from messages where provider_message_id = $1", [msg.id]);
    await logEvent(db, {
      contactId: contact.id,
      messageId: existing?.id,
      kind: "webhook.duplicate",
      tone: "info",
      summary: "The provider delivered this message again. Already stored, so it was ignored: no second reply.",
      detail: { providerMessageId: msg.id },
    });
    return { status: 200 as const, body: { duplicate: true } };
  }
  const messageId = Number(inserted[0].id);
  await logEvent(db, {
    contactId: contact.id,
    messageId,
    kind: "webhook.received",
    tone: "ok",
    summary: "Signature verified. Message stored once.",
    detail: { providerMessageId: msg.id },
  });

  // 3. Opt-out is saved before anything else happens.
  if (isOptOut(msg.text)) {
    await db.query("update contacts set opted_out_at = coalesce(opted_out_at, now()) where id = $1", [contact.id]);
    const [d] = await db.query<{ id: number }>(
      "insert into decisions (contact_id, trigger_message_id, status, reason) values ($1, $2, 'OPTED_OUT', $3) on conflict do nothing returning id",
      [contact.id, messageId, "They asked us to stop."],
    );
    await logEvent(db, {
      contactId: contact.id,
      messageId,
      decisionId: d?.id,
      kind: "optout",
      tone: "blocked",
      summary: "Opt-out saved first. Nothing can message them again, automated or not.",
    });
    return { status: 200 as const, body: { optedOut: true } };
  }

  const decision = await considerInbound(db, contact.id, messageId, model);
  return { status: 200 as const, body: { decision } };
}

// ---------------------------------------------------------------- deciding on one inbound message

export async function considerInbound(db: Db, contactId: string, messageId: number, model: ReplyModel) {
  // Claim: one decision per inbound message, even if two workers race.
  const claim = await db.query<{ id: number }>(
    "insert into decisions (contact_id, trigger_message_id, status) values ($1, $2, 'PENDING') on conflict (trigger_message_id) do nothing returning id",
    [contactId, messageId],
  );
  if (claim.length === 0) return { status: "SKIPPED" as Status, reason: "Already decided." };
  const decisionId = Number(claim[0].id);
  const log = (tone: "ok" | "held" | "blocked" | "info", kind: string, summary: string, detail?: unknown) =>
    logEvent(db, { contactId, messageId, decisionId, kind, tone, summary, detail });

  const [contact] = await db.query<ContactRow>("select * from contacts where id = $1", [contactId]);
  const settings = await getSettings(db);
  const convo = await db.query<MessageRow>("select id, direction, actor, body, dedupe_key from messages where contact_id = $1 order by id", [contactId]);
  const inbound = convo.find((m) => Number(m.id) === messageId)!;

  const finish = async (status: Status, fields: Partial<{ stage: string; intent: string; confidence: number; reply: string; reason: string; followUpDays: number | null; attempts: unknown[]; model: string; usage: Usage }>) => {
    const u = fields.usage;
    await db.query(
      `update decisions set status = $2, stage = $3, intent = $4, confidence = $5, reply = $6, reason = $7, follow_up_days = $8,
         attempts = $9, model = $10, input_tokens = $11, output_tokens = $12, cache_read_tokens = $13, cost_micros = $14, updated_at = now()
       where id = $1`,
      [
        decisionId,
        status,
        fields.stage ?? null,
        fields.intent ?? null,
        fields.confidence ?? null,
        fields.reply ?? null,
        fields.reason ?? null,
        fields.followUpDays ?? null,
        JSON.stringify(fields.attempts ?? []),
        fields.model ?? null,
        (u?.inputTokens ?? 0) + (u?.cacheReadTokens ?? 0) + (u?.cacheWriteTokens ?? 0),
        u?.outputTokens ?? 0,
        u?.cacheReadTokens ?? 0,
        u?.costMicros ?? 0,
      ],
    );
    return { status, decisionId, reason: fields.reason };
  };

  // Preflight: reasons to stay quiet before spending anything on the model.
  if (contact.operator_owned) {
    await log("info", "preflight", "A person is handling this conversation, so the assistant stays quiet.");
    return finish("SKIPPED", { reason: "Operator owns this conversation." });
  }
  if (isAutoGreeting(inbound.body)) {
    await log("info", "preflight", "Automatic business greeting. No reply; the follow-up schedule takes care of it.");
    return finish("SKIPPED", { reason: "Automatic greeting." });
  }
  const budget = Number(process.env.REPLY_DESK_DAILY_BUDGET_USD ?? "0");
  if (budget > 0 && model.name !== "scripted") {
    const [{ spent }] = await db.query<{ spent: string }>(
      "select coalesce(sum(cost_micros), 0) as spent from decisions where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'",
    );
    if (Number(spent) / 1e6 >= budget) {
      await log("held", "budget", `Today's AI budget of $${budget.toFixed(2)} is used up. Waiting for a person.`);
      return finish("HELD", { reason: "Daily AI budget reached." });
    }
  }

  const opener = convo.find((m) => m.actor === "automation")?.body ?? "";
  const priorOut = convo.filter((m) => m.direction === "out" && Number(m.id) < messageId);
  const history: Turn[] = convo
    .filter((m) => m.actor !== "automation" && Number(m.id) <= messageId)
    .map((m) => ({ from: m.direction === "in" ? "prospect" : "business", body: m.body }));
  const lastOut = priorOut[priorOut.length - 1]?.body;
  const ctxBase = {
    isFirstReply: !priorOut.some((m) => m.actor === "ai" || m.actor === "operator"),
    opener,
    previousOutbound: lastOut,
    theyAnsweredOurQuestion: (lastOut ?? "").includes("?"),
  };

  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0 };
  const attempts: { n: number; draft: Draft; checks: Check[]; model: string }[] = [];
  let feedback: string[] | undefined;

  for (let n = 1; n <= 2; n++) {
    const r = await model.draft({ contact, opener, history, feedback, attempt: n });
    for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += r.usage[k];
    const d = r.draft;
    const common = { stage: d.stage, intent: d.intent, confidence: d.confidence, model: r.model, usage, attempts };

    if (r.refused) {
      attempts.push({ n, draft: d, checks: [], model: r.model });
      await log("held", "handover", "The model declined to draft. Handed to a person.");
      await setOwner(db, contactId, true);
      return finish("HANDOVER", { ...common, reason: d.reason });
    }

    // The bot question gets fixed text from the server, never a model-written answer.
    if (d.intent === "asks_if_bot") {
      attempts.push({ n, draft: d, checks: [], model: r.model });
      const sent = await sendMessage(db, { contactId, body: disclosureText, actor: "ai", dedupeKey: `disclosure:${messageId}`, decisionId });
      await log("held", "handover", "Asked if this is a bot. Sent the fixed disclosure and handed the conversation to a person.", { send: sent.status });
      await setOwner(db, contactId, true);
      return finish("HANDOVER", { ...common, reply: disclosureText, reason: d.reason });
    }
    if (d.stage === "handover") {
      attempts.push({ n, draft: d, checks: [], model: r.model });
      await log("held", "handover", `Handed to a person: ${d.reason}`);
      await setOwner(db, contactId, true);
      return finish("HANDOVER", { ...common, reason: d.reason });
    }
    if (d.stage === "wait") {
      attempts.push({ n, draft: d, checks: [], model: r.model });
      const days = d.follow_up_days ?? 2;
      await log("info", "wait", `They owe the next move. Saying nothing; follow-up in ${days} day${days === 1 ? "" : "s"}.`);
      return finish("WAITING", { ...common, followUpDays: days, reason: d.reason });
    }

    const checks = validateReply({ ...ctxBase, reply: d.reply });
    attempts.push({ n, draft: d, checks, model: r.model });
    const bad = failed(checks);
    if (bad.length) {
      await log("held", "rules", `Draft ${n} rejected by the server: ${bad.map((c) => c.label.toLowerCase()).join("; ")}.`, { failed: bad });
      if (n === 1) {
        feedback = bad.map((c) => `${c.label} (${c.detail})`);
        continue;
      }
      return finish("HELD", { ...common, reply: d.reply, reason: "Still broke a rule after one rewrite. A person should look." });
    }
    await log("ok", "rules", `Draft ${n} passed all ${checks.length} checks.`);

    if (d.confidence < settings.minConfidence) {
      await log("held", "decision", `Confidence ${d.confidence.toFixed(2)} is below ${settings.minConfidence}. Waiting for approval.`);
      return finish("HELD", { ...common, reply: d.reply, reason: `Low confidence: ${d.reason}` });
    }
    if (!settings.autoSend) {
      await log("held", "decision", "Auto-send is off. Waiting for approval.");
      return finish("HELD", { ...common, reply: d.reply, reason: "Auto-send is off." });
    }
    const sent = await sendMessage(db, { contactId, body: d.reply, actor: "ai", dedupeKey: `ai:${messageId}`, decisionId });
    const status: Status = sent.status === "SENT" || sent.status === "DUPLICATE" ? "SENT" : sent.status === "DRY_RUN" ? "DRY_RUN" : "BLOCKED";
    return finish(status, { ...common, reply: d.reply, reason: sent.status === "BLOCKED" ? `Blocked: ${sent.reason}` : d.reason });
  }
  return finish("HELD", { reason: "No draft produced.", usage, attempts });
}

// ---------------------------------------------------------------- operator actions

async function setOwner(db: Db, contactId: string, owned: boolean) {
  await db.query("update contacts set operator_owned = $2 where id = $1", [contactId, owned]);
}

export async function takeOver(db: Db, contactId: string) {
  await setOwner(db, contactId, true);
  await logEvent(db, { contactId, kind: "operator", tone: "info", summary: "Ada took over. The assistant stays quiet in this conversation." });
}

export async function handBack(db: Db, contactId: string) {
  await setOwner(db, contactId, false);
  await logEvent(db, { contactId, kind: "operator", tone: "info", summary: "Handed back to the assistant." });
}

export async function operatorSend(db: Db, contactId: string, body: string) {
  const text = body.trim().slice(0, 1000);
  if (!text) return { status: "EMPTY" as const };
  // Typing into a conversation takes it over.
  await setOwner(db, contactId, true);
  return sendMessage(db, { contactId, body: text, actor: "operator", dedupeKey: `op:${crypto.randomUUID()}` });
}

export async function approveDecision(db: Db, decisionId: number, editedText?: string) {
  const [d] = await db.query<{ id: number; contact_id: string; trigger_message_id: number; status: string; reply: string | null }>(
    "select id, contact_id, trigger_message_id, status, reply from decisions where id = $1",
    [decisionId],
  );
  if (!d || d.status !== "HELD") return { status: "NOT_HELD" as const };
  const body = (editedText ?? d.reply ?? "").trim();
  if (!body) return { status: "EMPTY" as const };
  // A person approved it, so it goes out as theirs: opt-out still binds, automation caps don't.
  const sent = await sendMessage(db, { contactId: d.contact_id, body, actor: "operator", dedupeKey: `ai:${d.trigger_message_id}`, decisionId });
  const edited = editedText !== undefined && editedText.trim() !== (d.reply ?? "").trim();
  await db.query("update decisions set status = $2, approved_by = 'Ada (demo)', edited = $3, reply = $4, updated_at = now() where id = $1", [
    decisionId,
    sent.status === "SENT" || sent.status === "DUPLICATE" ? "APPROVED" : "BLOCKED",
    edited,
    body,
  ]);
  await logEvent(db, {
    contactId: d.contact_id,
    messageId: d.trigger_message_id,
    decisionId,
    kind: "operator",
    tone: sent.status === "SENT" ? "ok" : "blocked",
    summary: edited ? "Ada edited the draft and approved it." : "Ada approved the draft.",
  });
  return sent;
}

export async function discardDecision(db: Db, decisionId: number) {
  const rows = await db.query<{ contact_id: string; trigger_message_id: number }>(
    "update decisions set status = 'DISCARDED', updated_at = now() where id = $1 and status = 'HELD' returning contact_id, trigger_message_id",
    [decisionId],
  );
  if (rows[0]) {
    await logEvent(db, { contactId: rows[0].contact_id, messageId: rows[0].trigger_message_id, decisionId, kind: "operator", tone: "info", summary: "Ada discarded the draft." });
  }
  return { discarded: rows.length > 0 };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
