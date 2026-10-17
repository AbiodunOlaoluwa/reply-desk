# Reply Desk

AI replies to inbound sales messages, inside server-side rules the model cannot override.

Reply Desk is a working demo of the system that answers WhatsApp replies to outreach for [Rentyx](https://rentyx.org). It is rebuilt here on a fictional company (Tallyhouse) and fictional prospects, so anyone can run it and nothing touches real people's data.

You play the prospect. Each message you send goes through the same path a real delivery would take, and the screen shows what the server did with it.

## What it shows

| Promise | How it's kept | Where |
| --- | --- | --- |
| A message is processed once, however often the provider delivers it | Unique provider message id; a redelivery inserts nothing | `lib/pipeline.ts`, `messages.provider_message_id` |
| Nobody gets two replies to one message | One decision per inbound message, claimed with a unique key before any work | `decisions.trigger_message_id` |
| A retried send goes out once | Every outbound message carries a dedupe key | `lib/send.ts`, `messages.dedupe_key` |
| Forged requests are refused | HMAC-SHA256 over the raw body, constant-time compare, fails closed with no secret | `lib/signature.ts` |
| "Stop" is honoured everywhere | Opt-out is saved before anything else runs, and every sender checks it, people included | `lib/pipeline.ts`, `lib/send.ts` |
| "Can you stop by on Tuesday?" is not an opt-out | Word-boundary matching with explicit exclusions | `lib/optout.ts` |
| The AI never says what it shouldn't | Structured draft, then 13 server-side rules; one rewrite, then a person | `lib/validate.ts` |
| Sensitive moments go to a person | Calls, meetings, contracts, complaints, low confidence, and "are you a bot?" (fixed disclosure text, then handover) | `lib/pipeline.ts` |
| It knows when to say nothing | A "wait" stage when the prospect owes the next move | `lib/pipeline.ts` |
| Everything that sends can be stopped | Kill switch, daily cap, dry-run mode | `lib/send.ts` |
| Costs are visible | Tokens and cost recorded per decision, with an optional daily budget | `lib/model/cost.ts` |

## Why each rule exists

Every rule in `lib/validate.ts` was added after a prompt-only version of it failed in production at least once.

- **Only prices it was given.** Models fill gaps with plausible numbers.
- **First reply carries the link.** The model decided the opener had already shared it, so it left it out.
- **Doesn't recite the opener.** Answering "Hi" by repeating the introduction is the clearest sign nobody is reading.
- **Gives something before asking again.** "Understood. How many invoices…?" right after they answered feels like an interrogation.
- **No placeholders or test text.** A test once reached a real prospect as "Good afternoon, test." Since then, the server refuses it.
- **At most one question.** Two questions in one message usually get neither answered.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 50 tests: rules, opt-out, signatures, and the pipeline end to end
```

With no configuration, it runs on an in-process Postgres (PGlite, stored in `.data/`) and a **scripted model**. The scripted model makes some deliberate mistakes on first drafts (an invented price, a recited opener) so you can watch the rules catch them.

To have Claude draft the replies instead:

```bash
REPLY_DESK_MODE=anthropic ANTHROPIC_API_KEY=... npm run dev
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `REPLY_DESK_MODE` | `scripted` | `anthropic` to use Claude |
| `REPLY_DESK_MODEL` | `claude-opus-5` | Any current Claude model id |
| `REPLY_DESK_DAILY_BUDGET_USD` | off | Stop calling the model after this much spend per day |
| `WEBHOOK_SECRET` | demo value | Shared secret for webhook signatures |
| `DATABASE_URL` | PGlite | Any Postgres connection string, needed for serverless hosting |

Claude calls use structured output (a JSON schema), low effort, a cached system prompt, and Anthropic's server-side refusal fallback. A refusal or a malformed output never sends anything; it hands over.

## Deploying

PGlite writes to local disk, so serverless hosts need `DATABASE_URL` (Neon's free tier works). For a public demo, keep the scripted model, or set a daily budget together with the per-visitor rate limit in `lib/rate-limit.ts`.

## Built by

[Rexara Digital](https://rexara.digital), a small automation studio in Lagos. All names, numbers and the company in this demo are fictional.
