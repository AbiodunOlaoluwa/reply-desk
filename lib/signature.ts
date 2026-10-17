import { createHmac, timingSafeEqual } from "node:crypto";

// Webhooks are signed the way Meta and most providers do it: HMAC-SHA256 over the raw body.
export function sign(rawBody: string, secret: string) {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verify(rawBody: string, header: string | null, secret: string | undefined): boolean {
  // Fail closed: no secret configured means nothing is trusted.
  if (!secret || !header) return false;
  const expected = Buffer.from(sign(rawBody, secret));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function webhookSecret() {
  return process.env.WEBHOOK_SECRET ?? "demo-secret-change-me";
}
