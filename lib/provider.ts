// A stand-in for the messaging provider (WhatsApp, SMS, email). It builds the payload the provider
// would send, signs it, and delivers it to the same webhook handler a real delivery would hit.
import type { Db } from "./db";
import { getModel } from "./model";
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

export async function deliverForged(db: Db, contact: { id: string; phone: string }, text: string) {
  const raw = JSON.stringify({ id: `msg_${crypto.randomUUID()}`, from: contact.phone, text, timestamp: Date.now() });
  return handleWebhook(db, raw, sign(raw, "not-the-real-secret"), webhookSecret(), getModel());
}
