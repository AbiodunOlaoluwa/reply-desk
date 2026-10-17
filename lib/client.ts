"use client";
import { useCallback, useEffect, useState } from "react";
import type { DeskState } from "./state";

export type ClientState = DeskState & { model: string };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function useDesk(initialContact?: string) {
  const [contactId, setContactId] = useState<string | undefined>(initialContact);
  const [state, setState] = useState<ClientState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (id = contactId) => {
    const res = await fetch(`/api/state${id ? `?contact=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
    setState(await res.json());
  }, [contactId]);

  useEffect(() => {
    refresh(contactId);
  }, [contactId, refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [refresh],
  );

  const id = state?.selectedId;
  return {
    state,
    busy,
    error,
    select: (c: string) => setContactId(c),
    refresh,
    say: (text: string) => run(() => post("/api/simulate", { contactId: id, action: "send", text })),
    redeliver: () => run(() => post("/api/simulate", { contactId: id, action: "redeliver" })),
    forge: (text: string) => run(() => post("/api/simulate", { contactId: id, action: "forge", text })),
    settings: (patch: Record<string, unknown>) => run(() => post("/api/settings", patch)),
    reset: () => run(() => post("/api/reset", {})),
    approve: (decisionId: number, text?: string) => run(() => post(`/api/decisions/${decisionId}`, { action: "approve", text })),
    discard: (decisionId: number) => run(() => post(`/api/decisions/${decisionId}`, { action: "discard" })),
    takeOver: (contact: string) => run(() => post(`/api/contacts/${contact}`, { action: "takeover" })),
    handBack: (contact: string) => run(() => post(`/api/contacts/${contact}`, { action: "handback" })),
    operatorSend: (contact: string, text: string) => run(() => post(`/api/contacts/${contact}`, { action: "send", text })),
  };
}

export const dollars = (micros: number) => (micros === 0 ? "$0.00" : micros < 10_000 ? `$${(micros / 1e6).toFixed(4)}` : `$${(micros / 1e6).toFixed(2)}`);
