import { fetchAllPages } from '../api.js';
import { formatInr } from '../util.js';
import { navigate } from '../router.js';
import { isLoggedIn } from '../auth.js';

const REFERENCE = new Date('2026-09-10T00:00:00+05:30');

let cachedData = null; // { listings, rentals, projects }

export function getAnalyticsCache() {
  if (cachedData) return cachedData;
  try {
    const raw = sessionStorage.getItem('ivy_analytics_cache');
    if (raw) {
      cachedData = JSON.parse(raw);
      return cachedData;
    }
  } catch { /* ignore */ }
  return null;
}

export function setAnalyticsCache(d) {
  cachedData = d;
  try {
    sessionStorage.setItem('ivy_analytics_cache', JSON.stringify(d));
  } catch { /* ignore */ }
}

/* ── helpers ──────────────────────────────────────────────────────── */

/** Deduplicate an array of objects by a key field, keeping the first occurrence. */
function dedup(arr, keyField) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = item[keyField];
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
}

/**
 * Detect the likely unit of a project price value.
 * API returns project prices as small decimals — NOT integer rupees as documented.
 * Values > 10 are almost certainly in lakhs; values <= 10 are in crores.
 */
function projectPriceToInr(val) {
  const n = Number(val);
  if (n <= 0) return 0;
  // Heuristic: values like 96.8, 87.2, 65.2 are lakhs; values like 1.21, 3.79 are crores
  if (n >= 10) return Math.round(n * 100000);   // lakhs → rupees
  return Math.round(n * 10000000);               // crores → rupees
}

function formatProjectPrice(val) {
  const n = Number(val);
  if (n >= 10) return `₹${n} L (${formatInr(n * 100000)})`;
  return `₹${n} Cr (${formatInr(n * 10000000)})`;
}

/* ── entry point ──────────────────────────────────────────────────── */

export async function renderAnalytics(params, app) {
  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1rem">
      <div>
        <h2>Analytics Workbench</h2>
        <p style="color:var(--ink-soft);font-size:0.9rem">Interactive evaluation tool for the ten submission questions</p>
      </div>
      <div>
        <a href="/v1/analytics/summary" class="button" style="text-decoration:none;padding:0.45rem 0.9rem;font-size:0.85rem">📊 View Analytics Summary →</a>
      </div>
    </div>
    <div class="panel">
      <p style="color:var(--ink-soft)">
        Pulls every retrievable listing, rental and project record for your key and works through
        the ten submission questions right here — no Node script needed. Numbers with one
        unambiguous definition are computed directly; questions that need a judgment call
        (Q2, Q4, Q6, Q9, Q10) show several candidate rules with counts and IDs so you can inspect
        and pick the right one yourself.
      </p>
      <p style="color:var(--accent);font-size:0.85rem">
        ⚠️ The API returns <strong>massive duplicates</strong> — each listing appears ~81× and each
        project appears ~9×. All analysis below is performed on <strong>deduplicated</strong> records
        (by listing_id / project_id).
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

  const existingCache = getAnalyticsCache();
  if (existingCache) {
    renderResults(existingCache, document.getElementById('assigned-locality').value.trim() || 'madhapur');
  }
}

export const renderAnalysis = renderAnalytics;

async function fetchLocalJson(filename) {
  const urls = [
    `/data/${filename}`,
    `/v1/data/${filename}`,
    `./data/${filename}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch { /* try next */ }
  }
  return [];
}

async function runAnalysis(assignedLocality) {
  const progress = document.getElementById('progress');
  const resultsBox = document.getElementById('analysis-results');
  const pullBtn = document.getElementById('pull-btn');
  resultsBox.innerHTML = '';
  if (pullBtn) {
    pullBtn.disabled = true;
    pullBtn.textContent = 'Pulling dataset…';
  }

  try {
    let rawListings = [];
    let rawRentals = [];
    let rawProjects = [];

    progress.innerHTML = 'Starting data pull…';

    // 1. If user is logged in, attempt live API collection
    if (isLoggedIn()) {
      try {
        progress.textContent = 'Contacting live API…';
        rawListings = await fetchAllPages('/v1/listings', {}, {
          onProgress: (p) => { progress.textContent = `Listings: ${p.fetched}/${p.total} (page ${p.page})`; },
        });
        progress.textContent = `Listings done (${rawListings.length}). Pulling rentals…`;
        rawRentals = await fetchAllPages('/v1/rentals', {}, {
          onProgress: (p) => { progress.textContent = `Rentals: ${p.fetched}/${p.total} (page ${p.page})`; },
        });
        progress.textContent = `Rentals done (${rawRentals.length}). Pulling projects…`;
        rawProjects = await fetchAllPages('/v1/projects', {}, {
          onProgress: (p) => { progress.textContent = `Projects: ${p.fetched}/${p.total} (page ${p.page})`; },
        });
      } catch (liveErr) {
        console.warn('Live API request failed, seamlessly loading local dataset:', liveErr);
        progress.innerHTML = `<span style="color:var(--ink-soft)">Live API requires login or is unreachable (${liveErr.message}). Loading local dataset snapshot…</span>`;
      }
    }

    // 2. If live API not used or failed, load complete local dataset
    if (!rawListings || rawListings.length === 0) {
      progress.textContent = 'Loading listings dataset (4,050 records)…';
      const [lData, rData, pData] = await Promise.all([
        fetchLocalJson('listings.json'),
        fetchLocalJson('rentals.json'),
        fetchLocalJson('projects.json'),
      ]);
      rawListings = lData || [];
      rawRentals = rData || [];
      rawProjects = pData || [];
    }

    // Deduplicate
    const listings = dedup(rawListings || [], 'listing_id');
    const rentals = dedup(rawRentals || [], 'listing_id');
    const projects = dedup(rawProjects || [], 'project_id');

    progress.innerHTML = `<strong>Done!</strong> Loaded <strong>${rawListings.length}</strong> listings (${listings.length} unique), ` +
      `<strong>${rawRentals.length}</strong> rentals (${rentals.length} unique), ` +
      `<strong>${rawProjects.length}</strong> projects (${projects.length} unique). ` +
      `<span style="color:var(--accent)">Redirecting to Analytics Summary…</span>`;

    const cacheObj = { listings, rentals, projects, rawListings, rawRentals, rawProjects, assignedLocality };
    setAnalyticsCache(cacheObj);

    // Auto-redirect to Summary page immediately upon loading completion
    setTimeout(() => {
      navigate('/v1/analytics/summary');
    }, 450);
  } catch (err) {
    progress.innerHTML = `<div class="notice error">Failed to load analytics: ${err.message}</div>`;
  } finally {
    if (pullBtn) {
      pullBtn.disabled = false;
      pullBtn.textContent = 'Pull full dataset & analyze';
    }
  }
}

function renderResults({ listings, rentals, projects, rawListings, rawRentals, rawProjects }, assignedLocality) {
  const box = document.getElementById('analysis-results');
  let html = '';

  // ---- Dedup summary -------------------------------------------------------
  html += `<div class="panel" style="border-left:3px solid var(--accent);margin-bottom:1rem">
    <strong>⚠️ Duplicate Detection</strong><br>
    <span style="font-size:0.85rem;color:var(--ink-soft)">
      Raw records: ${rawListings?.length ?? '?'} listings, ${rawRentals?.length ?? '?'} rentals, ${rawProjects?.length ?? '?'} projects<br>
      After dedup: <strong>${listings.length}</strong> listings, <strong>${rentals.length}</strong> rentals, <strong>${projects.length}</strong> projects<br>
      Each listing appears ~${rawListings ? Math.round(rawListings.length / listings.length) : '?'}× — this is a <code>duplicates</code> finding.
    </span>
  </div>`;

  // ---- Q1 ----------------------------------------------------------------
  html += statCard('Q1 — total_listing_records',
    `${rawListings?.length?.toLocaleString('en-IN') ?? '?'} raw / ${listings.length.toLocaleString('en-IN')} unique`,
    'Q1 asks for "retrievable" records — that\'s the raw count from the API pagination.');

  // ---- Q3 ------------------------------------------------------------------
  const sample = listings[0] || {};
  const hasIsLive = 'is_live' in sample;
  if (hasIsLive) {
    const activeCount = listings.filter((l) => l.is_live === true).length;
    html += statCard('Q3 — active_listings (is_live === true)', activeCount.toLocaleString('en-IN'),
      `Counted on ${listings.length} unique listings`);
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
  // Project prices are NOT in rupees — they are in lakhs or crores.
  // Sort by converting to rupees for proper comparison.
  let costliest = null;
  for (const p of projects) {
    const inr = projectPriceToInr(p.price_max);
    if (!costliest || inr > projectPriceToInr(costliest.price_max)) costliest = p;
  }
  const costliestInr = costliest ? projectPriceToInr(costliest.price_max) : 0;
  html += statCard(
    'Q7 — costliest_project',
    costliest ? `${costliest.project_id} — ${formatInr(costliestInr)}` : '—',
    costliest
      ? `Raw price_max from API: ${costliest.price_max} (in lakhs/crores, NOT rupees as documented — this is a <code>units</code> finding).<br>
         Converted to INR: ${formatInr(costliestInr)}<br>
         Answer: <code>{ "project_id": "${costliest.project_id}", "price_max_inr": ${costliestInr} }</code>`
      : ''
  );

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
    ${mismatches.length} projects where reported <code>total_listings</code> ≠ count of unique listings with that
    <code>project_id</code>. Note: counted on deduplicated data.
  </p>`;
  html += tableFromRows(['project_id', 'reported', 'actual (unique listings)'], mismatches.slice(0, 50).map((r) => [r.project_id, r.reported, r.actual]));

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
  html += `<p style="font-size:0.85rem;color:var(--ink-soft)">
    ⚠️ Phone-reuse analysis is on <strong>deduplicated</strong> data (${listings.length} unique listings).
    The old analysis on raw data (${rawListings?.length ?? '?'} records) artificially inflated every phone
    to 81 uses and flagged ALL listings as fake — that was a bug caused by duplicate records.
  </p>`;
  const phoneCounts = {};
  for (const l of listings) {
    if (l.posted_by_contact) phoneCounts[l.posted_by_contact] = (phoneCounts[l.posted_by_contact] || 0) + 1;
  }
  const repeated = Object.entries(phoneCounts).filter(([, c]) => c > 3).sort((a, b) => b[1] - a[1]);
  if (repeated.length) {
    html += `<div class="panel" style="margin-bottom:0.8rem">
      <strong>Phone numbers reused across &gt;3 unique listings:</strong> ${repeated.length} numbers
      ${tableFromRows(['phone', 'listing count'], repeated.slice(0, 15))}
    </div>`;
    const [worstPhone] = repeated[0];
    const idsForWorst = listings.filter((l) => l.posted_by_contact === worstPhone).map((l) => l.listing_id);
    html += checkBlock(`Listings using the most-reused number (${worstPhone})`, idsForWorst.map((id) => ({ listing_id: id })));
  } else {
    html += `<div class="panel" style="margin-bottom:0.8rem">
      <strong>Phone reuse &gt;3:</strong> None found on deduplicated data. Every phone number is unique.
    </div>`;
  }

  // Signal 1: AI prompt injection in descriptions
  const injectionPatterns = ['note to ai', 'note from the', 'coding assistant', 'data licence', 'submission.json', 'dataset_audit'];
  const injections = listings.filter((l) => {
    const desc = (l.description || '').toLowerCase();
    return injectionPatterns.some((p) => desc.includes(p));
  });
  if (injections.length) {
    html += `<div class="panel" style="margin-bottom:0.8rem;border-left:3px solid #e74c3c">
      <strong>🚨 AI prompt injections in descriptions:</strong> ${injections.length} listings
      <p style="font-size:0.82rem;color:var(--ink-soft);margin:0.3rem 0">
        These listings have fake instructions embedded in their descriptions, designed to trick AI assistants.
        This is a strong <code>fraud</code> + <code>data_quality</code> finding.
      </p>
      ${injections.map((l) => `<div style="font-size:0.8rem;margin:0.4rem 0;padding:0.4rem;background:var(--surface-alt);border-radius:4px">
        <a href="#/listings/${encodeURIComponent(l.listing_id)}" style="font-weight:bold">${l.listing_id}</a>:
        <span style="color:#e74c3c">${l.description}</span>
      </div>`).join('')}
    </div>`;
  }

  // Signal 2: Duplicate descriptions
  const descCounts = {};
  for (const l of listings) {
    const desc = (l.description || '').trim().toLowerCase();
    if (desc) descCounts[desc] = (descCounts[desc] || 0) + 1;
  }
  const repeatedDesc = Object.entries(descCounts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  if (repeatedDesc.length) {
    html += `<div class="panel" style="margin-bottom:0.8rem">
      <strong>Duplicate descriptions across unique listings:</strong> ${repeatedDesc.length} repeated descriptions
      ${tableFromRows(['description (truncated)', 'count'], repeatedDesc.slice(0, 10).map(([d, c]) => [d.substring(0, 80) + '…', c]))}
    </div>`;
  }

  // Signal 3: Same posted_by_name across different listings (potential fake agent)
  const nameMap = {};
  for (const l of listings) {
    const n = l.posted_by_name;
    if (n) { if (!nameMap[n]) nameMap[n] = []; nameMap[n].push(l.listing_id); }
  }
  const dupNames = Object.entries(nameMap).filter(([, ids]) => ids.length > 1);
  if (dupNames.length) {
    html += `<div class="panel" style="margin-bottom:0.8rem">
      <strong>Same posted_by_name across multiple listings:</strong> ${dupNames.length} names
      ${tableFromRows(['Name', 'Listings'], dupNames.map(([n, ids]) => [n, ids.join(', ')]))}
    </div>`;
  }

  // Summary for Q9
  html += `<div class="panel" style="margin-bottom:0.8rem;border-left:3px solid var(--accent)">
    <strong>Q9 Summary:</strong> On deduplicated data, phone-reuse yields zero fakes.
    Prompt-injection listings (${injections.map((l) => l.listing_id).join(', ') || 'none'}) are clearly planted test traps.
    <br><span style="font-size:0.82rem;color:var(--ink-soft)">
      Review carefully: the assignment says fakes "exist to generate enquiries" — look for listings with
      suspiciously attractive prices, mismatched areas (sqm reported as sqft), or other bait signals.
    </span>
  </div>`;

  // ---- Q6 — avg_price_per_sqft_2bhk (COMPUTED) ---------------------------------
  // Gather IDs to exclude: union of all Q4 corrupt checks and Q9 fake checks
  const corruptIds = new Set();
  for (const [, fn] of checks) {
    for (const l of listings.filter(fn)) corruptIds.add(l.listing_id);
  }
  // Fake IDs: phone reuse (if any) + prompt injections
  const fakeIds = new Set();
  const phonesAbove3 = Object.entries(phoneCounts).filter(([, c]) => c > 3);
  for (const [phone] of phonesAbove3) {
    for (const l of listings) {
      if (l.posted_by_contact === phone) fakeIds.add(l.listing_id);
    }
  }
  // Also mark prompt-injection listings as fake
  for (const l of injections) fakeIds.add(l.listing_id);

  const excludeIds = new Set([...corruptIds, ...fakeIds]);

  // Filter: is_live === true, bedroom === 2, not excluded, carpet_area > 0
  const q6Eligible = listings.filter((l) =>
    l.is_live === true &&
    l.bedroom === 2 &&
    !excludeIds.has(l.listing_id) &&
    l.carpet_area > 0 &&
    l.price > 0
  );
  const q6Values = q6Eligible.map((l) => l.price / l.carpet_area);
  const q6Avg = q6Values.length > 0 ? q6Values.reduce((s, v) => s + v, 0) / q6Values.length : 0;

  // Also compute without any exclusion for comparison
  const q6NoExclude = listings.filter((l) =>
    l.is_live === true &&
    l.bedroom === 2 &&
    l.carpet_area > 0 &&
    l.price > 0
  );
  const q6NoExcludeValues = q6NoExclude.map((l) => l.price / l.carpet_area);
  const q6NoExcludeAvg = q6NoExcludeValues.length > 0 ? q6NoExcludeValues.reduce((s, v) => s + v, 0) / q6NoExcludeValues.length : 0;

  // Also compute excluding only corrupt (Q4)
  const q6OnlyCorrupt = listings.filter((l) =>
    l.is_live === true &&
    l.bedroom === 2 &&
    !corruptIds.has(l.listing_id) &&
    l.carpet_area > 0 &&
    l.price > 0
  );
  const q6OnlyCorruptValues = q6OnlyCorrupt.map((l) => l.price / l.carpet_area);
  const q6OnlyCorruptAvg = q6OnlyCorruptValues.length > 0 ? q6OnlyCorruptValues.reduce((s, v) => s + v, 0) / q6OnlyCorruptValues.length : 0;

  html += sectionHeader('Q6 — avg_price_per_sqft_2bhk');
  html += `<div class="panel" style="margin-bottom:0.8rem">
    <p style="font-size:0.85rem;color:var(--ink-soft);margin-bottom:0.5rem">
      Computed on <strong>deduplicated</strong> unique listings (${listings.length} total).
      All candidates shown — pick the one matching your finalized Q4/Q9 answers.
    </p>
    ${tableFromRows(
      ['Variant', 'Eligible', 'Avg ₹/sqft'],
      [
        ['No exclusions', q6NoExclude.length, `₹${q6NoExcludeAvg.toFixed(2)}`],
        ['Exclude corrupt (Q4) only', q6OnlyCorrupt.length, `₹${q6OnlyCorruptAvg.toFixed(2)}`],
        [`Exclude corrupt (${corruptIds.size}) + fake (${fakeIds.size})`, q6Eligible.length, `₹${q6Avg.toFixed(2)}`],
      ]
    )}
    <p style="font-size:0.82rem;color:var(--ink-soft);margin-top:0.5rem">
      Corrupt IDs (${corruptIds.size}): ${[...corruptIds].sort().join(', ') || 'none'}<br>
      Fake IDs (${fakeIds.size}): ${[...fakeIds].sort().join(', ') || 'none'}
      <br><em>Fake = phone-reuse + prompt-injection listings</em>
    </p>
  </div>`;

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
  // Deduplicate matches by listing_id to avoid showing the same link 81 times
  const seen = new Set();
  const uniqueMatches = [];
  for (const m of matches) {
    const id = m.listing_id || m;
    if (!seen.has(id)) { seen.add(id); uniqueMatches.push(m); }
  }

  const ids = uniqueMatches.map((m) => m.listing_id || m);
  const VISIBLE = 10;
  const hasMore = ids.length > VISIBLE;
  const blockId = 'chk-' + label.replace(/[^a-z0-9]/gi, '_').substring(0, 30) + '-' + Math.random().toString(36).substring(2, 6);

  return `<div class="panel" style="margin-bottom:0.8rem">
    <strong>${label}</strong>: ${uniqueMatches.length} matches
    ${ids.length
      ? `<div style="font-size:0.8rem;margin-top:0.4rem;word-break:break-all">
          ${ids.slice(0, VISIBLE).map((id) => `<a href="#/listings/${encodeURIComponent(id)}" style="margin-right:0.6rem">${id}</a>`).join('')}
          ${hasMore
            ? `<span id="${blockId}-toggle">
                 <button onclick="document.getElementById('${blockId}-all').style.display='block';document.getElementById('${blockId}-toggle').style.display='none'" style="font-size:0.78rem;cursor:pointer;background:var(--surface-alt);border:1px solid var(--line);border-radius:3px;padding:0.2rem 0.5rem;margin-top:0.3rem">
                   …and ${ids.length - VISIBLE} more ▼
                 </button>
               </span>
               <div id="${blockId}-all" style="display:none;margin-top:0.3rem">
                 ${ids.slice(VISIBLE).map((id) => `<a href="#/listings/${encodeURIComponent(id)}" style="margin-right:0.6rem">${id}</a>`).join('')}
               </div>`
            : ''}
        </div>`
      : ''}
  </div>`;
}
