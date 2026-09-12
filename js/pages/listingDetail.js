import { apiGet } from '../api.js';
import { isFavourited, addFavourite, removeFavourite, loadFavourites } from '../favourites.js';
import { isLoggedIn } from '../auth.js';
import { formatInr, formatArea, formatDate } from '../util.js';

export async function renderListingDetail(params, app) {
  const { id } = params;
  const l = await apiGet(`/v1/listing/${encodeURIComponent(id)}`, {}, { auth: true });

  if (isLoggedIn()) {
    try { await loadFavourites(); } catch { /* non-fatal */ }
  }

  app.innerHTML = `
    <a href="#/listings" style="font-size:0.85rem;color:var(--ink-soft)">← Back to listings</a>
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
          <dt>Listing ID</dt><dd style="font-size:0.8rem">${l.listing_id}</dd>
          <dt>Project</dt><dd>${l.project_id ? `<a href="#/projects/${l.project_id}">${l.project_id}</a>` : '—'}</dd>
        </dl>
      </div>
    </div>
    <h3 style="margin-top:1.5rem">Similar listings</h3>
    <div id="similar"></div>
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

  try {
    const similarBody = await apiGet(`/v1/listings/${encodeURIComponent(id)}/similar`, {}, { auth: true });
    const similar = similarBody.results || similarBody; // tolerate either shape
    const box = document.getElementById('similar');
    if (!similar || similar.length === 0) {
      box.innerHTML = '<div class="empty">No similar listings found.</div>';
    } else {
      box.innerHTML = '';
      for (const s of similar) {
        const row = document.createElement('a');
        row.href = `#/listings/${encodeURIComponent(s.listing_id)}`;
        row.className = 'list-row';
        row.innerHTML = `
          <div class="main"><h3>${s.apartment_name || s.property_type}</h3>
          <div class="meta">${s.locality || ''} · ${s.bedroom ?? '?'} BHK</div></div>
          <div class="price">${formatInr(s.price)}</div>
        `;
        box.appendChild(row);
      }
    }
  } catch (err) {
    document.getElementById('similar').innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}
