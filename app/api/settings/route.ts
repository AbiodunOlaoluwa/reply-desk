import { getDb } from "@/lib/db";
import { updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const patch = await req.json().catch(() => null);
  if (!patch || typeof patch !== "object") return Response.json({ error: "bad request" }, { status: 400 });
  return Response.json(await updateSettings(await getDb(), patch));
}
