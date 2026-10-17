// Dollars per million tokens. Cache writes cost 1.25x input, cache reads 0.1x input.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function costMicros(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  const dollars =
    (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.input * 0.1 + u.outputTokens * p.output) /
    1_000_000;
  return Math.round(dollars * 1_000_000);
}
