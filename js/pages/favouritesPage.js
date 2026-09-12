import { apiGet } from '../api.js';
import { removeFavourite } from '../favourites.js';
import { isLoggedIn } from '../auth.js';
import { formatInr, formatArea } from '../util.js';

export async function renderFavourites(params, app) {
  if (!isLoggedIn()) {
    app.innerHTML = '<div class="notice">Log in to see your saved listings.</div>';
    return;
  }
  app.innerHTML = '<div id="results"><div class="empty">Loading…</div></div>';
  const box = document.getElementById('results');
  try {
    const body = await apiGet('/v1/favourites', {}, { auth: true });
    const results = body.results || [];
    if (results.length === 0) {
      box.innerHTML = '<div class="empty">No saved listings yet. Save some from a listing page or the ☆ button on any row.</div>';
      return;
    }
    box.innerHTML = '';
    for (const l of results) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <div class="main">
          <h3><a href="#/listings/${encodeURIComponent(l.listing_id)}">${l.apartment_name || l.property_type}</a></h3>
          <div class="meta">${l.locality || ''} · ${l.bedroom ?? '?'} BHK · ${formatArea(l.carpet_area)}</div>
        </div>
        <div class="price">${formatInr(l.price)}</div>
      `;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'save-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = async () => {
        await removeFavourite(l.listing_id);
        row.remove();
      };
      row.appendChild(removeBtn);
      box.appendChild(row);
    }
  } catch (err) {
    if (err.status === 404) {
      box.innerHTML = `<div class="notice error">
        GET /v1/favourites returned 404 (Not Found) — the endpoint documented in API_REFERENCE.md doesn't exist at that path on the live API.
        Open DevTools → Network and try the request manually with a slightly different path (e.g. singular <code>/v1/favourite</code>, or under <code>/v1/user/favourites</code>) to find where it actually lives, then tell me the working path and I'll fix the code.
        This is itself worth a <code>missing_endpoint</code> finding for your submission either way.
      </div>`;
    } else {
      box.innerHTML = `<div class="notice error">${err.message}</div>`;
    }
  }
}
