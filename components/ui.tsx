"use client";
import Link from "next/link";
import type { ClientState } from "@/lib/client";

export function Mark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="var(--ink)" />
      <path d="M6.5 8.5h11M6.5 12h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16.8" cy="15.6" r="2.2" fill="var(--green-bright)" />
    </svg>
  );
}

export function TopBar({
  state,
  page,
  onSettings,
  onReset,
  busy,
}: {
  state: ClientState | null;
  page: "demo" | "console";
  onSettings: (patch: Record<string, unknown>) => void;
  onReset: () => void;
  busy: boolean;
}) {
  const s = state?.settings;
  const scripted = state?.model === "scripted";
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="brand">
          <Mark />
          <span className="brand-name">Reply Desk</span>
        </Link>
        <span className={`mode ${scripted ? "mode-scripted" : "mode-live"}`} title={scripted ? "No API key set, so a scripted model drafts the replies." : "Drafts come from Claude."}>
          {state ? (scripted ? "Scripted model" : state.model) : "…"}
        </span>
        <nav className="tabs" aria-label="Pages">
          <Link href="/" className={page === "demo" ? "on" : ""}>
            Demo
          </Link>
          <Link href="/console" className={page === "console" ? "on" : ""}>
            Operator console
            {state && state.held.length > 0 && <span className="count">{state.held.length}</span>}
          </Link>
        </nav>
      </div>
      <div className="topbar-right">
        {s && (
          <>
            <Switch id="sw-send" label="Sending" on={s.sendingEnabled} tone="red" onChange={(v) => onSettings({ sendingEnabled: v })} hint="The kill switch. Off stops every automated send." />
            <Switch id="sw-auto" label="Auto-send" on={s.autoSend} onChange={(v) => onSettings({ autoSend: v })} hint="Off: every draft waits for approval." />
            <Switch id="sw-dry" label="Dry run" on={s.dryRun} tone="amber" onChange={(v) => onSettings({ dryRun: v })} hint="Run every check, send nothing." />
          </>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onReset} disabled={busy}>
          Reset demo
        </button>
      </div>
    </header>
  );
}

export function Switch({ id, label, on, onChange, tone = "green", hint }: { id: string; label: string; on: boolean; onChange: (v: boolean) => void; tone?: "green" | "red" | "amber"; hint?: string }) {
  return (
    <label className={`switch tone-${tone}`} htmlFor={id} title={hint}>
      <input id={id} type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true">
        <span className="thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </label>
  );
}

const STAMP: Record<string, { tone: string; label: string }> = {
  SENT: { tone: "ok", label: "Sent" },
  APPROVED: { tone: "ok", label: "Approved & sent" },
  HELD: { tone: "held", label: "Held for a person" },
  HANDOVER: { tone: "held", label: "Handed to Ada" },
  WAITING: { tone: "wait", label: "Waiting on them" },
  SKIPPED: { tone: "muted", label: "Skipped" },
  BLOCKED: { tone: "blocked", label: "Blocked" },
  OPTED_OUT: { tone: "blocked", label: "Opted out" },
  DRY_RUN: { tone: "wait", label: "Dry run" },
  DISCARDED: { tone: "muted", label: "Discarded" },
  PENDING: { tone: "muted", label: "Deciding…" },
  REFUSED: { tone: "blocked", label: "Refused" },
};

export function Stamp({ status }: { status: string }) {
  const s = STAMP[status] ?? { tone: "muted", label: status };
  return <span className={`stamp stamp-${s.tone}`}>{s.label}</span>;
}

export function Lights({ checks }: { checks: { id: string; label: string; ok: boolean; detail?: string }[] }) {
  if (!checks.length) return null;
  return (
    <ul className="lights" aria-label="Rule checks">
      {checks.map((c) => (
        <li key={c.id} className={c.ok ? "pass" : "fail"} title={c.detail ?? "Passed"}>
          <span className="dot" aria-hidden="true" />
          <span>{c.label}</span>
          <span className="sr-only">{c.ok ? "passed" : `failed: ${c.detail}`}</span>
        </li>
      ))}
    </ul>
  );
}
