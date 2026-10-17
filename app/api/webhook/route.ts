// The real entry point a messaging provider would call.
import { getDb } from "@/lib/db";
import { getModel } from "@/lib/model";
import { handleWebhook } from "@/lib/pipeline";
import { webhookSecret } from "@/lib/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text(); // the raw bytes, exactly as signed
  if (raw.length > 64_000) return Response.json({ error: "too large" }, { status: 413 });
  const result = await handleWebhook(await getDb(), raw, req.headers.get("x-desk-signature"), webhookSecret(), getModel());
  return Response.json(result.body, { status: result.status });
}
