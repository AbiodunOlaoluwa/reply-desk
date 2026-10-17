// A small per-IP limiter for the public demo. In-memory, so it resets with the process; good enough
// to stop one visitor from running up the AI bill, not a substitute for a shared store.
const g = globalThis as unknown as { __hits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__hits ??= new Map());

export function allow(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export const clientKey = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
