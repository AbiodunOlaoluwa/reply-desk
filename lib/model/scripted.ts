// A deterministic stand-in for the model, so the demo runs with no API key and costs nothing.
// It deliberately gets some first drafts wrong (an invented price, reciting the opener,
// asking again without giving anything) so the server-side rules have something to catch.
import { business } from "../facts";
import { type Draft, type DraftInput, type DraftResult, type ReplyModel, zeroUsage } from "./types";

const has = (re: RegExp, s: string) => re.test(s);

function classify(text: string, lastBusinessAskedQuestion: boolean): Draft["intent"] {
  const t = text.toLowerCase();
  if (has(/\b(bot|robot|automated|an ai|a real person|a human|human being)\b/, t)) return "asks_if_bot";
  if (has(/\b(spam|annoying|how did you get my (number|email)|who gave you)\b/, t)) return "complaint";
  if (has(/\b(contract|terms|refund|legal|references?)\b/, t)) return "contract";
  if (has(/\b(call|meet|meeting|zoom|tomorrow|schedule|available|demo|visit|stop by|come (by|over|to)|our office)\b/, t)) return "wants_call";
  if (has(/\b(how much|price|pricing|cost|fee|charge)\b/, t)) return "pricing";
  if (has(/(what is this|what's this|meaning what|what do you do|tell me more|what is tallyhouse)/, t)) return "what_is_it";
  if (has(/\b(i'?ll (have a )?(look|check)|will (look|check)|later|noted|let me (see|check)|get back to you|next week)\b/, t))
    return "will_look";
  if (has(/^(hi|hello|hey|good (morning|afternoon|evening))\b/, t) && t.length < 40) return "greeting";
  if (has(/^(ok|okay|thanks|thank you|cool|alright|sure)\b[.! ]*$/, t)) return "acknowledgement";
  if (lastBusinessAskedQuestion && has(/\b(spreadsheet|excel|sheets|accountant|quickbooks|manual|by hand|notebook|we use|yes|no)\b/, t))
    return "answered_question";
  return "other";
}

function followUpDays(text: string): number {
  const t = text.toLowerCase();
  if (/next week/.test(t)) return 7;
  if (/today|tonight|later/.test(t)) return 1;
  return 2;
}

export const scriptedModel: ReplyModel = {
  name: "scripted",
  async draft(input: DraftInput): Promise<DraftResult> {
    const last = input.history[input.history.length - 1]?.body ?? "";
    const previousBusiness = [...input.history].reverse().find((t) => t.from === "business")?.body ?? input.opener;
    const intent = classify(last, previousBusiness.trim().endsWith("?") || /\?\s*\n/.test(previousBusiness));
    const first = input.contact.name.split(" ")[0];
    const retry = input.attempt > 1;

    const d = (stage: Draft["stage"], confidence: number, reply: string, reason: string, follow: number | null = null): Draft => ({
      stage,
      intent,
      confidence,
      reply,
      follow_up_days: follow,
      reason,
    });

    let draft: Draft;
    switch (intent) {
      case "asks_if_bot":
        draft = d("handover", 0.95, "", "They asked whether they are talking to a bot.");
        break;
      case "complaint":
        draft = d("handover", 0.9, "", "This reads as a complaint, so a person should answer.");
        break;
      case "contract":
        draft = d("handover", 0.9, "", "Contracts and references are for a person.");
        break;
      case "wants_call":
        draft = d("handover", 0.92, "", "They want to talk or meet. Hand over so a person can arrange it.");
        break;
      case "will_look":
        draft = d("wait", 0.9, "", "They said they will look. The next move is theirs, so say nothing and follow up.", followUpDays(last));
        break;
      case "acknowledgement":
        draft = d("wait", 0.8, "", "A bare acknowledgement. Nothing useful to add right now.", 3);
        break;
      case "pricing":
        draft = retry
          ? d(
              "answer",
              0.86,
              `It's ${business.price}, and there's ${business.trial}: ${business.link}. Would a trial on your own invoices be useful?`,
              "Answered with the price from the facts and offered the trial.",
            )
          : d(
              "answer",
              0.8,
              "It's $19 a month, and we can do a discount if you sign up this week. Want me to set it up?",
              "Answered the price question.",
            );
        break;
      case "what_is_it":
        draft = retry
          ? d(
              "answer",
              0.88,
              `${business.name} is where a small studio's invoices, receipts and month-end figures live together, so ${business.benefit}. You can see it here: ${business.link}. How do you handle your books today?`,
              "Explained what it is and who it is for, then asked one question.",
            )
          : d(
              "answer",
              0.82,
              `${business.name} is ${business.what}. Do you keep your books in spreadsheets at the moment?`,
              "Explained the product.",
            );
        break;
      case "answered_question":
        draft = retry
          ? d(
              "qualify",
              0.84,
              `That's where most studios start. ${business.name} can take over from the spreadsheet: ${business.setup}, and the monthly report builds itself (${business.link}). How many invoices do you send in a typical month?`,
              "Gave something useful before asking the next question.",
            )
          : d("qualify", 0.78, "Understood. How many invoices do you send a month?", "Asked the next qualifying question.");
        break;
      case "greeting":
        draft = d(
          "open",
          0.9,
          `Hello ${first}, thanks for getting back to us. ${business.name} handles invoicing, expenses and month-end reports for small studios, so the books stop living in spreadsheets: ${business.link}. How are you managing them today?`,
          "Greeted them, said what it is in new words, asked one question.",
        );
        break;
      default:
        draft = d(
          "answer",
          0.45,
          `Thanks for asking. I'm not certain I follow, so I'll check with ${business.operator} and come back to you. In the meantime, this is what we do: ${business.link}`,
          "Not sure what they mean, so a person should check this one.",
        );
    }
    return { draft, usage: zeroUsage, model: "scripted" };
  },
};
