import { apiGet } from '../api.js';
import { formatInr, formatArea, formatDate, paginationControls } from '../util.js';
import { isFavourited, addFavourite, removeFavourite, loadFavourites } from '../favourites.js';
import { isLoggedIn } from '../auth.js';
import { navigate } from '../router.js';

function dedup(arr, keyField) {
  const seen = new Set();
  return arr.filter((item) => {
    const k = item[keyField];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function applyClientFilters(results, filters) {
  return results.filter((l) => {
    if (filters.locality && (l.locality || '').toLowerCase() !== filters.locality.toLowerCase()) return false;
    if (filters.bhk && Number(l.bedroom) !== Number(filters.bhk)) return false;
    if (filters.min_price && Number(l.price) < Number(filters.min_price)) return false;
    if (filters.max_price && Number(l.price) > Number(filters.max_price)) return false;
    if (filters.furnishing && (l.furnishing || '').toLowerCase() !== filters.furnishing.toLowerCase()) return false;
    return true;
  });
}

let cachedListings = null;

async function fetchListingsList() {
  if (cachedListings && cachedListings.length > 0) return cachedListings;

  try {
    const res = await fetch('/data/listings.json');
    if (res.ok) {
      const data = await res.json();
      cachedListings = dedup(data, 'listing_id');
      return cachedListings;
    }
  } catch { /* fall through */ }

  try {
    const body = await apiGet('/v1/listings', { limit: 200 }, { auth: true });
    cachedListings = dedup(body.results || [], 'listing_id');
    return cachedListings;
  } catch (err) {
    if (cachedListings) return cachedListings;
    throw err;
  }
}

export async function renderListings(params, app) {
  const state = { page: 1, limit: 20, filters: {} };

  app.innerHTML = `
    <div id="total-banner" class="notice"></div>
    <div class="filters" id="filters">
      <input type="text" id="f-locality" placeholder="Locality (e.g. madhapur)" />
      <select id="f-bhk">
        <option value="">Any BHK</option>
        <option value="1">1 BHK</option>
        <option value="2">2 BHK</option>
        <option value="3">3 BHK</option>
        <option value="4">4 BHK</option>
      </select>
      <input type="number" id="f-min" placeholder="Min price" />
      <input type="number" id="f-max" placeholder="Max price" />
      <select id="f-furnishing">
        <option value="">Any furnishing</option>
        <option value="unfurnished">Unfurnished</option>
        <option value="semi-furnished">Semi-furnished</option>
        <option value="fully-furnished">Fully-furnished</option>
      </select>
      <button id="apply-filters">Apply</button>
    </div>
    <div id="results"><div class="empty">Loading…</div></div>
  `;

  document.getElementById('apply-filters').onclick = () => {
    state.filters = {
      locality: document.getElementById('f-locality').value.trim(),
      bhk: document.getElementById('f-bhk').value,
      min_price: document.getElementById('f-min').value,
      max_price: document.getElementById('f-max').value,
      furnishing: document.getElementById('f-furnishing').value,
    };
    state.page = 1;
    load();
  };

  async function load() {
    const resultsBox = document.getElementById('results');
    resultsBox.innerHTML = '<div class="empty">Loading…</div>';

    try {
      const allListings = await fetchListingsList();
      const filtered = applyClientFilters(allListings, state.filters);

      const noFiltersActive = !state.filters.locality && !state.filters.bhk && !state.filters.min_price && !state.filters.max_price && !state.filters.furnishing;
      document.getElementById('total-banner').textContent = noFiltersActive
        ? `Showing ${allListings.length.toLocaleString('en-IN')} unique listings (unfiltered). The API returns ~81× duplicates in raw pagination.`
        : `${filtered.length.toLocaleString('en-IN')} unique listings match your current filters.`;

      if (isLoggedIn()) {
        try { await loadFavourites(); } catch { /* non-fatal */ }
      }

      const total = filtered.length;
      const start = (state.page - 1) * state.limit;
      const end = Math.min(start + state.limit, total);
      const pageItems = filtered.slice(start, end);

      if (pageItems.length === 0) {
        resultsBox.innerHTML = '<div class="empty">No listings match your filters. Try widening your filters.</div>';
        return;
      }

      resultsBox.innerHTML = '';
      pageItems.forEach((l, i) => {
        const itemNumber = start + i + 1;
        const row = document.createElement('a');
        row.href = `/v1/listings/${encodeURIComponent(l.listing_id)}`;
        row.className = 'list-row';
        row.innerHTML = `
          <div class="main">
            <h3><span style="color:var(--ink-soft);font-weight:400">#${itemNumber}</span> ${l.apartment_name || l.property_type} — ${l.bedroom ?? '?'} BHK</h3>
            <div class="meta">
              <span class="tag">${l.locality || ''}</span>
              <span class="tag">${l.property_type || ''}</span>
              <span class="tag">${l.furnishing || ''}</span>
              Posted ${formatDate(l.posted_at)}
            </div>
          </div>
          <div class="price">${formatInr(l.price)}<small>${formatArea(l.carpet_area)}</small></div>
        `;

        const saveBtn = document.createElement('button');
        saveBtn.className = `save-btn ${isFavourited(l.listing_id) ? 'saved' : ''}`;
        saveBtn.style.marginLeft = '0.75rem';
        saveBtn.textContent = isFavourited(l.listing_id) ? '★' : '☆';
        saveBtn.title = isFavourited(l.listing_id) ? 'Remove from saved' : 'Save this listing';
        saveBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isLoggedIn()) {
            navigate('/v1/login');
            return;
          }
          try {
            if (isFavourited(l.listing_id)) {
              await removeFavourite(l.listing_id);
              saveBtn.textContent = '☆';
              saveBtn.classList.remove('saved');
              saveBtn.title = 'Save this listing';
            } else {
              await addFavourite(l.listing_id);
              saveBtn.textContent = '★';
              saveBtn.classList.add('saved');
              saveBtn.title = 'Remove from saved';
            }
          } catch (err) {
            alert(err.message);
          }
        };
        row.querySelector('.price').appendChild(saveBtn);
        resultsBox.appendChild(row);
      });

      resultsBox.appendChild(
        paginationControls(state.page, total, state.limit, (p) => {
          state.page = p;
          load();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
    } catch (err) {
      resultsBox.innerHTML = `<div class="notice error">${err.message}</div>`;
    }
  }

  load();
}
