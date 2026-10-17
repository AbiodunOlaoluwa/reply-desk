import type { Db } from "./db";

export type Tone = "ok" | "held" | "blocked" | "info";

export async function logEvent(
  db: Db,
  e: { contactId?: string | null; messageId?: number | null; decisionId?: number | null; kind: string; tone?: Tone; summary: string; detail?: unknown },
) {
  await db.query(
    "insert into events (contact_id, message_id, decision_id, kind, tone, summary, detail) values ($1, $2, $3, $4, $5, $6, $7)",
    [e.contactId ?? null, e.messageId ?? null, e.decisionId ?? null, e.kind, e.tone ?? "info", e.summary, JSON.stringify(e.detail ?? {})],
  );
}
