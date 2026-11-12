// Content assistant for the Content calendar: captions, reel scripts and monthly idea lists.
//
// How it works (a light RAG - retrieval-augmented generation - over the agency's own data):
//   1. RETRIEVE  facts the model should be grounded in: the client's brand-voice note, the
//                client's business type, and the most relevant PAST APPROVED/POSTED content,
//                found with SQLite full-text search (FTS5, BM25 ranking).
//   2. AUGMENT   put those facts into the prompt, with strict rules (use only what is given,
//                never invent numbers or offers).
//   3. GENERATE  call the LLM through llm.callJson(), which forces valid JSON and logs tokens.
// A person always reviews the result; nothing here saves or posts anything by itself.
const { db } = require('../db');
const { callJson } = require('./llm');

// ---------- retrieval ----------

// FTS5 treats punctuation as query syntax, so turn free text into plain OR-ed word tokens.
function toFtsQuery(text) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g);
  if (!words) return '';
  return [...new Set(words)].slice(0, 12).map((w) => `"${w}"`).join(' OR ');
}

/** Past approved/posted items for this client, most relevant to `query` first. */
function retrieveExamples(clientId, query, limit = 4) {
  const q = toFtsQuery(query);
  const base = `SELECT i.id,i.title,i.kind,i.caption,i.script FROM content_items i
                WHERE i.client_id=? AND i.stage IN ('Approved','Posted') AND i.caption<>''`;
  if (q) {
    const hits = db
      .prepare(
        `SELECT i.id,i.title,i.kind,i.caption,i.script
           FROM content_fts f JOIN content_items i ON i.id=f.rowid
          WHERE content_fts MATCH ? AND i.client_id=? AND i.stage IN ('Approved','Posted') AND i.caption<>''
          ORDER BY bm25(content_fts) LIMIT ?`
      )
      .all(q, clientId, limit);
    if (hits.length) return hits;
  }
  // nothing matched (or no query): fall back to the most recent approved work
  return db.prepare(base + ' ORDER BY i.updated_at DESC LIMIT ?').all(clientId, limit);
}

function recentTitles(clientId, limit = 25) {
  return db.prepare('SELECT title FROM content_items WHERE client_id=? ORDER BY id DESC LIMIT ?').all(clientId, limit).map((r) => r.title);
}

function clientContext(clientId) {
  const c = db.prepare('SELECT id,name,business_type,address,brand_voice FROM clients WHERE id=?').get(clientId);
  if (!c) throw Object.assign(new Error('Client not found'), { status: 404 });
  return c;
}

function describeClient(c) {
  return [
    `Client: ${c.name}`,
    c.business_type ? `Business type: ${c.business_type}` : '',
    c.address ? `Location: ${c.address}` : '',
    c.brand_voice ? `Brand voice (follow this): ${c.brand_voice}` : 'Brand voice: not set - keep a friendly, modern, concise tone.',
  ]
    .filter(Boolean)
    .join('\n');
}

function describeExamples(examples) {
  if (!examples.length) return 'No past approved examples yet.';
  return examples.map((e, i) => `Example ${i + 1} (${e.kind}) - "${e.title}"\nCaption: ${e.caption}`).join('\n\n');
}

// ---------- validators: reject anything not in the shape we asked for ----------

const str = (v, max = 2200) => String(v ?? '').trim().slice(0, max);
const strList = (v, maxItems, maxLen = 140) => (Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);

function validCaption(o) {
  const caption = str(o.caption);
  if (!caption) throw new Error('empty caption');
  return {
    caption,
    hashtags: strList(o.hashtags, 12, 40).map((h) => (h.startsWith('#') ? h : '#' + h.replace(/\s+/g, ''))),
    cta: str(o.cta, 160),
  };
}

function validScript(o) {
  const script = str(o.script, 3000);
  if (!script) throw new Error('empty script');
  return { hook: str(o.hook, 240), script, shots: strList(o.shots, 12, 200), on_screen_text: strList(o.on_screen_text, 8, 80) };
}

const KINDS = ['Reel', 'Post', 'Carousel', 'Story'];
function validIdeas(o) {
  const ideas = (Array.isArray(o.ideas) ? o.ideas : [])
    .map((i) => ({ title: str(i.title, 120), kind: KINDS.includes(i.kind) ? i.kind : 'Reel', hook: str(i.hook, 240), why: str(i.why, 200) }))
    .filter((i) => i.title);
  if (!ideas.length) throw new Error('no ideas');
  return { ideas };
}

// ---------- features ----------

const RULES = `Rules:
- Use ONLY the facts given. Never invent prices, offers, discounts, opening hours, awards or numbers.
- Match the client's brand voice. If past examples are given, echo their style, length and emoji use - but never copy them.
- Write for Instagram. Natural, specific, no generic marketing filler.
- Reply with ONLY one valid JSON object, no markdown fences, no commentary.`;

async function generateCaption({ item, userId }) {
  const c = clientContext(item.client_id);
  const examples = retrieveExamples(c.id, `${item.title} ${item.script || ''}`);
  const system = `You write Instagram captions for Pulse Digital Creations, a content agency for cafes, restaurants and similar local businesses.\n${RULES}\nJSON shape: {"caption": "caption text (may use line breaks and a few emojis)", "hashtags": ["#tag", "...up to 8"], "cta": "one short call to action"}`;
  const user = `${describeClient(c)}\n\nContent piece to write a caption for:\nFormat: ${item.kind}\nTitle: ${item.title}\n${item.script ? 'Script / shot list:\n' + item.script : 'No script written yet.'}\n\nPast approved captions for this client (for style reference):\n${describeExamples(examples)}`;
  const out = await callJson({ feature: 'caption', system, user, validate: validCaption, userId, maxTokens: 700 });
  return { ...out, used_examples: examples.map((e) => ({ id: e.id, title: e.title })) };
}

async function generateScript({ item, userId }) {
  const c = clientContext(item.client_id);
  const examples = retrieveExamples(c.id, item.title);
  const system = `You write short-form video scripts and shot lists for Pulse Digital Creations, a content agency for cafes, restaurants and similar local businesses.\n${RULES}\nJSON shape: {"hook": "first 2 seconds, one line", "script": "voiceover / beat-by-beat plan, plain text", "shots": ["shot 1", "shot 2", "..."], "on_screen_text": ["short text overlay", "..."]}`;
  const user = `${describeClient(c)}\n\nPiece to script:\nFormat: ${item.kind}\nTitle: ${item.title}\n${item.caption ? 'Existing caption: ' + item.caption : ''}\n\nPast approved work for this client (for style reference):\n${describeExamples(examples)}\n\nKeep it shootable by a small team with a phone or one camera. 15-30 seconds for a Reel.`;
  return callJson({ feature: 'script', system, user, validate: validScript, userId, maxTokens: 1200 });
}

async function generateIdeas({ clientId, month, count, theme, userId }) {
  const c = clientContext(clientId);
  const examples = retrieveExamples(c.id, `${theme || ''} ${c.business_type || ''}`, 5);
  const existing = recentTitles(c.id);
  const system = `You plan monthly Instagram content for Pulse Digital Creations, a content agency for cafes, restaurants and similar local businesses.\n${RULES}\nJSON shape: {"ideas": [{"title": "short working title", "kind": "Reel|Post|Carousel|Story", "hook": "the opening line or visual", "why": "one line on why it works"}]}`;
  const user = `${describeClient(c)}\n\nPlan ${count} content ideas for ${month}.${theme ? '\nTheme / focus: ' + theme : ''}\nMix formats (mostly Reels). Make each idea shootable on a small budget.\n\nIdeas already on the calendar - do NOT repeat these:\n${existing.length ? existing.map((t) => '- ' + t).join('\n') : '(none yet)'}\n\nPast approved work (what has been working):\n${describeExamples(examples)}`;
  return callJson({ feature: 'ideas', system, user, validate: validIdeas, userId, maxTokens: 1800 });
}

module.exports = { generateCaption, generateScript, generateIdeas, retrieveExamples, toFtsQuery };
