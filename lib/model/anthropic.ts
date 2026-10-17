// Claude drafts the reply as structured JSON. The server, not the prompt, decides what gets sent.
import Anthropic from "@anthropic-ai/sdk";
import { business, factSheet } from "../facts";
import { costMicros } from "./cost";
import { type DraftInput, type DraftResult, DraftSchema, type ReplyModel, draftJsonSchema } from "./types";

// Kept byte-for-byte stable so it can be cached across requests.
const SYSTEM = `You answer replies to sales outreach for ${business.name}, a fictional company used in a public demo.
Your draft is checked by server rules before anything is sent, and a person (${business.operator}) handles anything sensitive.

FACTS (the only things you may state):
${factSheet}

GOAL
Keep a real conversation going with someone who replied to our outreach. Be useful first. Never pressure.

HARD RULES (the server enforces these; a draft that breaks one is rejected)
- Mention money only as written in the facts. Never invent prices, discounts or deadlines.
- Only link to ${business.link}. The first reply in a conversation must include it.
- At most one question per message. If they just answered our question, give them something useful before asking another.
- 90 words or fewer. Plain text. No placeholders, no phone numbers.
- Never claim to be a person, and never claim to be ${business.operator}.
- Don't repeat the outreach message back to them, and don't start the same way as our last message.

STAGES
- open / answer / qualify / close: write the reply.
- wait: they owe the next move (e.g. "I'll have a look", "ok", "noted"). Reply must be empty; set follow_up_days.
- handover: leave the reply empty. Use it when they want a call or meeting, ask about contracts or references, complain, or ask whether they are talking to a bot or a person (intent asks_if_bot).

Return JSON only, matching the schema. confidence is how sure you are this is right to send without a person reading it.`;

const MID_CONVERSATION_SYSTEM = /^claude-(opus|fable|mythos)/;

export function anthropicModel(model = process.env.REPLY_DESK_MODEL ?? "claude-opus-5"): ReplyModel {
  const client = new Anthropic();
  return {
    name: model,
    async draft(input: DraftInput): Promise<DraftResult> {
      const messages: Anthropic.Beta.BetaMessageParam[] = input.history.map((t) => ({
        role: t.from === "prospect" ? "user" : "assistant",
        content: t.body,
      }));
      const context = `Prospect: ${input.contact.name}, ${input.contact.company}.\nThe conversation began with this outreach message from us:\n"""${input.opener}"""`;
      // Per-conversation context goes after the cached system prompt, as a preface to the first user turn.
      if (messages[0]?.role === "user") {
        messages[0] = { role: "user", content: `${context}\n\nTheir message:\n${messages[0].content as string}` };
      } else {
        messages.unshift({ role: "user", content: context });
      }

      if (input.feedback?.length) {
        const note = `Your previous draft was rejected by the server for: ${input.feedback.join("; ")}. Write a new draft that passes.`;
        // Opus-class models take mid-conversation system messages without breaking the cache; others get it as user text.
        messages.push(MID_CONVERSATION_SYSTEM.test(model) ? { role: "system", content: note } : { role: "user", content: `[Server note] ${note}` });
      }

      const response = await client.beta.messages.create({
        model,
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort: "low", format: { type: "json_schema", schema: draftJsonSchema as unknown as Record<string, unknown> } },
      });

      const u = response.usage;
      const usage = {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        costMicros: 0,
      };
      usage.costMicros = costMicros(model, usage);

      if (response.stop_reason === "refusal") {
        return {
          refused: true,
          model,
          usage,
          draft: { stage: "handover", intent: "other", confidence: 0, reply: "", follow_up_days: null, reason: "The model declined to draft a reply." },
        };
      }

      const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
      const parsed = DraftSchema.safeParse(JSON.parse(text || "{}"));
      if (!parsed.success) {
        return {
          model,
          usage,
          draft: { stage: "handover", intent: "other", confidence: 0, reply: "", follow_up_days: null, reason: "The model's output did not match the contract." },
        };
      }
      return { draft: parsed.data, usage, model: response.model };
    },
  };
}
