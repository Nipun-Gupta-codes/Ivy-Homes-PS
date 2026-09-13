import { apiGet } from '../api.js';
import { formatArea, formatProjectPriceRange, paginationControls } from '../util.js';

function dedup(arr, keyField) {
  const seen = new Set();
  return arr.filter((item) => {
    const k = item[keyField];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

let cachedProjects = null;

async function fetchProjectsList() {
  if (cachedProjects && cachedProjects.length > 0) return cachedProjects;

  // Try loading from local json dataset first
  try {
    const res = await fetch('/data/projects.json');
    if (res.ok) {
      const data = await res.json();
      cachedProjects = dedup(data, 'project_id');
      return cachedProjects;
    }
  } catch { /* fall through */ }

  // Otherwise fetch from API
  try {
    const body = await apiGet('/v1/projects', { limit: 200 }, { auth: true });
    cachedProjects = dedup(body.results || [], 'project_id');
    return cachedProjects;
  } catch (err) {
    if (cachedProjects) return cachedProjects;
    throw err;
  }
}

export async function renderProjects(params, app) {
  const state = { page: 1, limit: 20 };

  app.innerHTML = `<div id="results"><div class="empty">Loading…</div></div>`;
  const box = document.getElementById('results');

  try {
    const allProjects = await fetchProjectsList();

    function renderPage() {
      box.innerHTML = '';
      const total = allProjects.length;
      const start = (state.page - 1) * state.limit;
      const end = Math.min(start + state.limit, total);
      const pageItems = allProjects.slice(start, end);

      if (pageItems.length === 0) {
        box.innerHTML = '<div class="empty">No projects found.</div>';
        return;
      }

      for (const p of pageItems) {
        const row = document.createElement('a');
        row.href = `/v1/projects/${encodeURIComponent(p.project_id)}`;
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
          <div class="price">${formatProjectPriceRange(p.price_min, p.price_max)}</div>
        `;
        box.appendChild(row);
      }

      box.appendChild(
        paginationControls(state.page, total, state.limit, (p) => {
          state.page = p;
          renderPage();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
    }

    renderPage();
  } catch (err) {
    box.innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}

export async function renderProjectDetail(params, app) {
  const { id } = params;
  let p = null;

  try {
    p = await apiGet(`/v1/projects/${encodeURIComponent(id)}`, {}, { auth: true });
  } catch {
    // If detail endpoint fails, check cached list
    if (cachedProjects) {
      p = cachedProjects.find((x) => x.project_id === id);
    }
  }

  if (!p) {
    // Try loading local projects
    const list = await fetchProjectsList().catch(() => []);
    p = list.find((x) => x.project_id === id);
  }

  if (!p) {
    app.innerHTML = `
      <a href="/v1/projects" style="font-size:0.85rem;color:var(--ink-soft)">← Back to projects</a>
      <div class="notice error" style="margin-top:1rem">Project not found: ${id}</div>
    `;
    return;
  }

  app.innerHTML = `
    <a href="/v1/projects" style="font-size:0.85rem;color:var(--ink-soft)">← Back to projects</a>
    <div class="panel" style="margin-top:1rem">
      <h2>${p.apartment_name}</h2>
      <p style="color:var(--ink-soft)">${p.developer_name} · ${p.locality} · ${p.project_status}</p>
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 1rem;font-size:0.9rem;max-width:480px">
        <dt>Price range</dt><dd>${formatProjectPriceRange(p.price_min, p.price_max)}</dd>
        <dt>Area range</dt><dd>${formatArea(p.min_area_sqft)} – ${formatArea(p.max_area_sqft)}</dd>
        <dt>Units / Towers / Floors</dt><dd>${p.total_units} / ${p.total_towers} / ${p.total_floors}</dd>
        <dt>Launch</dt><dd>${p.launch_date}</dd>
        <dt>Possession</dt><dd>${p.possession_date}</dd>
        <dt>RERA</dt><dd>${p.rera_number}</dd>
        <dt>Reported listings</dt><dd>${p.total_listings}</dd>
        <dt>Amenities</dt><dd>${(p.amenities || []).join(', ')}</dd>
      </dl>
      <p style="margin-top:1rem"><a href="/v1/listings">Browse listings</a> and filter by this project's locality to compare against the reported listing count.</p>
    </div>
  `;
}
