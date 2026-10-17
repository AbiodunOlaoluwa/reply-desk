// Server-side checks every AI draft must pass before it can be sent.
// The model is told these rules too, but telling is not enforcing: each rule here exists because a
// prompt-only version of it was ignored at least once in production.
import { allowedAmounts, allowedLinks, business } from "./facts";

export type Check = { id: string; label: string; ok: boolean; detail?: string };

export type ValidationContext = {
  reply: string;
  isFirstReply: boolean;
  opener?: string;
  previousOutbound?: string;
  theyAnsweredOurQuestion: boolean;
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const AMOUNT = /(?:[$₦£€]\s?\d[\d,]*(?:\.\d+)?k?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|naira|ngn|pounds|gbp)\b)/gi;
const URL = /https?:\/\/[^\s)]+/gi;
const PHONE = /\+?\d[\d\s-]{6,}\d/;
const PLACEHOLDER = /\[[^\]]*\]|\{\{|\btest\b|\blorem\b|\bTODO\b|<name>/i;
const SELF_CLAIM = /\b(as an ai|i am an ai|i'?m an ai|i am a (bot|robot|human|real person)|i'?m (a )?(human|real person)|i'?m not a bot)\b/i;
const PROMISE = /\b(guarantee[ds]?|100%|discount|free forever|promise)\b/i;

export function sharesWindow(a: string, b: string, size = 8): boolean {
  const wa = words(normalise(a));
  const nb = ` ${normalise(b)} `;
  for (let i = 0; i + size <= wa.length; i++) {
    if (nb.includes(` ${wa.slice(i, i + size).join(" ")} `)) return true;
  }
  return false;
}

function wordsOutsideQuestions(reply: string): number {
  return reply
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !sentence.trim().endsWith("?"))
    .reduce((n, sentence) => n + words(sentence).length, 0);
}

export function validateReply(ctx: ValidationContext): Check[] {
  const r = ctx.reply ?? "";
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string) => checks.push({ id, label, ok, detail: ok ? undefined : detail });

  add("has_text", "Says something", words(r).length > 0, "The draft is empty.");

  const n = words(r).length;
  add("word_limit", "90 words or fewer", n <= 90, `${n} words, over the limit.`);

  const q = (r.match(/\?/g) ?? []).length;
  add("one_question", "Asks at most one question", q <= 1, `${q} questions in one message.`);

  const amounts = (r.match(AMOUNT) ?? []).map((a) => a.replace(/\s/g, ""));
  const unknown = amounts.filter((a) => !allowedAmounts.includes(a));
  add("money_from_facts", "Only prices it was given", unknown.length === 0, `Mentions ${unknown.join(", ")}, which is not in the facts.`);

  const links = (r.match(URL) ?? []).map((u) => u.replace(/[.,!?;:]+$/, ""));
  const badLinks = links.filter((u) => !allowedLinks.includes(u));
  add("approved_links", "Only approved links", badLinks.length === 0, `Unapproved link: ${badLinks.join(", ")}.`);

  add("no_phone_numbers", "No phone numbers", !PHONE.test(r), "Contains something that looks like a phone number.");
  add("no_placeholders", "No placeholders or test text", !PLACEHOLDER.test(r), "Contains placeholder or test text.");
  add("no_self_claims", "Never claims to be human", !SELF_CLAIM.test(r), "Makes a claim about being human or AI.");
  add("no_promises", "No promises or discounts", !PROMISE.test(r), "Promises something that is not in the facts.");

  if (ctx.isFirstReply) {
    add("first_reply_link", "First reply carries the link", r.includes(business.link), "The first reply must include the website link.");
  }
  if (ctx.opener) {
    add("no_recited_opener", "Doesn't recite the opener", !sharesWindow(r, ctx.opener), "Repeats the outreach message back to them.");
  }
  if (ctx.previousOutbound) {
    const first = (s: string) => words(normalise(s)).slice(0, 6).join(" ");
    const same = first(r).length > 0 && first(r) === first(ctx.previousOutbound);
    add("no_repeated_opening", "Doesn't repeat its last opening", !same, "Starts the same way as the previous message.");
  }
  if (ctx.theyAnsweredOurQuestion && q > 0) {
    const given = wordsOutsideQuestions(r);
    add("give_before_ask", "Gives something before asking again", given >= 10, `Only ${given} word${given === 1 ? "" : "s"} before the next question.`);
  }
  return checks;
}

export const failed = (checks: Check[]) => checks.filter((c) => !c.ok);
