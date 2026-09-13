import { apiGet } from '../api.js';
import { formatInr, formatArea, formatDate, paginationControls } from '../util.js';

function dedup(arr, keyField) {
  const seen = new Set();
  return arr.filter((item) => {
    const k = item[keyField];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

let cachedRentals = null;

async function fetchRentalsList() {
  if (cachedRentals && cachedRentals.length > 0) return cachedRentals;

  try {
    const res = await fetch('/data/rentals.json');
    if (res.ok) {
      const data = await res.json();
      cachedRentals = dedup(data, 'listing_id');
      return cachedRentals;
    }
  } catch { /* fall through */ }

  try {
    const body = await apiGet('/v1/rentals', { limit: 200 }, { auth: true });
    cachedRentals = dedup(body.results || [], 'listing_id');
    return cachedRentals;
  } catch (err) {
    if (cachedRentals) return cachedRentals;
    throw err;
  }
}

export async function renderRentals(params, app) {
  const state = { page: 1, limit: 20, locality: '', bhk: '' };

  app.innerHTML = `
    <div class="filters">
      <input type="text" id="f-locality" placeholder="Locality (e.g. madhapur)" />
      <select id="f-bhk">
        <option value="">Any BHK</option>
        <option value="1">1 BHK</option>
        <option value="2">2 BHK</option>
        <option value="3">3 BHK</option>
      </select>
      <button id="apply">Apply</button>
    </div>
    <div id="results"><div class="empty">Loading…</div></div>
  `;

  document.getElementById('apply').onclick = () => {
    state.locality = document.getElementById('f-locality').value.trim();
    state.bhk = document.getElementById('f-bhk').value;
    state.page = 1;
    load();
  };

  async function load() {
    const box = document.getElementById('results');
    box.innerHTML = '<div class="empty">Loading…</div>';

    try {
      const allRentals = await fetchRentalsList();
      const filtered = allRentals.filter((r) => {
        if (state.locality && (r.locality || '').toLowerCase() !== state.locality.toLowerCase()) return false;
        if (state.bhk && Number(r.bedroom) !== Number(state.bhk)) return false;
        return true;
      });

      const total = filtered.length;
      const start = (state.page - 1) * state.limit;
      const end = Math.min(start + state.limit, total);
      const pageItems = filtered.slice(start, end);

      if (pageItems.length === 0) {
        box.innerHTML = '<div class="empty">No rentals match your criteria.</div>';
        return;
      }

      box.innerHTML = '';
      for (const r of pageItems) {
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `
          <div class="main">
            <h3>${r.title || r.apartment_name}</h3>
            <div class="meta">
              <span class="tag">${r.locality || ''}</span>
              <span class="tag">${r.furnishing || ''}</span>
              Posted ${formatDate(r.posted_at)} · Deposit ${formatInr(r.deposit)}
            </div>
          </div>
          <div class="price">${formatInr(r.price)}/mo<small>${formatArea(r.carpet_area)}</small></div>
        `;
        box.appendChild(row);
      }

      box.appendChild(
        paginationControls(state.page, total, state.limit, (p) => {
          state.page = p;
          load();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
    } catch (err) {
      box.innerHTML = `<div class="notice error">${err.message}</div>`;
    }
  }

  load();
}
