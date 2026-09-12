import { apiGet } from '../api.js';
import { formatInr, formatArea, paginationControls } from '../util.js';

export async function renderProjects(params, app) {
  const state = { page: 1, limit: 20 };

  app.innerHTML = `<div id="results"></div>`;

  async function load() {
    const box = document.getElementById('results');
    box.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const body = await apiGet('/v1/projects', { page: state.page, limit: state.limit }, { auth: true });
      box.innerHTML = '';
      for (const p of body.results || []) {
        const row = document.createElement('a');
        row.href = `#/projects/${encodeURIComponent(p.project_id)}`;
        row.className = 'list-row';
        row.innerHTML = `
          <div class="main">
            <h3>${p.apartment_name}</h3>
            <div class="meta">
              <span class="tag">${p.locality || ''}</span>
              <span class="tag">${p.project_status || ''}</span>
              ${p.developer_name || ''} · ${p.total_units ?? '?'} units · ${p.total_listings ?? 0} listings
            </div>
          </div>
          <div class="price">${formatInr(p.price_min)}–${formatInr(p.price_max)}</div>
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

export async function renderProjectDetail(params, app) {
  const { id } = params;
  const p = await apiGet(`/v1/projects/${encodeURIComponent(id)}`, {}, { auth: true });
  app.innerHTML = `
    <a href="#/projects" style="font-size:0.85rem;color:var(--ink-soft)">← Back to projects</a>
    <div class="panel" style="margin-top:1rem">
      <h2>${p.apartment_name}</h2>
      <p style="color:var(--ink-soft)">${p.developer_name} · ${p.locality} · ${p.project_status}</p>
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 1rem;font-size:0.9rem;max-width:480px">
        <dt>Price range</dt><dd>${formatInr(p.price_min)} – ${formatInr(p.price_max)}</dd>
        <dt>Area range</dt><dd>${formatArea(p.min_area_sqft)} – ${formatArea(p.max_area_sqft)}</dd>
        <dt>Units / Towers / Floors</dt><dd>${p.total_units} / ${p.total_towers} / ${p.total_floors}</dd>
        <dt>Launch</dt><dd>${p.launch_date}</dd>
        <dt>Possession</dt><dd>${p.possession_date}</dd>
        <dt>RERA</dt><dd>${p.rera_number}</dd>
        <dt>Reported listings</dt><dd>${p.total_listings}</dd>
        <dt>Amenities</dt><dd>${(p.amenities || []).join(', ')}</dd>
      </dl>
      <p style="margin-top:1rem"><a href="#/listings">Browse listings</a> and filter by this project's locality to compare against the reported listing count.</p>
    </div>
  `;
}
