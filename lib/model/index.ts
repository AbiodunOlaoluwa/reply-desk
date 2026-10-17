import { anthropicModel } from "./anthropic";
import { scriptedModel } from "./scripted";
import type { ReplyModel } from "./types";

// Real model only when explicitly switched on and a key is present. Everything else runs scripted.
export function getModel(): ReplyModel {
  if (process.env.REPLY_DESK_MODE === "anthropic" && process.env.ANTHROPIC_API_KEY) return anthropicModel();
  return scriptedModel;
}
