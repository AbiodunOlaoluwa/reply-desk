"use client";
import { useEffect, useState } from "react";
import { dollars, useDesk } from "@/lib/client";
import { Lights, Stamp, TopBar } from "./ui";

export function ConsoleApp() {
  const desk = useDesk();
  const { state, busy } = desk;
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [compose, setCompose] = useState("");
  const [cap, setCap] = useState<string>("");
  const [minConf, setMinConf] = useState<string>("");
  const selected = state?.contacts.find((c) => c.id === state.selectedId);

  useEffect(() => {
    if (state) {
      setCap(String(state.settings.dailyCap));
      setMinConf(String(state.settings.minConfidence));
    }
  }, [state?.settings.dailyCap, state?.settings.minConfidence]); // eslint-disable-line react-hooks/exhaustive-deps

  const by = state?.stats.byStatus ?? {};
  const tiles = state
    ? [
        { v: String(state.stats.decisionsTotal), l: "decisions" },
        { v: String((by.SENT ?? 0) + (by.APPROVED ?? 0)), l: "sent" },
        { v: String(by.HELD ?? 0), l: "held for a person", tone: (by.HELD ?? 0) > 0 ? "held" : "" },
        { v: String(by.HANDOVER ?? 0), l: "handed to Ada" },
        { v: `${state.stats.sendsToday} / ${state.settings.dailyCap}`, l: "automated sends today" },
        { v: dollars(state.stats.costTotalMicros), l: "AI cost so far" },
      ]
    : [];

  return (
    <div className="app">
      <TopBar state={state} page="console" onSettings={desk.settings} onReset={desk.reset} busy={busy} />
      <main className="console">
        <ul className="tiles">
          {tiles.map((t) => (
            <li key={t.l} className={t.tone ? `tile tile-${t.tone}` : "tile"}>
              <span className="tile-v">{t.v}</span>
              <span className="tile-l">{t.l}</span>
            </li>
          ))}
        </ul>

        <div className="console-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Waiting for you</h2>
              <span className="mono muted">{state?.held.length ?? 0} held</span>
            </div>
            {state?.held.length === 0 && <p className="empty-line">Nothing waiting. Drafts land here when they fail a rule twice, fall below the confidence bar, or auto-send is off.</p>}
            <ul className="queue">
              {state?.held.map((h) => {
                const last = h.attempts[h.attempts.length - 1];
                const value = edits[h.id] ?? h.reply ?? "";
                return (
                  <li key={h.id} className="held">
                    <div className="held-top">
                      <strong>{h.contactName}</strong>
                      <span className="muted">{h.contactCompany}</span>
                    </div>
                    <p className="quote">“{h.triggerBody}”</p>
                    <p className="reason mono">{h.reason}</p>
                    {last && <Lights checks={last.checks} />}
                    <label className="sr-only" htmlFor={`edit-${h.id}`}>
                      Reply to send
                    </label>
                    <textarea id={`edit-${h.id}`} value={value} onChange={(e) => setEdits({ ...edits, [h.id]: e.target.value })} rows={4} />
                    <div className="held-actions">
                      <button className="btn btn-accent btn-sm" disabled={busy || !value.trim()} onClick={() => desk.approve(h.id, value)}>
                        {value.trim() !== (h.reply ?? "").trim() ? "Send my edit" : "Approve and send"}
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => desk.discard(h.id)}>
                        Discard
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Conversations</h2>
            </div>
            <ul className="convos">
              {state?.contacts.map((c) => (
                <li key={c.id} className={c.id === state.selectedId ? "on" : ""}>
                  <button className="convo-pick" onClick={() => desk.select(c.id)}>
                    <strong>{c.name}</strong>
                    <span className="muted">{c.company}</span>
                  </button>
                  <span className={`who ${c.optedOut ? "who-red" : c.operatorOwned ? "who-amber" : "who-green"}`}>
                    {c.optedOut ? "Opted out" : c.operatorOwned ? "With Ada" : "Assistant"}
                  </span>
                  {!c.optedOut &&
                    (c.operatorOwned ? (
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => desk.handBack(c.id)}>
                        Hand back
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => desk.takeOver(c.id)}>
                        Take over
                      </button>
                    ))}
                </li>
              ))}
            </ul>

            {selected && (
              <div className="mini-thread">
                <p className="label">With {selected.name}</p>
                <div className="mini-msgs">
                  {state?.messages.slice(-6).map((m) => (
                    <p key={m.id} className={m.direction === "in" ? "in" : "out"}>
                      <span className="mono">{m.direction === "in" ? selected.name.split(" ")[0] : m.actor === "ai" ? "Assistant" : m.actor === "operator" ? "Ada" : "Outreach"}</span>
                      {m.body}
                    </p>
                  ))}
                </div>
                <form
                  className="composer composer-sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!compose.trim()) return;
                    desk.operatorSend(selected.id, compose);
                    setCompose("");
                  }}
                >
                  <input id="operator-message" value={compose} onChange={(e) => setCompose(e.target.value)} placeholder={selected.optedOut ? "Opted out: sending is blocked" : "Write as Ada. Typing takes the conversation over."} maxLength={1000} />
                  <button className="btn btn-dark btn-sm" disabled={busy || !compose.trim()}>
                    Send as Ada
                  </button>
                </form>
              </div>
            )}

            <div className="limits">
              <p className="label">Limits</p>
              <div className="limit-row">
                <label htmlFor="cap">Daily cap for automated sends</label>
                <input id="cap" type="number" min={0} max={1000} value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => desk.settings({ dailyCap: Number(cap) })} />
              </div>
              <div className="limit-row">
                <label htmlFor="conf">Hold drafts below this confidence</label>
                <input id="conf" type="number" step={0.05} min={0} max={1} value={minConf} onChange={(e) => setMinConf(e.target.value)} onBlur={() => desk.settings({ minConfidence: Number(minConf) })} />
              </div>
            </div>
            {selected && state && state.steps[0]?.decision && (
              <p className="last-decision">
                Last decision for {selected.name.split(" ")[0]}: <Stamp status={state.steps[0].decision.status} />
              </p>
            )}
          </section>
        </div>
        {desk.error && <p className="error">{desk.error}</p>}
      </main>
    </div>
  );
}
