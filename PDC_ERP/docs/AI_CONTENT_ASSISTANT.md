# AI Content Assistant - how it works

A feature of the Content calendar that helps the team write **captions**, **reel scripts / shot
lists**, and a month of **content ideas** per client, using an LLM (Anthropic Claude) grounded in
the agency's own data. A person reviews every output; nothing is saved or posted automatically.

## The 30-second explanation (interview version)

> "I added an AI assistant to our content workflow. It calls Claude through the API, but I
> don't just send a bare prompt. Before generating, the app retrieves the client's brand-voice
> note and that client's past approved captions - found with SQLite full-text search, BM25
> ranked - and puts them in the prompt. That's a lightweight RAG, so the output matches the
> client and doesn't invent facts. The model must reply in JSON, which I validate and retry;
> every call is logged for token usage, there's a monthly cap and rate limits, and a human
> always edits and approves before anything is saved."

## Architecture

```
Browser (Content calendar)                 Backend (Express)                         External
 ┌──────────────────────┐   POST /api/content/ai/caption|script|ideas
 │ "Write with AI"      │ ───────────────────────────────►  routes/content.routes.js
 │ "AI ideas"           │                                    │ auth + rate limit (60/hr)
 └──────────────────────┘                                    ▼
          ▲                                          utils/contentAI.js
          │ draft text (user edits, then Save)         1. RETRIEVE  client brand voice (SQLite)
          │                                                         past approved items (FTS5/BM25)
          │                                            2. AUGMENT   build prompt + strict rules
          │                                            3. GENERATE  ───► utils/llm.js ──────────► Anthropic API
          │                                                              retries, JSON parse,        (Claude)
          └──────────────────────────────────────────────────────────── validate, log tokens ◄────
```

## What each file does

| File | Role |
| --- | --- |
| `backend/src/utils/llm.js` | The one place that calls the Anthropic API. Retries with backoff on 429/5xx, extracts and parses JSON (even if wrapped in ``` fences), runs the feature's validator, logs tokens to `ai_usage`, enforces `AI_MONTHLY_TOKEN_CAP`. |
| `backend/src/utils/contentAI.js` | The feature logic: retrieval (`retrieveExamples`), prompt building, and the three generators `generateCaption`, `generateScript`, `generateIdeas`, each with an output validator. |
| `backend/src/routes/content.routes.js` | HTTP endpoints `/api/content/ai/caption`, `/script`, `/ideas`, `/status`. Auth, rate limiting, input checks. |
| `backend/src/db/index.js` | Adds `clients.brand_voice`, the `ai_usage` table, and the `content_fts` full-text index with triggers that keep it in sync. |
| `frontend/src/pages/content.js` | "Write with AI" buttons on a content card, the "AI ideas" dialog, and an admin usage line. |
| `frontend/src/components/modals.js` | The "Brand voice" field on the client form. |

## The key ideas, explained

**LLM call.** A request to Claude's Messages API with a *system prompt* (role + rules) and a
*user message* (the facts and the task). The reply is text; we ask for JSON.

**RAG (retrieval-augmented generation).** An LLM only knows its training data, not your
clients. RAG fixes that: *retrieve* relevant facts from your own data, *augment* the prompt with
them, then *generate*. Here the retrieved facts are the client's brand voice and their past
approved captions. This is why outputs sound like the client, and why the model doesn't have to
guess.

**Retrieval with SQLite FTS5.** `content_fts` is a full-text index over each item's title,
caption and script. `bm25()` ranks matches by relevance. I turn the new item's title/script into
an OR-ed list of words, query the index for *that client's approved or posted items*, and take the
top 4. If nothing matches it falls back to the most recent approved work. It's keyword search,
not embeddings - no extra database or service, and easy to explain. (A vector/embeddings
approach would be the next step if keyword matching stops being enough.)

**Keeping the index in sync.** Three SQL triggers (insert/update/delete on `content_items`)
mirror every change into `content_fts`, and a one-time backfill indexes existing rows.

**Prompt design.** Strict rules in the system prompt: use only the given facts, never invent
prices/offers/numbers, match the brand voice, reply with one JSON object. The user message
contains only retrieved/real facts plus the task.

**Structured output + validation.** Models sometimes wrap JSON in fences or add a sentence.
`extractJson` pulls the first `{...}` block; each feature's validator checks the shape, trims
lengths, drops empty items, normalises hashtags. If it fails, the call is retried (up to 3
attempts).

**Guardrails and cost control.** Per-hour rate limit on the AI endpoints; every call logs
`input_tokens`/`output_tokens` per feature and user in `ai_usage`; an optional monthly token cap
(`AI_MONTHLY_TOKEN_CAP`) stops runaway spend; admins see usage on the Content page.

**Human in the loop.** The UI puts the AI output into the editable caption/script box (appended
under an "AI draft" divider, never overwriting what someone typed). Ideas are shown with
checkboxes and only become cards when the user confirms. Final content still goes through the
existing client-review flow.

## Configuration

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required to enable the feature (already used by Client Hunter). |
| `AI_MODEL` | Optional. Defaults to `claude-sonnet-5-5`. |
| `AI_MONTHLY_TOKEN_CAP` | Optional. Total input+output tokens allowed per calendar month; unset = no cap. |

## How it was tested

A local mock of the Anthropic API returned fixed JSON (once wrapped in fences). Verified:
retrieval returned the client's past approved caption and put it in the prompt together with the
brand voice; JSON parsing and validation worked; a missing title returns a clear 400; tokens were
logged per feature; and in the browser the buttons filled the caption/script fields and "Add
selected as Idea cards" created the cards.

## Honest limitations (good to say in an interview)

- Retrieval is keyword-based (BM25), so it won't match synonyms ("iced coffee" vs "cold brew")
  the way embeddings would.
- No automatic quality evaluation yet - quality is checked by the human reviewing each draft. A
  small set of saved test prompts with expected traits would be the next step.
- Token counts are logged, not converted to money, because prices change.
- English output only; tone depends on how good the client's brand-voice note is.

## Questions you might be asked

- *Why RAG instead of fine-tuning?* Client data changes daily and is small; retrieval is cheap,
  updates instantly, and is explainable. Fine-tuning is costly and stale quickly.
- *Why FTS5 and not a vector database?* Data is small, keyword overlap is strong for captions
  within one client, and it adds zero infrastructure. Embeddings are a later upgrade.
- *How do you stop hallucinations?* Ground the prompt in real data, forbid inventing facts,
  keep outputs short and structured, and require human review.
- *How do you control cost?* Rate limits, a monthly token cap, per-feature usage logging, a
  small `max_tokens` per call.
- *What happens if the API is down or returns junk?* Retries with backoff, clear error to the
  user, nothing is saved.
