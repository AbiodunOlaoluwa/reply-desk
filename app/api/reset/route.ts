import { getDb } from "@/lib/db";
import { allow, clientKey } from "@/lib/rate-limit";
import { resetDemo } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!allow(`reset:${clientKey(req)}`, 5)) return Response.json({ error: "too many resets" }, { status: 429 });
  await resetDemo(await getDb());
  return Response.json({ ok: true });
}
