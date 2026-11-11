// Turns real, observed signals (never invented ones) into a SWOT + outreach strategy,
// written for Pulse Digital Creations' own sales use - this is the one place in the app
// that calls an external AI model, kept isolated here rather than scattered through routes.
const SYSTEM_PROMPT = `You are a strategist for Pulse Digital Creations, a creative and digital marketing agency specializing in reel/content production, Instagram growth and social media management for cafes, restaurants and similar hospitality businesses.

You will be given real, observed signals about a prospective client's website and Instagram presence. Write a concise, specific SWOT analysis and a tailored outreach strategy that Pulse's sales team can use when pitching this business in person.

Rules:
- Only reference signals actually given to you. Never invent a number, a fact, or a claim that wasn't provided.
- If a signal is missing or unknown, treat it as unknown - don't guess a value or pretend it's absent evidence of a weakness unless that's a reasonable inference (e.g. "no Instagram link found on the website" is a fair observation).
- Be concrete and actionable, not generic marketing platitudes. Reference Pulse's actual services (reel production, content calendars, Instagram audience/reach analytics, client monthly reporting) where relevant.
- Write for someone about to walk into this business and pitch them in person - practical, confident, specific.

Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "strengths": ["short specific point", ...],
  "weaknesses": ["short specific point", ...],
  "opportunities": ["short specific point - what Pulse could do for them", ...],
  "elevator_pitch": "One or two sentences to open the in-person conversation with, referencing something specific and real about this business.",
  "strategy": "A few short paragraphs (plain text, blank line between paragraphs) laying out the tailored growth strategy Pulse would propose, in priority order."
}`;

function buildUserMessage({ business_name, website_url, signals, instagram }) {
  const lines = [`Business: ${business_name}`, website_url ? `Website: ${website_url}` : 'Website: none given', '', 'Website signals observed:', JSON.stringify(signals, null, 2), ''];
  if (instagram?.handle) {
    lines.push(
      'Instagram (entered by hand by the salesperson, who looked at the real profile):',
      `Handle: ${instagram.handle}`,
      instagram.followers !== undefined && instagram.followers !== null && instagram.followers !== '' ? `Followers: ${instagram.followers}` : 'Followers: not noted',
      instagram.last_post ? `Last post date: ${instagram.last_post}` : 'Last post date: not noted',
      instagram.posting_frequency ? `Posting frequency (salesperson's impression): ${instagram.posting_frequency}` : 'Posting frequency: not noted',
      instagram.notes ? `Other notes: ${instagram.notes}` : ''
    );
  } else {
    lines.push('Instagram: not checked / no handle given.');
  }
  return lines.filter(Boolean).join('\n');
}

async function generateProspectStrategy({ business_name, website_url, signals, instagram }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('AI strategy generation is not configured');
    err.notConfigured = true;
    throw err;
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage({ business_name, website_url, signals, instagram }) }],
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    const err = new Error('AI request failed: ' + (detail.slice(0, 200) || r.statusText));
    throw err;
  }
  const data = await r.json();
  const raw = (data.content || []).map((b) => b.text || '').join('').trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // The model didn't return clean JSON - still hand back something usable rather than
    // failing the whole request, since the written content itself is likely still fine.
    return { strengths: [], weaknesses: [], opportunities: [], elevator_pitch: '', strategy: raw };
  }
}

module.exports = { generateProspectStrategy };
