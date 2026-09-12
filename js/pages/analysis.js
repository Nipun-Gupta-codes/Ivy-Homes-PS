import { fetchAllPages } from '../api.js';
import { formatInr } from '../util.js';

const REFERENCE = new Date('2026-09-10T00:00:00+05:30');

let cachedData = null; // { listings, rentals, projects } — kept in memory for the session only

export async function renderAnalysis(params, app) {
  app.innerHTML = `
    <div class="panel">
      <h2>Analysis workbench</h2>
      <p style="color:var(--ink-soft)">
        Pulls every retrievable listing, rental and project record for your key and works through
        the ten submission questions right here — no Node script needed. Numbers with one
        unambiguous definition are computed directly; questions that need a judgment call
        (Q2, Q4, Q6, Q9, Q10) show several candidate rules with counts and IDs so you can inspect
        and pick the right one yourself.
      </p>
      <div class="filters">
        <input type="text" id="assigned-locality" placeholder="Assigned locality (e.g. madhapur)" value="madhapur" />
        <button id="pull-btn">Pull full dataset &amp; analyze</button>
      </div>
      <div id="progress" style="margin-top:0.6rem;font-size:0.85rem;color:var(--ink-soft)"></div>
    </div>
    <div id="analysis-results"></div>
  `;

  document.getElementById('pull-btn').onclick = () =>
    runAnalysis(document.getElementById('assigned-locality').value.trim() || 'madhapur');

  if (cachedData) {
    renderResults(cachedData, document.getElementById('assigned-locality').value.trim() || 'madhapur');
  }
}

async function runAnalysis(assignedLocality) {
  const progress = document.getElementById('progress');
  const resultsBox = document.getElementById('analysis-results');
  resultsBox.innerHTML = '';

  try {
    progress.textContent = 'Pulling listings…';
    const listings = await fetchAllPages('/v1/listings', {}, {
      onProgress: (p) => { progress.textContent = `Listings: ${p.fetched}/${p.total} (page ${p.page})`; },
    });

    progress.textContent = `Listings done (${listings.length}). Pulling rentals…`;
    const rentals = await fetchAllPages('/v1/rentals', {}, {
      onProgress: (p) => { progress.textContent = `Rentals: ${p.fetched}/${p.total} (page ${p.page})`; },
    });

    progress.textContent = `Rentals done (${rentals.length}). Pulling projects…`;
    const projects = await fetchAllPages('/v1/projects', {}, {
      onProgress: (p) => { progress.textContent = `Projects: ${p.fetched}/${p.total} (page ${p.page})`; },
    });

    progress.textContent = `Done — ${listings.length} listings, ${rentals.length} rentals, ${projects.length} projects pulled and held in memory for this session.`;
    cachedData = { listings, rentals, projects };
    renderResults(cachedData, assignedLocality);
  } catch (err) {
    progress.innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}

function renderResults({ listings, rentals, projects }, assignedLocality) {
  const box = document.getElementById('analysis-results');
  let html = '';

  // ---- Q1 ----------------------------------------------------------------
  html += statCard('Q1 — total_listing_records', listings.length.toLocaleString('en-IN'));

  // ---- Q3 ------------------------------------------------------------------
  const sample = listings[0] || {};
  const hasIsLive = 'is_live' in sample;
  if (hasIsLive) {
    const activeCount = listings.filter((l) => l.is_live === true).length;
    html += statCard('Q3 — active_listings (is_live === true)', activeCount.toLocaleString('en-IN'));
  } else {
    html += statCard('Q3 — active_listings', '?', `No 'is_live' field on listing records. Sample keys: ${Object.keys(sample).join(', ')}`);
  }

  // ---- Q8 ------------------------------------------------------------------
  const windowStart = new Date(REFERENCE.getTime() - 7 * 24 * 60 * 60 * 1000);
  const in7 = listings.filter((l) => {
    const d = new Date(l.posted_at);
    return d >= windowStart && d < REFERENCE;
  });
  html += statCard('Q8 — listings_last_7_days', in7.length.toLocaleString('en-IN'), `Window ${windowStart.toISOString()} → ${REFERENCE.toISOString()}`);

  // ---- Q5 ------------------------------------------------------------------
  const localityRentals = rentals.filter((r) => (r.locality || '').toLowerCase() === assignedLocality.toLowerCase());
  const totalRent = localityRentals.reduce((s, r) => s + Number(r.price || 0), 0);
  html += statCard(`Q5 — total_monthly_rent in "${assignedLocality}"`, formatInr(totalRent), `${localityRentals.length} rental records matched — double-check the locality spelling against your email`);

  // ---- Q7 ------------------------------------------------------------------
  let costliest = null;
  for (const p of projects) {
    if (!costliest || Number(p.price_max) > Number(costliest.price_max)) costliest = p;
  }
  html += statCard('Q7 — costliest_project', costliest ? `${costliest.project_id} — ${formatInr(costliest.price_max)}` : '—');

  html += `<div style="clear:both"></div>`;

  // ---- Q10 (candidate) -------------------------------------------------------
  const listingCountByProject = {};
  for (const l of listings) {
    if (l.project_id) listingCountByProject[l.project_id] = (listingCountByProject[l.project_id] || 0) + 1;
  }
  const mismatches = projects
    .map((p) => ({ project_id: p.project_id, reported: p.total_listings, actual: listingCountByProject[p.project_id] || 0 }))
    .filter((r) => r.reported !== r.actual);
  html += sectionHeader('Q10 — projects_with_wrong_listing_count (candidate)');
  html += `<p style="font-size:0.88rem;color:var(--ink-soft)">
    ${mismatches.length} projects where reported <code>total_listings</code> ≠ count of listings with that
    <code>project_id</code> among retrievable records. total_listings is documented as "currently available" —
    if some retrievable listings aren't live, re-check this filtered to is_live === true first.
  </p>`;
  html += tableFromRows(['project_id', 'reported', 'actual (retrievable)'], mismatches.slice(0, 50).map((r) => [r.project_id, r.reported, r.actual]));

  // ---- Q2 (candidate duplicate heuristics) ------------------------------------
  html += sectionHeader('Q2 — unique_properties (candidate duplicate-grouping rules)');
  const heuristics = [
    ['lat+long exact match', (l) => (l.latitude && l.longitude ? `${l.latitude},${l.longitude}` : null)],
    ['listing_url exact match', (l) => l.listing_url || null],
    ['apartment_name + floor + project_id', (l) => (l.apartment_name && l.floor != null ? `${l.apartment_name}|${l.floor}|${l.project_id}` : null)],
  ];
  for (const [label, keyFn] of heuristics) {
    const map = new Map();
    for (const l of listings) {
      const k = keyFn(l);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(l.listing_id);
    }
    const dupGroups = [...map.values()].filter((ids) => ids.length > 1);
    const extra = dupGroups.reduce((s, ids) => s + (ids.length - 1), 0);
    html += `<div class="panel" style="margin-bottom:0.8rem">
      <strong>${label}</strong>: ${dupGroups.length} groups with &gt;1 record, ${extra} "extra" records
      → implies <strong>${(listings.length - extra).toLocaleString('en-IN')} unique properties</strong> if this key is right.
      ${dupGroups[0] ? `<div style="font-size:0.78rem;color:var(--ink-soft);margin-top:0.3rem;word-break:break-all">sample group: ${dupGroups[0].join(', ')}</div>` : ''}
    </div>`;
  }

  // ---- Q4 (candidate impossible-record checks) --------------------------------
  html += sectionHeader('Q4 — corrupt_listing_ids (candidate "impossible record" checks)');
  const checks = [
    ['floor > total_floors', (l) => l.floor != null && l.total_floors != null && l.floor > l.total_floors],
    ['carpet_area > super_built_up_area', (l) => l.carpet_area != null && l.super_built_up_area != null && l.carpet_area > l.super_built_up_area],
    ['price <= 0', (l) => Number(l.price) <= 0],
    ['bedroom or bathroom === 0', (l) => l.bedroom === 0 || l.bathroom === 0],
    ['carpet_area under 150 sqft (implausibly small)', (l) => l.carpet_area != null && l.carpet_area < 150],
  ];
  for (const [label, fn] of checks) {
    html += checkBlock(label, listings.filter(fn));
  }

  // ---- Q9 (candidate fake-listing signals) -------------------------------------
  html += sectionHeader('Q9 — fake_listing_ids (candidate signals)');
  const phoneCounts = {};
  for (const l of listings) {
    if (l.posted_by_contact) phoneCounts[l.posted_by_contact] = (phoneCounts[l.posted_by_contact] || 0) + 1;
  }
  const repeated = Object.entries(phoneCounts).filter(([, c]) => c > 3).sort((a, b) => b[1] - a[1]);
  html += `<div class="panel" style="margin-bottom:0.8rem">
    <strong>Phone numbers reused across &gt;3 listings:</strong> ${repeated.length} numbers
    ${tableFromRows(['phone', 'listing count'], repeated.slice(0, 15))}
  </div>`;
  if (repeated.length) {
    const [worstPhone] = repeated[0];
    const idsForWorst = listings.filter((l) => l.posted_by_contact === worstPhone).map((l) => l.listing_id);
    html += checkBlock(`Listings using the most-reused number (${worstPhone})`, idsForWorst.map((id) => ({ listing_id: id })));
  }

  // ---- Q6 note ---------------------------------------------------------------
  html += sectionHeader('Q6 — avg_price_per_sqft_2bhk');
  html += `<p style="font-size:0.88rem;color:var(--ink-soft)">
    Compute this last, once Q4 and Q9 are finalized. Formula: mean of (price ÷ carpet_area) over listings where
    ${hasIsLive ? 'is_live === true' : '[confirm is_live]'} and bedroom === 2, excluding your final
    corrupt_listing_ids and fake_listing_ids.
  </p>`;

  box.innerHTML = html;
}

function statCard(label, value, sub) {
  return `<div class="stat-card" style="display:inline-block;margin:0 0.7rem 0.7rem 0;min-width:180px">
    <div class="num">${value}</div>
    <div class="label">${label}</div>
    ${sub ? `<div style="font-size:0.72rem;color:var(--ink-soft);margin-top:0.3rem">${sub}</div>` : ''}
  </div>`;
}

function sectionHeader(text) {
  return `<h3 style="margin-top:1.6rem">${text}</h3>`;
}

function tableFromRows(headers, rows) {
  if (!rows.length) return '<p style="color:var(--ink-soft);font-size:0.85rem">None found.</p>';
  return `<table class="locality-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function checkBlock(label, matches) {
  const ids = matches.map((m) => m.listing_id);
  return `<div class="panel" style="margin-bottom:0.8rem">
    <strong>${label}</strong>: ${matches.length} matches
    ${ids.length
      ? `<div style="font-size:0.8rem;margin-top:0.4rem;word-break:break-all">
          ${ids.slice(0, 30).map((id) => `<a href="#/listings/${encodeURIComponent(id)}" style="margin-right:0.6rem">${id}</a>`).join('')}
          ${ids.length > 30 ? ` …and ${ids.length - 30} more` : ''}
        </div>`
      : ''}
  </div>`;
}
