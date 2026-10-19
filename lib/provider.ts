// A stand-in for the messaging provider (WhatsApp, SMS, email). It builds the payload the provider
// would send, signs it, and delivers it to the same webhook handler a real delivery would hit.
import type { Db } from "./db";
import { getModel } from "./model";
import { logEvent } from "./events";
import { handleWebhook } from "./pipeline";
import { sign, webhookSecret } from "./signature";

// The last delivery per contact, so the demo can "deliver it again" byte for byte.
const g = globalThis as unknown as { __lastDelivery?: Map<string, string> };
const lastDelivery = (g.__lastDelivery ??= new Map());

export async function deliver(db: Db, contact: { id: string; phone: string }, text: string) {
  const raw = JSON.stringify({ id: `msg_${crypto.randomUUID()}`, from: contact.phone, text, timestamp: Date.now() });
  lastDelivery.set(contact.id, raw);
  return handleWebhook(db, raw, sign(raw, webhookSecret()), webhookSecret(), getModel());
}

export async function redeliver(db: Db, contactId: string) {
  const raw = lastDelivery.get(contactId);
  if (!raw) return { status: 404 as const, body: { error: "nothing delivered yet" } };
  return handleWebhook(db, raw, sign(raw, webhookSecret()), webhookSecret(), getModel());
}

// Someone pretending to be the provider. The server refuses it before reading the body, so it can't know
// whose conversation it claims to belong to. The demo knows, so it notes the attempt there for the visitor.
export async function deliverForged(db: Db, contact: { id: string; phone: string }, text: string) {
  const raw = JSON.stringify({ id: `msg_${crypto.randomUUID()}`, from: contact.phone, text, timestamp: Date.now() });
  const result = await handleWebhook(db, raw, sign(raw, "not-the-real-secret"), webhookSecret(), getModel());
  if (result.status === 401) {
    await logEvent(db, {
      contactId: contact.id,
      kind: "webhook.forged",
      tone: "blocked",
      summary: "Refused: the signature didn't match, so this request didn't come from the messaging provider.",
      detail: { text },
    });
  }
  return result;
}
