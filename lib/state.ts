import type { Db } from "./db";
import { getSettings } from "./settings";

export type UiEvent = { id: number; kind: string; tone: string; summary: string; detail: unknown; createdAt: string };
export type UiDecision = {
  id: number;
  status: string;
  stage: string | null;
  intent: string | null;
  confidence: number | null;
  reply: string | null;
  reason: string | null;
  followUpDays: number | null;
  attempts: { n: number; draft: Record<string, unknown>; checks: { id: string; label: string; ok: boolean; detail?: string }[]; model: string }[];
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costMicros: number;
  edited: boolean;
};
export type UiMessage = { id: number; direction: "in" | "out"; actor: string; body: string; createdAt: string };
export type UiStep = { message: UiMessage; events: UiEvent[]; decision: UiDecision | null };

export async function getState(db: Db, contactId?: string) {
  const contacts = await db.query<{
    id: string;
    name: string;
    company: string;
    phone: string;
    opted_out_at: string | null;
    operator_owned: boolean;
    held: number;
  }>(
    "select c.*, (select count(*)::int from decisions d where d.contact_id = c.id and d.status = 'HELD') as held from contacts c order by c.created_at, c.id",
  );
  const selected = contacts.find((c) => c.id === contactId) ?? contacts[0];

  const messages = (
    await db.query<{ id: number; direction: "in" | "out"; actor: string; body: string; created_at: string }>(
      "select id, direction, actor, body, created_at from messages where contact_id = $1 order by id",
      [selected.id],
    )
  ).map((m) => ({ id: Number(m.id), direction: m.direction, actor: m.actor, body: m.body, createdAt: iso(m.created_at) }));

  const events = await db.query<{ id: number; message_id: number | null; decision_id: number | null; kind: string; tone: string; summary: string; detail: unknown; created_at: string }>(
    "select * from events where contact_id = $1 order by id",
    [selected.id],
  );
  const decisions = await db.query<Record<string, unknown>>("select * from decisions where contact_id = $1 order by id", [selected.id]);
  const decisionByTrigger = new Map<number, UiDecision>();
  for (const d of decisions) decisionByTrigger.set(Number(d.trigger_message_id), toUiDecision(d));

  const steps: UiStep[] = messages
    .filter((m) => m.direction === "in")
    .map((m) => {
      const decision = decisionByTrigger.get(m.id) ?? null;
      const own = events.filter((e) => Number(e.message_id) === m.id || (decision && Number(e.decision_id) === decision.id));
      return { message: m, decision, events: own.map(toUiEvent) };
    })
    .reverse();

  const looseEvents = events.filter((e) => e.message_id === null && e.decision_id === null).map(toUiEvent).reverse();

  const held = (
    await db.query<Record<string, unknown>>(
      "select d.*, c.name as contact_name, c.company as contact_company, m.body as trigger_body from decisions d join contacts c on c.id = d.contact_id join messages m on m.id = d.trigger_message_id where d.status = 'HELD' order by d.id",
    )
  ).map((d) => ({ ...toUiDecision(d), contactId: String(d.contact_id), contactName: String(d.contact_name), contactCompany: String(d.contact_company), triggerBody: String(d.trigger_body) }));

  const [stats] = await db.query<{ sends_today: number; cost_today: string; cost_total: string; decisions_total: number }>(
    `select
       (select count(*)::int from messages where direction = 'out' and actor in ('ai', 'automation') and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as sends_today,
       (select coalesce(sum(cost_micros), 0) from decisions where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as cost_today,
       (select coalesce(sum(cost_micros), 0) from decisions) as cost_total,
       (select count(*)::int from decisions) as decisions_total`,
  );
  const byStatus = await db.query<{ status: string; n: number }>("select status, count(*)::int as n from decisions group by status");

  return {
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      phone: c.phone,
      optedOut: !!c.opted_out_at,
      operatorOwned: c.operator_owned,
      held: c.held,
    })),
    selectedId: selected.id,
    messages,
    steps,
    looseEvents,
    held,
    settings: await getSettings(db),
    stats: {
      sendsToday: stats.sends_today,
      costTodayMicros: Number(stats.cost_today),
      costTotalMicros: Number(stats.cost_total),
      decisionsTotal: stats.decisions_total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    },
  };
}

function toUiEvent(e: { id: number; kind: string; tone: string; summary: string; detail: unknown; created_at: string }): UiEvent {
  return { id: Number(e.id), kind: e.kind, tone: e.tone, summary: e.summary, detail: e.detail, createdAt: iso(e.created_at) };
}

function toUiDecision(d: Record<string, unknown>): UiDecision {
  const attempts = typeof d.attempts === "string" ? JSON.parse(d.attempts) : d.attempts;
  return {
    id: Number(d.id),
    status: String(d.status),
    stage: (d.stage as string) ?? null,
    intent: (d.intent as string) ?? null,
    confidence: d.confidence === null ? null : Number(d.confidence),
    reply: (d.reply as string) ?? null,
    reason: (d.reason as string) ?? null,
    followUpDays: d.follow_up_days === null ? null : Number(d.follow_up_days),
    attempts: (attempts as UiDecision["attempts"]) ?? [],
    model: (d.model as string) ?? null,
    inputTokens: Number(d.input_tokens ?? 0),
    outputTokens: Number(d.output_tokens ?? 0),
    cacheReadTokens: Number(d.cache_read_tokens ?? 0),
    costMicros: Number(d.cost_micros ?? 0),
    edited: Boolean(d.edited),
  };
}

// Millisecond ISO timestamps, so messages and events that land in the same second still sort correctly.
function iso(v: unknown) {
  return new Date(v as string).toISOString();
}

export type DeskState = Awaited<ReturnType<typeof getState>>;
