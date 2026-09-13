import { formatInr } from '../util.js';

// Compute a proper analytics summary directly from the local data files
// instead of the documented /v1/analytics/summary endpoint (which returns 404).

function dedup(arr, keyField) {
  const seen = new Set();
  return arr.filter((item) => {
    const k = item[keyField];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function renderInsights(params, app) {
  app.innerHTML = '<div class="empty">Loading data…</div>';

  // Load local data
  let listings = null;
  let rentals = null;
  let projects = null;

  try {
    const [lRes, rRes, pRes] = await Promise.all([
      fetch('/data/listings.json'),
      fetch('/data/rentals.json'),
      fetch('/data/projects.json'),
    ]);
    if (lRes.ok) listings = dedup(await lRes.json(), 'listing_id');
    if (rRes.ok) rentals = dedup(await rRes.json(), 'listing_id');
    if (pRes.ok) projects = dedup(await pRes.json(), 'project_id');
  } catch { /* fall through */ }

  if (!listings) {
    app.innerHTML = `<div class="notice error">
      No local data found. Run <code>scripts/fetch-all-data.mjs</code> first to pull the full dataset,
      then reload this page.
      <br><br>
      Note: the documented <code>/v1/analytics/summary</code> endpoint returns 404 on the live API — this is a
      <code>missing_endpoint</code> finding.
    </div>`;
    return;
  }

  // Compute summary
  const prices = listings.map((l) => Number(l.price)).filter((p) => p > 0);
  const pricesPerSqft = listings.filter((l) => l.carpet_area > 0 && l.price > 0).map((l) => l.price / l.carpet_area);
  const medianPrice = median(prices);
  const medianPricePerSqft = median(pricesPerSqft);

  // By locality
  const byLocality = {};
  for (const l of listings) {
    const loc = l.locality || 'unknown';
    if (!byLocality[loc]) byLocality[loc] = { locality: loc, count: 0, prices: [] };
    byLocality[loc].count++;
    if (l.price > 0) byLocality[loc].prices.push(l.price);
  }
  const localityRows = Object.values(byLocality)
    .map((b) => ({ ...b, median_price: median(b.prices) }))
    .sort((a, b) => b.count - a.count);

  // By bedroom
  const byBhk = {};
  for (const l of listings) {
    const bhk = l.bedroom ?? 'unknown';
    if (!byBhk[bhk]) byBhk[bhk] = { bedroom: bhk, count: 0 };
    byBhk[bhk].count++;
  }
  const bhkRows = Object.values(byBhk).sort((a, b) => a.bedroom - b.bedroom);

  // Active vs inactive
  const hasIsLive = listings.length > 0 && 'is_live' in listings[0];
  const activeCount = hasIsLive ? listings.filter((l) => l.is_live === true).length : null;

  // Discoveries from insights.json
  let discoveries = null;
  try {
    const res = await fetch('/data/insights.json');
    if (res.ok) discoveries = await res.json();
  } catch { /* fine */ }

  let html = '';

  html += `<h2>City summary — Hyderabad</h2>
    <p style="font-size:0.85rem;color:var(--ink-soft)">
      Computed directly from local data files (${listings.length} listings, ${rentals?.length || 0} rentals, ${projects?.length || 0} projects).
      <br>The documented <code>/v1/analytics/summary</code> endpoint returns 404 — that's a <code>missing_endpoint</code> finding.
    </p>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${listings.length.toLocaleString('en-IN')}</div><div class="label">Total listings</div></div>
      ${activeCount != null ? `<div class="stat-card"><div class="num">${activeCount.toLocaleString('en-IN')}</div><div class="label">Active (is_live)</div></div>` : ''}
      <div class="stat-card"><div class="num">${formatInr(medianPrice)}</div><div class="label">Median price</div></div>
      <div class="stat-card"><div class="num">${formatInr(Math.round(medianPricePerSqft))}</div><div class="label">Median ₹/sqft</div></div>
      ${rentals ? `<div class="stat-card"><div class="num">${rentals.length.toLocaleString('en-IN')}</div><div class="label">Total rentals</div></div>` : ''}
      ${projects ? `<div class="stat-card"><div class="num">${projects.length.toLocaleString('en-IN')}</div><div class="label">Total projects</div></div>` : ''}
    </div>

    <h3>By locality</h3>
    <table class="locality-table">
      <thead><tr><th>Locality</th><th>Count</th><th>Median price</th></tr></thead>
      <tbody>
        ${localityRows.map((l) => `<tr><td>${l.locality}</td><td>${l.count}</td><td>${formatInr(l.median_price)}</td></tr>`).join('')}
      </tbody>
    </table>

    <h3 style="margin-top:1.2rem">By bedroom count</h3>
    <table class="locality-table">
      <thead><tr><th>Bedrooms</th><th>Count</th></tr></thead>
      <tbody>
        ${bhkRows.map((b) => `<tr><td>${b.bedroom}</td><td>${b.count}</td></tr>`).join('')}
      </tbody>
    </table>
  `;

  html += `<h3 style="margin-top:2rem">What we found digging into the data</h3>`;
  if (discoveries) {
    html += `<div class="stat-grid">
      ${Object.entries(discoveries.stats || {})
        .map(([label, value]) => `<div class="stat-card"><div class="num">${value}</div><div class="label">${label}</div></div>`)
        .join('')}
    </div>`;
    if (discoveries.notes) {
      html += `<div class="panel">${discoveries.notes.map((n) => `<p>${n}</p>`).join('')}</div>`;
    }
  } else {
    html += `<div class="notice">Run <code>scripts/fetch-all-data.mjs</code> then <code>scripts/analyze.mjs</code>, and drop the output at <code>data/insights.json</code>, to populate this section with data-quality findings.</div>`;
  }

  app.innerHTML = html;
}
