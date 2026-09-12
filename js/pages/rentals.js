import { apiGet } from '../api.js';
import { formatInr, formatArea, formatDate, paginationControls } from '../util.js';

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
    <div id="results"></div>
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
      const body = await apiGet('/v1/rentals', {
        page: state.page,
        limit: state.limit,
        locality: state.locality || undefined,
        bhk: state.bhk || undefined,
      }, { auth: true });
      const results = (body.results || []).filter((r) => {
        if (state.locality && (r.locality || '').toLowerCase() !== state.locality.toLowerCase()) return false;
        if (state.bhk && Number(r.bedroom) !== Number(state.bhk)) return false;
        return true;
      });
      box.innerHTML = results.length === 0 ? '<div class="empty">No rentals match on this page.</div>' : '';
      for (const r of results) {
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
        paginationControls(state.page, body.total, state.limit, (p) => {
          state.page = p;
          load();
        })
      );
    } catch (err) {
      box.innerHTML = `<div class="notice error">${err.message}</div>`;
    }
  }

  load();
}
