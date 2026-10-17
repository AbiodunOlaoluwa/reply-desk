import { z } from "zod";

export const STAGES = ["open", "answer", "qualify", "wait", "handover", "close"] as const;
export const INTENTS = [
  "greeting",
  "what_is_it",
  "pricing",
  "wants_call",
  "contract",
  "complaint",
  "asks_if_bot",
  "will_look",
  "answered_question",
  "acknowledgement",
  "other",
] as const;

export const DraftSchema = z.object({
  stage: z.enum(STAGES),
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  reply: z.string(),
  follow_up_days: z.number().int().min(1).max(30).nullable(),
  reason: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

// The same contract as JSON Schema, for the model's structured output.
export const draftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "intent", "confidence", "reply", "follow_up_days", "reason"],
  properties: {
    stage: { type: "string", enum: [...STAGES] },
    intent: { type: "string", enum: [...INTENTS] },
    confidence: { type: "number", description: "0 to 1: how sure you are this reply is right to send without a person." },
    reply: { type: "string", description: "The message to send. Empty when stage is wait or handover." },
    follow_up_days: { type: ["integer", "null"], description: "For stage wait: days until a follow-up. Otherwise null." },
    reason: { type: "string", description: "One sentence for the operator explaining the choice." },
  },
} as const;

export type Turn = { from: "prospect" | "business"; body: string };

export type DraftInput = {
  contact: { name: string; company: string };
  opener: string;
  history: Turn[]; // after the opener, oldest first; the last turn is the prospect's message being answered
  feedback?: string[]; // rules the previous attempt broke
  attempt: number;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number; // millionths of a dollar
};

export type DraftResult = { draft: Draft; usage: Usage; model: string; refused?: boolean };

export interface ReplyModel {
  name: string;
  draft(input: DraftInput): Promise<DraftResult>;
}

export const zeroUsage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0 };
