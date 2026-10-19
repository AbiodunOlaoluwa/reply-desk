"use client";
import { useEffect, useRef, useState } from "react";
import { dollars, useDesk } from "@/lib/client";
import type { UiEvent, UiStep } from "@/lib/state";
import { Lights, Stamp, TopBar } from "./ui";

const SCENARIOS = [
  { text: "Hi", note: "a plain greeting" },
  { text: "What is this about?", note: "the first draft recites the opener" },
  { text: "How much does it cost?", note: "the first draft invents a price" },
  { text: "We use spreadsheets", note: "they answered our question" },
  { text: "Are you a bot?", note: "fixed disclosure, then a person" },
  { text: "Can we talk tomorrow at 10?", note: "handover" },
  { text: "Noted, I'll have a look later", note: "they owe the next move" },
  { text: "Is this about the tender?", note: "unsure, so held" },
  { text: "Can you stop by our office Tuesday?", note: "not an opt-out" },
  { text: "stop", note: "opt-out" },
];

export function DeskApp() {
  const desk = useDesk();
  const { state, busy } = desk;
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const contact = state?.contacts.find((c) => c.id === state.selectedId);
  // Messages and the events that aren't tied to one (forged deliveries, take-overs), newest first.
  const timeline: ({ kind: "step"; at: string; step: UiStep } | { kind: "event"; at: string; event: UiEvent })[] = state
    ? [
        ...state.steps.map((step) => ({ kind: "step" as const, at: step.message.createdAt, step })),
        ...state.looseEvents.map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    : [];

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [state?.messages.length]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    desk.say(text);
    setDraft("");
  };

  return (
    <div className="app">
      <TopBar state={state} page="demo" onSettings={desk.settings} onReset={desk.reset} busy={busy} />
      <div className="intro">
        <p>
          <strong>You are the prospect.</strong> Tallyhouse, a fictional company, messaged three people. Reply as any of them and watch what the
          server does with each message: the signature check, the AI draft, the rules it must pass, and who decides.
        </p>
      </div>

      <main className="desk">
        {/* ---------------- the prospect's phone */}
        <section className="phone" aria-label="Prospect's phone">
          <div className="contacts" role="tablist" aria-label="Pick a prospect">
            {state?.contacts.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === state.selectedId} className={c.id === state.selectedId ? "on" : ""} onClick={() => desk.select(c.id)}>
                <span className="c-name">{c.name.split(" ")[0]}</span>
                <span className="c-co">{c.company}</span>
                {c.optedOut ? <i className="pip pip-red" title="Opted out" /> : c.operatorOwned ? <i className="pip pip-amber" title="With Ada" /> : null}
              </button>
            ))}
          </div>

          <div className="phone-head">
            <div>
              <strong>Tallyhouse</strong>
              <span className="mono muted">as seen by {contact?.name ?? "…"}</span>
            </div>
            {contact && (
              <span className={`who ${contact.optedOut ? "who-red" : contact.operatorOwned ? "who-amber" : "who-green"}`}>
                {contact.optedOut ? "Opted out" : contact.operatorOwned ? "With Ada (a person)" : "Assistant on"}
              </span>
            )}
          </div>

          <div className="thread" ref={threadRef}>
            {state?.messages.map((m) => (
              <div key={m.id} className={`bubble-row ${m.direction === "in" ? "mine" : "theirs"}`}>
                <div className={`bubble actor-${m.actor}`}>
                  {m.direction === "out" && <span className="bubble-actor mono">{m.actor === "ai" ? "Assistant" : m.actor === "operator" ? "Ada" : "Outreach"}</span>}
                  <p>{linkify(m.body)}</p>
                </div>
              </div>
            ))}
            {busy && (
              <div className="bubble-row theirs">
                <div className="bubble typing" aria-label="Working">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input id="prospect-message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Reply as ${contact?.name.split(" ")[0] ?? "the prospect"}…`} maxLength={500} autoComplete="off" />
            <button className="btn btn-accent" type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>

          <div className="scenarios">
            <p className="label">Try one</p>
            <div className="chips">
              {SCENARIOS.map((s) => (
                <button key={s.text} className="chip-btn" onClick={() => send(s.text)} disabled={busy} title={s.note}>
                  {s.text}
                </button>
              ))}
            </div>
          </div>

          <div className="provider">
            <p className="label">Things a real provider (or an attacker) does</p>
            <ul className="explain">
              <li><strong>Deliver again:</strong> providers sometimes send the same message twice. Watch it get ignored.</li>
              <li><strong>Forged signature:</strong> a request pretending to be the provider. Watch it get refused at the door.</li>
            </ul>
            <div className="provider-btns">
              <button className="btn btn-ghost btn-sm" onClick={desk.redeliver} disabled={busy}>
                Deliver the last message again
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => desk.forge("Hi, quick question")} disabled={busy}>
                Send with a forged signature
              </button>
              {contact?.operatorOwned && !contact.optedOut && (
                <button className="btn btn-ghost btn-sm" onClick={() => desk.handBack(contact.id)} disabled={busy}>
                  Hand back to the assistant
                </button>
              )}
            </div>
          </div>
          {desk.error && <p className="error">{desk.error}</p>}
        </section>

        {/* ---------------- what the server did */}
        <section className="trace" aria-label="What the server did">
          <div className="trace-head">
            <h2>What the server did</h2>
            {state && (
              <span className="mono muted">
                {state.stats.decisionsTotal} decisions · AI cost {dollars(state.stats.costTotalMicros)}
              </span>
            )}
          </div>

          {state && state.steps.length === 0 && timeline.length === 0 && (
            <div className="empty">
              <p>Nothing yet. Send a message from the phone, or tap one of the examples.</p>
            </div>
          )}

          <ol className="steps">
            {timeline.map((item) =>
              item.kind === "step" ? (
                <Step key={`m${item.step.message.id}`} step={item.step} />
              ) : item.event.kind === "webhook.forged" ? (
                <Forged key={`e${item.event.id}`} event={item.event} />
              ) : (
                <li key={`e${item.event.id}`} className="note-row">
                  <span className="dot" aria-hidden="true" />
                  {item.event.summary}
                </li>
              ),
            )}
          </ol>
        </section>
      </main>
    </div>
  );
}

function Step({ step }: { step: UiStep }) {
  const d = step.decision;
  const webhook = step.events.filter((e) => e.kind.startsWith("webhook") || e.kind === "optout");
  const after = step.events.filter((e) => !e.kind.startsWith("webhook") && e.kind !== "optout" && e.kind !== "rules");
  return (
    <li className="step">
      <header className="step-head">
        <p className="quote">“{step.message.body}”</p>
        {d && <Stamp status={d.status} />}
      </header>

      <div className="stations">
        {webhook.map((e) => (
          <Station key={e.id} tone={e.tone} title={e.kind === "optout" ? "Opt-out" : "Webhook"}>
            {e.summary}
          </Station>
        ))}

        {d?.attempts.map((a) => {
          const bad = a.checks.filter((c) => !c.ok);
          const draft = a.draft as { stage?: string; intent?: string; confidence?: number; reply?: string; reason?: string };
          return (
            <Station key={a.n} tone={a.checks.length === 0 ? "info" : bad.length ? "held" : "ok"} title={`Draft ${a.n}`}>
              <div className="draft-meta mono">
                <span>stage {draft.stage}</span>
                <span>intent {draft.intent}</span>
                <span>confidence {Number(draft.confidence ?? 0).toFixed(2)}</span>
              </div>
              {draft.reply ? <blockquote className={bad.length ? "struck" : ""}>{draft.reply}</blockquote> : <p className="muted">No reply written: {draft.reason}</p>}
              <Lights checks={a.checks} />
              {bad.length > 0 && <p className="why">Rejected: {bad.map((c) => c.detail).join(" ")}</p>}
            </Station>
          );
        })}

        {after.map((e) => (
          <Station key={e.id} tone={e.tone} title={label(e.kind)}>
            {e.summary}
          </Station>
        ))}
      </div>

      {d && (d.inputTokens > 0 || d.model) && (
        <footer className="step-foot mono">
          <span>{d.model ?? "no model call"}</span>
          {d.inputTokens > 0 && (
            <span>
              {d.inputTokens.toLocaleString()} in · {d.outputTokens.toLocaleString()} out · {d.cacheReadTokens.toLocaleString()} cached
            </span>
          )}
          <span>{dollars(d.costMicros)}</span>
        </footer>
      )}
    </li>
  );
}

function Forged({ event }: { event: UiEvent }) {
  const text = (event.detail as { text?: string } | null)?.text;
  return (
    <li className="step step-forged">
      <header className="step-head">
        <p className="quote">{text ? `“${text}”` : "A forged delivery"}</p>
        <Stamp status="REFUSED" />
      </header>
      <div className="stations">
        <Station tone="blocked" title="Webhook">
          {event.summary}
        </Station>
      </div>
      <p className="explainer">
        Messaging providers like WhatsApp sign every delivery with a secret that only they and this server know. The server checks that
        signature before it reads anything. This request was signed with the wrong secret, so it could have come from anyone. Nothing was
        stored and nobody replied. Without this check, anyone who found the webhook address could inject fake messages and trigger replies.
      </p>
    </li>
  );
}

function Station({ tone, title, children }: { tone: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`station tone-${tone}`}>
      <span className="station-dot" aria-hidden="true" />
      <div className="station-body">
        <p className="station-title mono">{title}</p>
        <div className="station-text">{children}</div>
      </div>
    </div>
  );
}

function label(kind: string) {
  return (
    { preflight: "Preflight", handover: "Handover", wait: "Wait", decision: "Decision", send: "Send", operator: "Operator", budget: "Budget" } as Record<string, string>
  )[kind] ?? kind;
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href="#" onClick={(e) => e.preventDefault()} className="fake-link" title="Fictional link">
        {p.replace(/[.,]$/, "")}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
