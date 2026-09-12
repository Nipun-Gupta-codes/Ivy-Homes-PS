import { apiGet } from '../api.js';
import { formatInr, formatArea, formatDate, paginationControls } from '../util.js';
import { isFavourited, addFavourite, removeFavourite, loadFavourites } from '../favourites.js';
import { isLoggedIn } from '../auth.js';

// Client-side filtering is applied on top of whatever the server returns,
// so filters work correctly even if a given server-side param turns out to be a no-op.
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
    <div id="results"></div>
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
      // Ask the server to filter too (in case the param does work) — client filter is the safety net.
      const body = await apiGet('/v1/listings', {
        page: state.page,
        limit: state.limit,
        locality: state.filters.locality || undefined,
        bhk: state.filters.bhk || undefined,
        min_price: state.filters.min_price || undefined,
        max_price: state.filters.max_price || undefined,
        furnishing: state.filters.furnishing || undefined,
      }, { auth: true });
      const numbered = (body.results || []).map((l, i) => ({ ...l, __n: (state.page - 1) * state.limit + i + 1 }));
      const filtered = applyClientFilters(numbered, state.filters);

      const noFiltersActive = !state.filters.locality && !state.filters.bhk && !state.filters.min_price && !state.filters.max_price && !state.filters.furnishing;
      document.getElementById('total-banner').textContent = noFiltersActive
        ? `The API reports ${body.total.toLocaleString('en-IN')} total listing records with no filters applied — this "total" field on any page answers Q1 directly, no need to page through everything for just that number. (Full pagination is still needed for Q2–Q10, which look at every record's contents — use the Analysis tab for those.)`
        : `${body.total.toLocaleString('en-IN')} records match your current filters (this is filtered, not the Q1 answer — clear filters to see the unfiltered total).`;

      if (isLoggedIn()) {
        try { await loadFavourites(); } catch { /* non-fatal, save buttons just start unstarred */ }
      }

      if (filtered.length === 0) {
        resultsBox.innerHTML = '<div class="empty">No listings match your filters on this page. Try Next, or widen your filters.</div>';
      } else {
        resultsBox.innerHTML = '';
        for (const l of filtered) {
          const row = document.createElement('a');
          row.href = `#/listings/${encodeURIComponent(l.listing_id)}`;
          row.className = 'list-row';
          row.innerHTML = `
            <div class="main">
              <h3><span style="color:var(--ink-soft);font-weight:400">#${l.__n}</span> ${l.apartment_name || l.property_type} — ${l.bedroom ?? '?'} BHK</h3>
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
              location.hash = '#/login';
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
        }
      }
      resultsBox.appendChild(
        paginationControls(state.page, body.total, state.limit, (p) => {
          state.page = p;
          load();
        })
      );
    } catch (err) {
      resultsBox.innerHTML = `<div class="notice error">${err.message}</div>`;
    }
  }

  load();
}
