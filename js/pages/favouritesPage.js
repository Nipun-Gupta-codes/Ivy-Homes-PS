import { loadFavourites, removeFavourite } from '../favourites.js';
import { isLoggedIn } from '../auth.js';
import { formatInr, formatArea } from '../util.js';

// Load listings data from local file for display
let _listingsMap = null;
async function getListingsMap() {
  if (_listingsMap) return _listingsMap;
  try {
    const res = await fetch('/data/listings.json');
    if (res.ok) {
      const data = await res.json();
      _listingsMap = new Map(data.map((l) => [l.listing_id, l]));
      return _listingsMap;
    }
  } catch { /* fall through */ }
  return new Map();
}

export async function renderFavourites(params, app) {
  if (!isLoggedIn()) {
    app.innerHTML = '<div class="notice">Log in to see your saved listings.</div>';
    return;
  }
  app.innerHTML = '<div id="results"><div class="empty">Loading…</div></div>';
  const box = document.getElementById('results');
  try {
    const favs = await loadFavourites(); // returns [{listing_id}, ...]
    if (favs.length === 0) {
      box.innerHTML = '<div class="empty">No saved listings yet. Save some from a listing page or the ☆ button on any row.</div>';
      return;
    }

    // Load listing details from local data to show name, price, etc.
    const listingsMap = await getListingsMap();

    box.innerHTML = '';
    for (const fav of favs) {
      const l = listingsMap.get(fav.listing_id) || { listing_id: fav.listing_id };
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <div class="main">
          <h3><a href="/v1/listings/${encodeURIComponent(l.listing_id)}">${l.apartment_name || l.property_type || l.listing_id}</a></h3>
          <div class="meta">${l.locality || ''} · ${l.bedroom != null ? l.bedroom + ' BHK' : ''} · ${formatArea(l.carpet_area)}</div>
        </div>
        <div class="price">${formatInr(l.price)}</div>
      `;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'save-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = async () => {
        await removeFavourite(l.listing_id);
        row.remove();
        // If no more saved listings, show empty state
        if (!box.querySelector('.list-row')) {
          box.innerHTML = '<div class="empty">No saved listings yet. Save some from a listing page or the ☆ button on any row.</div>';
        }
      };
      row.appendChild(removeBtn);
      box.appendChild(row);
    }
  } catch (err) {
    box.innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}
