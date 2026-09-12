import { apiGet } from '../api.js';
import { formatInr } from '../util.js';

export async function renderInsights(params, app) {
  app.innerHTML = '<div class="empty">Loading…</div>';

  let summary = null;
  let summaryError = null;
  try {
    summary = await apiGet('/v1/analytics/summary', {}, { auth: true });
  } catch (err) {
    summaryError = err;
  }

  // This file is produced by `scripts/analyze.mjs` after you run `scripts/fetch-all-data.mjs`.
  // It is optional — if it hasn't been generated yet, the page still shows the live summary.
  let discoveries = null;
  try {
    const res = await fetch('./data/insights.json');
    if (res.ok) discoveries = await res.json();
  } catch {
    // fine if it doesn't exist yet
  }

  let html = '';

  if (summary) {
    html += `
      <h2>City summary — ${summary.city || ''}</h2>
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${summary.total_listings ?? '—'}</div><div class="label">Total listings</div></div>
        <div class="stat-card"><div class="num">${formatInr(summary.median_price)}</div><div class="label">Median price</div></div>
        <div class="stat-card"><div class="num">${formatInr(summary.median_price_per_sqft)}</div><div class="label">Median ₹/sqft</div></div>
      </div>
      <h3>By locality</h3>
      <table class="locality-table">
        <thead><tr><th>Locality</th><th>Count</th><th>Median price</th></tr></thead>
        <tbody>
          ${(summary.by_locality || [])
            .map((l) => `<tr><td>${l.locality}</td><td>${l.count}</td><td>${formatInr(l.median_price)}</td></tr>`)
            .join('')}
        </tbody>
      </table>
      <h3 style="margin-top:1.2rem">By bedroom count</h3>
      <table class="locality-table">
        <thead><tr><th>Bedrooms</th><th>Count</th></tr></thead>
        <tbody>
          ${(summary.by_bhk || []).map((b) => `<tr><td>${b.bedroom}</td><td>${b.count}</td></tr>`).join('')}
        </tbody>
      </table>
    `;
  } else if (summaryError && summaryError.status === 404) {
    html += `<div class="notice error">
      GET /v1/analytics/summary returned 404 — this documented endpoint doesn't exist at that path on the live API.
      That's a genuine <code>missing_endpoint</code> finding. Use the <a href="#/analysis">Analysis</a> tab instead —
      it computes the same kind of numbers (and more) directly from the raw listings/rentals/projects data.
    </div>`;
  } else {
    html += `<div class="notice error">Could not load /v1/analytics/summary: ${summaryError?.message || summaryError}</div>`;
  }

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
