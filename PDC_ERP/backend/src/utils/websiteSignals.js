// Fetches a prospect's own public homepage and reads a handful of plain, observable
// signals from the raw HTML - this is a normal browser-style GET request to a page meant
// to be publicly viewed, not scraping a service that restricts automated access (unlike
// Instagram, which explicitly prohibits this for non-authorized apps).
async function analyzeWebsite(url) {
  if (!url) return { reachable: false, note: 'No website URL given' };
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(target, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PDC-ProspectTool/1.0)' } });
    clearTimeout(timeout);
    const html = await r.text();
    const lower = html.toLowerCase();
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);

    return {
      reachable: r.ok,
      status_code: r.status,
      final_url: r.url,
      is_https: r.url.startsWith('https://'),
      title: titleMatch ? titleMatch[1].trim().slice(0, 150) : null,
      has_mobile_viewport_tag: /<meta[^>]+name=["']viewport["']/i.test(html),
      has_meta_description: /<meta[^>]+name=["']description["']/i.test(html),
      links_instagram: /instagram\.com\//i.test(html),
      links_facebook: /facebook\.com\//i.test(html),
      links_whatsapp: /wa\.me\/|api\.whatsapp\.com/i.test(html),
      mentions_online_ordering: /order\s*(now|online)|swiggy\.com|zomato\.com/i.test(lower),
      has_menu_reference: /\bmenu\b/i.test(lower),
      has_contact_info: /tel:|mailto:|\+?\d[\d\s-]{8,}\d/.test(html),
      has_blog: /\bblog\b/i.test(lower),
      approx_word_count: text.split(' ').filter(Boolean).length,
    };
  } catch (e) {
    clearTimeout(timeout);
    return { reachable: false, note: e.name === 'AbortError' ? 'Website took too long to respond (timed out)' : 'Could not reach this website' };
  }
}

module.exports = { analyzeWebsite };
