// Automatic lead discovery for Client Hunter's "Hunts" tab: searches Google Maps for a
// niche in a location via Apify's "Google Maps Scraper" actor (compass/crawler-google-places),
// a normal paid Apify actor run - never a direct scrape of Google ourselves. Needs an
// APIFY_TOKEN from the account's own Apify API token; gracefully disabled without one,
// same pattern as the Anthropic and MSG91 integrations elsewhere in this app.
const ACTOR_ID = 'compass~crawler-google-places';

async function searchGoogleMaps({ searchTerm, location, maxResults = 20 }) {
  if (!process.env.APIFY_TOKEN) {
    const err = new Error('Automatic lead discovery is not configured (no Apify token set on the server)');
    err.notConfigured = true;
    throw err;
  }
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(process.env.APIFY_TOKEN)}&timeout=150&maxItems=${maxResults}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      searchStringsArray: [searchTerm],
      locationQuery: location,
      maxCrawledPlacesPerSearch: maxResults,
      language: 'en',
      skipClosedPlaces: true,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    const err = new Error('Apify request failed: ' + (detail.slice(0, 300) || r.statusText));
    throw err;
  }
  const items = await r.json();
  return (Array.isArray(items) ? items : []).map((it) => ({
    name: it.title || it.name || '',
    address: it.address || '',
    website: it.website || '',
    phone: it.phone || it.phoneUnformatted || '',
    rating: it.totalScore ?? it.rating ?? null,
    reviews: it.reviewsCount ?? it.reviews ?? null,
    category: it.categoryName || (Array.isArray(it.categories) ? it.categories[0] : '') || '',
    lat: it.location?.lat ?? null,
    lng: it.location?.lng ?? null,
    place_url: it.url || it.googleMapsUrl || '',
  }));
}

// Only keep a found business if it shows an actual buying signal - a well-established,
// well-reviewed place with a working website isn't a quick-win target, so the hunt
// doesn't just dump every nearby listing into the pipeline.
function huntSignal(place) {
  const reviews = place.reviews;
  if (reviews != null && reviews < 15) return { keep: true, signal_type: 'new_opening', signal_title: `${reviews} Google reviews - opened recently` };
  if (!place.website) return { keep: true, signal_type: 'weak_presence', signal_title: 'No website found on Google' };
  if (reviews != null && reviews < 60) return { keep: true, signal_type: 'low_reviews', signal_title: `${reviews} Google reviews` };
  if (place.rating != null && place.rating < 4.0) return { keep: true, signal_type: 'weak_presence', signal_title: `Google rating ${place.rating}` };
  return { keep: false };
}

module.exports = { searchGoogleMaps, huntSignal };
