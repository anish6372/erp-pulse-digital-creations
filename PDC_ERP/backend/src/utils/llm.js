// One shared place that talks to the Anthropic Messages API. Every AI feature goes through
// callJson() so they all get the same guardrails:
//   - retries with backoff on rate limits / temporary server errors
//   - the model's reply must be valid JSON that passes the feature's own validator
//   - every call is logged to ai_usage (tokens per feature/user) so cost is visible
//   - a monthly token cap (AI_MONTHLY_TOKEN_CAP) stops runaway spend
const { db } = require('../db');
const { now } = require('./datetime');

const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages'; // override only for local tests with a mock server

class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const isConfigured = () => !!process.env.ANTHROPIC_API_KEY;

function monthlyTokensUsed() {
  const ym = now().slice(0, 7);
  const r = db.prepare("SELECT COALESCE(SUM(input_tokens + output_tokens),0) t FROM ai_usage WHERE substr(created_at,1,7)=?").get(ym);
  return r.t;
}

function checkBudget() {
  const cap = Number(process.env.AI_MONTHLY_TOKEN_CAP || 0);
  if (cap && monthlyTokensUsed() >= cap) throw new AiError('The monthly AI usage limit has been reached. An admin can raise it.', 429);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The model is told to answer with JSON only, but may still wrap it in ``` fences or add a
// sentence before it - pull out the first {...} block rather than trusting the raw text.
function extractJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * @param {object} o
 * @param {string} o.feature   label stored in ai_usage, e.g. 'caption'
 * @param {string} o.system    system prompt (role + rules)
 * @param {string} o.user      user message (the facts + the task)
 * @param {function} o.validate  (parsed) => cleaned object, or throws if the shape is wrong
 * @param {number} [o.userId]
 * @param {number} [o.maxTokens]
 */
async function callJson({ feature, system, user, validate, userId = null, maxTokens = 1500 }) {
  if (!isConfigured()) throw new AiError('AI is not configured on this server', 400);
  checkBudget();

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(800 * 2 ** attempt);
    let resp;
    try {
      resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
    } catch (e) {
      lastErr = new AiError('Could not reach the AI service');
      continue;
    }
    if (resp.status === 429 || resp.status >= 500) {
      lastErr = new AiError('The AI service is busy, try again in a moment', 503);
      continue;
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new AiError('AI request failed: ' + detail.slice(0, 160), 502);
    }
    const data = await resp.json();
    const usage = data.usage || {};
    db.prepare('INSERT INTO ai_usage(user_id,feature,model,input_tokens,output_tokens,created_at) VALUES (?,?,?,?,?,?)').run(
      userId,
      feature,
      MODEL,
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      now()
    );
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return validate(extractJson(text));
    } catch (e) {
      // A malformed reply is retried once or twice; the model usually gets it right on a re-ask.
      lastErr = new AiError('The AI reply was not in the expected format - try again');
    }
  }
  throw lastErr || new AiError('AI request failed');
}

function usageSummary() {
  const ym = now().slice(0, 7);
  const byFeature = db
    .prepare("SELECT feature, COUNT(*) calls, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens FROM ai_usage WHERE substr(created_at,1,7)=? GROUP BY feature ORDER BY calls DESC")
    .all(ym);
  return { month: ym, tokens_used: monthlyTokensUsed(), cap: Number(process.env.AI_MONTHLY_TOKEN_CAP || 0) || null, by_feature: byFeature };
}

module.exports = { callJson, isConfigured, usageSummary, AiError, MODEL };
