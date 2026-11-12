// Static reference data + the fit/need/intent/reach scoring formula for the Client Hunter
// module - ported from the "Pulse Client Hunter" prototype's scoring logic, adapted to
// run here against real, hand-entered or fetched channel signals (never invented ones).

const NICHES = {
  dental: { label: 'Dental clinics', tier: 1, services: ['Google ads', 'Google Business Profile optimisation', 'Personal branding'] },
  salon_spa: { label: 'Spas & salons', tier: 1, services: ['Content creation', 'Model shoots', 'Meta ads'] },
  cafe_restaurant: { label: 'Cafes & restaurants', tier: 1, services: ['Content creation', 'Influencer marketing', 'Meta ads'] },
  saas: { label: 'SaaS products', tier: 2, services: ['Personal branding', 'Cinematic video production', 'Lead generation'] },
  jewellery: { label: 'Jewellery brands', tier: 2, services: ['Product shoots', 'Model shoots', 'Meta ads'] },
  automobile: { label: 'Automobile', tier: 3, services: ['Car and bike delivery shoots', 'OOH activations', 'Lead generation'] },
  interior_design: { label: 'Interior design', tier: 3, services: ['Cinematic video production', 'Meta ads', 'Personal branding'] },
  other: { label: 'Other', tier: 3, services: ['Content creation', 'Meta ads'] },
};

// Real coordinates (approximate city centre), used to plot the Market tab's map - not
// fictional positions, just city-level rather than per-business.
const CITIES = {
  Bangalore: { priority: 1, lat: 12.97, lng: 77.59 },
  Mumbai: { priority: 2, lat: 19.08, lng: 72.88 },
  'Delhi NCR': { priority: 2, lat: 28.61, lng: 77.21 },
  Hyderabad: { priority: 2, lat: 17.38, lng: 78.49 },
  Pune: { priority: 2, lat: 18.52, lng: 73.86 },
  Chennai: { priority: 2, lat: 13.08, lng: 80.27 },
  Dubai: { priority: 3, lat: 25.2, lng: 55.27 },
  Singapore: { priority: 3, lat: 1.35, lng: 103.82 },
  London: { priority: 3, lat: 51.51, lng: -0.13 },
};
const PRIORITY = { 1: { label: 'Bangalore', weight: 1.0 }, 2: { label: 'Pan India', weight: 0.85 }, 3: { label: 'Global', weight: 0.7 } };
const priorityOf = (city) => CITIES[city]?.priority || 2;

const SIGNALS = {
  agency_request: { label: 'Asked for an agency', weight: 100 },
  referral: { label: 'Referral', weight: 90 },
  new_opening: { label: 'New opening', weight: 90 },
  funding: { label: 'Funding round', weight: 85 },
  hiring_marketer: { label: 'Hiring a marketer', weight: 85 },
  launch: { label: 'Launch', weight: 75 },
  low_reviews: { label: 'Few reviews', weight: 50 },
  manual: { label: 'Found by team', weight: 50 },
  weak_presence: { label: 'Weak online presence', weight: 40 },
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const clamp5 = (n) => Math.max(1, Math.min(5, Math.round(n)));

function fitScore(niche, city) {
  const tier = NICHES[niche]?.tier || 3;
  const base = tier === 1 ? 100 : tier === 2 ? 75 : 55;
  const weight = PRIORITY[priorityOf(city)].weight;
  return clamp(city ? base * weight : base * 0.8 * weight);
}

function intentScore(signalAt, signalType) {
  if (!signalAt) return 0;
  const days = (Date.now() - new Date(signalAt).getTime()) / 86400000;
  const weight = SIGNALS[signalType]?.weight ?? 30;
  return clamp(weight * Math.max(0, 1 - days / 60));
}

function reachScore({ email, instagram, linkedin, phone } = {}) {
  if (email && instagram) return 100;
  if (email) return 70;
  if (instagram || linkedin) return 55;
  if (phone) return 40;
  return 10;
}

// Lower channel scores (1-5, weak presence) mean more need for Pulse's services.
function needScore(channels = {}) {
  const vals = Object.values(channels)
    .map((c) => c?.score)
    .filter((s) => s != null);
  if (!vals.length) return 50;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return clamp(((5 - avg) / 4) * 100);
}

const WEIGHTS = { fit: 0.25, need: 0.3, intent: 0.3, reach: 0.15 };
const tierFor = (score, reach) => (score >= 70 && reach >= 45 ? 'hot' : score >= 45 ? 'warm' : 'parked');

function computeScore({ niche, city, channels, signalAt, signalType, contacts }) {
  const fit = fitScore(niche, city);
  const need = needScore(channels);
  const intent = intentScore(signalAt, signalType);
  const reach = reachScore(contacts);
  const score = clamp(fit * WEIGHTS.fit + need * WEIGHTS.need + intent * WEIGHTS.intent + reach * WEIGHTS.reach);
  return { fit, need, intent, reach, score, tier: tierFor(score, reach) };
}

// ---- per-channel audits ----

function websiteChannelScore(sig) {
  if (!sig || sig.reachable === false) return { score: 1, status: 'missing', evidence: [sig?.note || 'No website, or it could not be reached'] };
  let score = 3;
  const ev = [];
  if (sig.is_https) ev.push('Uses HTTPS');
  else {
    score -= 0.5;
    ev.push('Not using HTTPS');
  }
  if (sig.has_mobile_viewport_tag) ev.push('Mobile-ready');
  else {
    score -= 0.5;
    ev.push('No mobile viewport tag');
  }
  if (sig.links_instagram || sig.links_facebook || sig.links_whatsapp) ev.push('Links to social / WhatsApp');
  else {
    score -= 0.5;
    ev.push('No social or WhatsApp links found');
  }
  if (sig.has_contact_info) ev.push('Contact info visible');
  else {
    score -= 0.5;
    ev.push('No visible contact info');
  }
  return { score: clamp5(score), status: 'active', evidence: ev };
}

function instagramChannelScore({ followers, lastPostDays, postingFrequency } = {}) {
  if (lastPostDays == null) return { score: null, status: 'unknown', evidence: [] };
  let score;
  const ev = [];
  if (lastPostDays > 60) {
    score = 1;
    ev.push(`Last post ${lastPostDays} days ago`);
  } else if (lastPostDays > 14) {
    score = 2;
    ev.push(`Last post ${lastPostDays} days ago`);
  } else {
    score = 4;
    ev.push(`Last post ${lastPostDays} days ago`);
  }
  if (followers != null && followers !== '') ev.unshift(`${followers} followers`);
  if (postingFrequency) ev.push(postingFrequency);
  return { score, status: 'checked', evidence: ev };
}

function gmbChannelScore({ rating, reviews } = {}) {
  if ((rating == null || rating === '') && (reviews == null || reviews === '')) return { score: null, status: 'unknown', evidence: [] };
  const r = Number(reviews) || 0;
  let score = r < 15 ? 2 : r < 60 ? 3 : Number(rating) >= 4.5 && r >= 150 ? 5 : 4;
  const ev = [`Google: ${rating ?? '—'} from ${r} reviews`];
  if (rating != null && rating !== '' && Number(rating) < 4) {
    score = Math.max(1, score - 1);
    ev.push('Rating under 4.0 hurts map ranking');
  }
  return { score: Math.max(1, score), status: 'checked', evidence: ev };
}

// ---- market sizing: an illustrative estimate from category benchmarks, never live data ----

const MARKET_MODEL = {
  dental: { label: 'Dental clinics', baseSpend: 90000, growth: 0.18, agenciesPerCity: 15, pitch: 'Google ads + doctor personal branding' },
  salon_spa: { label: 'Spas & salons', baseSpend: 70000, growth: 0.14, agenciesPerCity: 20, pitch: 'Model shoots + click-to-WhatsApp ads' },
  cafe_restaurant: { label: 'Cafes & restaurants', baseSpend: 60000, growth: 0.1, agenciesPerCity: 25, pitch: 'Reels + influencer nights' },
  saas: { label: 'SaaS products', baseSpend: 320000, growth: 0.22, agenciesPerCity: 10, pitch: 'Founder branding + explainer films' },
  jewellery: { label: 'Jewellery brands', baseSpend: 240000, growth: 0.08, agenciesPerCity: 8, pitch: 'Product + model shoots' },
  automobile: { label: 'Automobile', baseSpend: 280000, growth: 0.12, agenciesPerCity: 6, pitch: 'Delivery shoots + launch OOH' },
  interior_design: { label: 'Interior design', baseSpend: 150000, growth: 0.1, agenciesPerCity: 12, pitch: 'Walkthrough films + before/after reels' },
  other: { label: 'Other', baseSpend: 80000, growth: 0.1, agenciesPerCity: 15, pitch: 'Content creation + Meta ads' },
};

function estimateMarket({ niche, city, months = 2 }) {
  const m = MARKET_MODEL[niche] || MARKET_MODEL.other;
  const priority = priorityOf(city);
  const weight = PRIORITY[priority].weight;
  const businessesBuying = Math.round(30 * weight);
  const agencies = Math.round(m.agenciesPerCity * weight);
  const avgProjectValue = Math.round(m.baseSpend * weight);
  const projectsPerMonth = Math.round(businessesBuying * 0.8);
  const monthlySpend = avgProjectValue * projectsPerMonth;
  const upForGrabsSpend = Math.round(monthlySpend * 0.35);
  const periodMonths = Math.max(1, Number(months) || 2);
  return {
    niche,
    niche_label: m.label,
    city: city || null,
    priority,
    priority_label: PRIORITY[priority].label,
    period_months: periodMonths,
    agencies_estimate: agencies,
    businesses_buying_estimate: businessesBuying,
    projects_estimate: projectsPerMonth * periodMonths,
    monthly_spend_estimate: monthlySpend,
    avg_project_value_estimate: avgProjectValue,
    up_for_grabs_monthly_estimate: upForGrabsSpend,
    growth_pct: Math.round(m.growth * 100),
    suggested_pitch: m.pitch,
  };
}

module.exports = {
  NICHES,
  CITIES,
  PRIORITY,
  SIGNALS,
  priorityOf,
  computeScore,
  websiteChannelScore,
  instagramChannelScore,
  gmbChannelScore,
  MARKET_MODEL,
  estimateMarket,
};
