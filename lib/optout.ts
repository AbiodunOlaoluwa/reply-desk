// Recognises "stop" and friends on word boundaries, without catching "can you stop by on Tuesday?",
// which is the warmest reply a sales team can get. (A naive includes("stop") check suppressed exactly that.)
const NOT_AN_OPT_OUT = /\bstop(ping)?\s+(by|over|in|at)\b|\bnon[- ]?stop\b|\bcan'?t stop\b/i;
const OPT_OUT = /\b(stop|unsubscribe|opt[ -]?out|remove me|do not (message|contact|text)|don'?t (message|contact|text))\b/i;

export function isOptOut(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (NOT_AN_OPT_OUT.test(t)) return false;
  return OPT_OUT.test(t);
}

// Business auto-replies ("Thank you for contacting X! How may we help?") get no answer at all.
const AUTO_GREETING =
  /(thank you for (contacting|reaching out to|messaging)|thanks for contacting|how (may|can) (i|we) (help|assist)|our (business|office) hours|we will (get back|respond) to you|this is an automated)/i;

export function isAutoGreeting(text: string): boolean {
  return AUTO_GREETING.test(text);
}
