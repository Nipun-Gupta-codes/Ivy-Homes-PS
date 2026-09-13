import { apiGet, ApiError } from '../api.js';
import { isFavourited, addFavourite, removeFavourite, loadFavourites } from '../favourites.js';
import { isLoggedIn } from '../auth.js';
import { formatInr, formatArea, formatDate } from '../util.js';

// Cache the full listings array so repeated detail-page visits don't re-fetch.
let _listingsCache = null;

async function getListingsCache() {
  if (_listingsCache) return _listingsCache;
  // Try local data file first (created by fetch-all-data.mjs)
  try {
    const res = await fetch('/data/listings.json');
    if (res.ok) {
      _listingsCache = await res.json();
      return _listingsCache;
    }
  } catch { /* fall through */ }
  return null;
}

// Look up a listing by id. Strategy:
// 1. Try local ./data/listings.json (fastest, offline-capable)
// 2. Try the paginated /v1/listings endpoint as a search fallback
// 3. As last resort, try /v1/listing/{id} (the documented singular endpoint)
async function fetchListing(id) {
  // --- strategy 1: local data file ---
  const local = await getListingsCache();
  if (local) {
    const found = local.find((l) => l.listing_id === id);
    if (found) return found;
  }

  // --- strategy 2: paginated search ---
  // Some APIs let you filter by listing_id. Try it.
  try {
    const body = await apiGet('/v1/listings', { listing_id: id, limit: 1 }, { auth: true });
    if (body.results && body.results.length > 0) return body.results[0];
  } catch { /* fall through */ }

  // --- strategy 3: singular endpoint (documented but may 404) ---
  try {
    return await apiGet(`/v1/listing/${encodeURIComponent(id)}`, {}, { auth: true });
  } catch (err) {
    if (err.status === 404) {
      throw new ApiError(
        `Listing "${id}" not found. The single-listing endpoint /v1/listing/{id} returns 404 on the live API — ` +
        `this is a missing_endpoint finding. Make sure you've run scripts/fetch-all-data.mjs so the local data cache exists.`,
        404
      );
    }
    throw err;
  }
}

export async function renderListingDetail(params, app) {
  const { id } = params;
  const l = await fetchListing(id);

  await loadFavourites();

  app.innerHTML = `
    <a href="/v1/listings" style="font-size:0.85rem;color:var(--ink-soft)">← Back to listings</a>
    <div class="panel" style="margin-top:1rem">
      <div class="detail-grid">
        <div>
          <h2>${l.apartment_name || l.property_type} — ${l.bedroom ?? '?'} BHK</h2>
          <p style="color:var(--ink-soft)">${l.locality || ''} · ${l.property_type || ''}</p>
          <p>${l.description || ''}</p>
          <p style="font-size:0.85rem;color:var(--ink-soft)">
            Contact: ${l.posted_by_name || 'Unknown'} (${l.posted_by || ''}) — ${l.posted_by_contact || 'no contact listed'}
          </p>
          <button class="save-btn ${isFavourited(l.listing_id) ? 'saved' : ''}" id="save-btn">
            ${isFavourited(l.listing_id) ? '★ Saved' : '☆ Save listing'}
          </button>
        </div>
        <dl>
          <dt>Price</dt><dd>${formatInr(l.price)}</dd>
          <dt>Carpet area</dt><dd>${formatArea(l.carpet_area)}</dd>
          <dt>Super built-up</dt><dd>${formatArea(l.super_built_up_area)}</dd>
          <dt>Bathrooms</dt><dd>${l.bathroom ?? '—'}</dd>
          <dt>Balcony</dt><dd>${l.balcony ?? '—'}</dd>
          <dt>Floor</dt><dd>${l.floor ?? '—'} / ${l.total_floors ?? '—'}</dd>
          <dt>Furnishing</dt><dd>${l.furnishing || '—'}</dd>
          <dt>Facing</dt><dd>${l.facing_direction || '—'}</dd>
          <dt>Parking</dt><dd>${l.covered_parking ?? '—'}</dd>
          <dt>Posted</dt><dd>${formatDate(l.posted_at)}</dd>
          <dt>Verified</dt><dd>${l.is_verified ? 'Yes' : 'No'}</dd>
          <dt>Live</dt><dd>${l.is_live ? 'Yes' : 'No'}</dd>
          <dt>Listing ID</dt><dd style="font-size:0.8rem">${l.listing_id}</dd>
          <dt>Project</dt><dd>${l.project_id ? `<a href="/v1/projects/${l.project_id}">${l.project_id}</a>` : '—'}</dd>
        </dl>
      </div>
    </div>
    <h3 style="margin-top:1.5rem">Similar listings</h3>
    <div id="similar"><div class="empty">Loading…</div></div>
  `;

  const saveBtn = document.getElementById('save-btn');
  saveBtn.onclick = async () => {
    if (!isLoggedIn()) {
      location.hash = '#/login';
      return;
    }
    try {
      if (isFavourited(l.listing_id)) {
        await removeFavourite(l.listing_id);
        saveBtn.textContent = '☆ Save listing';
        saveBtn.classList.remove('saved');
      } else {
        await addFavourite(l.listing_id);
        saveBtn.textContent = '★ Saved';
        saveBtn.classList.add('saved');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  // Similar listings — try API first, fall back to local similarity by locality + bedroom
  const similarBox = document.getElementById('similar');
  try {
    let similar = [];
    // Try API endpoint first
    try {
      const similarBody = await apiGet(`/v1/listings/${encodeURIComponent(id)}/similar`, {}, { auth: true });
      similar = similarBody.results || similarBody;
    } catch {
      // Compute similarity locally from cached data
      const allListings = await getListingsCache();
      if (allListings) {
        similar = allListings
          .filter((s) => s.listing_id !== l.listing_id && s.locality === l.locality && s.bedroom === l.bedroom)
          .slice(0, 10);
      }
    }

    if (!similar || similar.length === 0) {
      similarBox.innerHTML = '<div class="empty">No similar listings found.</div>';
    } else {
      similarBox.innerHTML = '';
      for (const s of similar) {
        const row = document.createElement('a');
        row.href = `/v1/listings/${encodeURIComponent(s.listing_id)}`;
        row.className = 'list-row';
        row.innerHTML = `
          <div class="main"><h3>${s.apartment_name || s.property_type}</h3>
          <div class="meta">${s.locality || ''} · ${s.bedroom ?? '?'} BHK</div></div>
          <div class="price">${formatInr(s.price)}</div>
        `;
        similarBox.appendChild(row);
      }
    }
  } catch (err) {
    similarBox.innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}
