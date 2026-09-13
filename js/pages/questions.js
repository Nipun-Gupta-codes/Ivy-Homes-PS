import { fetchAllPages } from '../api.js';
import { formatInr } from '../util.js';

const REFERENCE_DEFAULT = '2026-09-10T00:00:00+05:30';

function daysAgo(days, ref) {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);
}

function idLinks(ids, max = 20) {
  return ids
    .slice(0, max)
    .map((id) => `<a href="#/listings/${encodeURIComponent(id)}" target="_blank">${id}</a>`)
    .join(', ') + (ids.length > max ? ` … +${ids.length - max} more` : '');
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item.listing_id);
  }
  return map;
}

export async function renderQuestions(params, app) {
  app.innerHTML = `
    <div class="panel">
      <h2>Answer the 10 questions</h2>

      <div class="filters" style="margin-top:1rem">
        <label style="font-size:0.85rem">Assigned locality
          <input type="text" id="q-locality" value="madhapur" style="display:block;margin-top:0.2rem" />
        </label>
        <label style="font-size:0.85rem">REFERENCE (IST)
          <input type="text" id="q-reference" value="${REFERENCE_DEFAULT}" style="display:block;margin-top:0.2rem;width:240px" />
        </label>
        <button id="run-btn" style="align-self:flex-end">Run full analysis</button>
      </div>
      <div id="progress" style="margin-top:1rem;font-size:0.88rem;color:var(--ink-soft)"></div>
    </div>
    <div id="results" style="margin-top:1.5rem"></div>
  `;

  document.getElementById('run-btn').onclick = () => run();

  async function run() {
    const locality = document.getElementById('q-locality').value.trim().toLowerCase();
    const REFERENCE = new Date(document.getElementById('q-reference').value);
    const progress = document.getElementById('progress');
    const results = document.getElementById('results');
    results.innerHTML = '';
    document.getElementById('run-btn').disabled = true;

    const onProgress = ({ path, page, fetched, total }) => {
      progress.textContent = `Fetching ${path} — page ${page}, ${fetched}/${total} records…`;
    };

    let listings, rentals, projects;
    try {
      listings = await fetchAllPages('/v1/listings', {}, { onProgress });
      rentals = await fetchAllPages('/v1/rentals', {}, { onProgress });
      projects = await fetchAllPages('/v1/projects', {}, { onProgress });
    } catch (err) {
      progress.innerHTML = `<div class="notice error">Fetch failed: ${err.message}</div>`;
      document.getElementById('run-btn').disabled = false;
      return;
    }
    progress.textContent = `Done. ${listings.length} listings, ${rentals.length} rentals, ${projects.length} projects loaded.`;
    document.getElementById('run-btn').disabled = false;

    const sample = listings[0] || {};
    const hasIsLive = 'is_live' in sample;

    // Q1
    const q1 = listings.length;

    // Q3
    const q3 = hasIsLive ? listings.filter((l) => l.is_live === true).length : null;

    // Q8
    const windowStart = daysAgo(7, REFERENCE);
    const inWindow = listings.filter((l) => {
      const posted = new Date(l.posted_at);
      return posted >= windowStart && posted < REFERENCE;
    });
    const q8 = inWindow.length;

    // Q5
    const localityRentals = rentals.filter((r) => (r.locality || '').toLowerCase() === locality);
    const q5 = localityRentals.reduce((s, r) => s + Number(r.price || 0), 0);

    // Q7
    let costliest = null;
    for (const p of projects) if (!costliest || Number(p.price_max) > Number(costliest.price_max)) costliest = p;

    // Q10 candidates
    const countByProject = {};
    for (const l of listings) if (l.project_id) countByProject[l.project_id] = (countByProject[l.project_id] || 0) + 1;
    const mismatches = projects
      .map((p) => ({ project_id: p.project_id, reported: p.total_listings, actual: countByProject[p.project_id] || 0 }))
      .filter((r) => r.reported !== r.actual);

    // Q2 candidates
    const byLatLong = groupBy(listings, (l) => (l.latitude && l.longitude ? `${l.latitude},${l.longitude}` : null));
    const byUrl = groupBy(listings, (l) => l.listing_url || null);
    const byNameFloorProject = groupBy(listings, (l) => (l.apartment_name && l.floor != null ? `${l.apartment_name}|${l.floor}|${l.project_id}` : null));
    const dupSummary = [
      ['Same latitude + longitude', byLatLong],
      ['Same listing_url', byUrl],
      ['Same apartment_name + floor + project_id', byNameFloorProject],
    ].map(([label, map]) => {
      const groups = [...map.values()].filter((ids) => ids.length > 1);
      const extra = groups.reduce((s, ids) => s + (ids.length - 1), 0);
      return { label, groupCount: groups.length, extraRecords: extra, sample: groups[0] || [] };
    });

    // Q4 candidates
    const badFloor = listings.filter((l) => l.floor != null && l.total_floors != null && l.floor > l.total_floors);
    const badArea = listings.filter((l) => l.carpet_area != null && l.super_built_up_area != null && l.carpet_area > l.super_built_up_area);
    const badPrice = listings.filter((l) => Number(l.price) <= 0);
    const badRoomCount = listings.filter((l) => l.bedroom === 0 || l.bathroom === 0);
    const tinyArea = listings.filter((l) => l.carpet_area && l.bedroom && l.carpet_area < l.bedroom * 150);

    // Q9 candidates
    const phoneCounts = {};
    for (const l of listings) if (l.posted_by_contact) phoneCounts[l.posted_by_contact] = (phoneCounts[l.posted_by_contact] || 0) + 1;
    const repeatedPhones = Object.entries(phoneCounts).filter(([, c]) => c > 3).sort((a, b) => b[1] - a[1]);
    const worstPhoneIds = repeatedPhones.length ? listings.filter((l) => l.posted_by_contact === repeatedPhones[0][0]).map((l) => l.listing_id) : [];

    results.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${q1}</div><div class="label">Q1 total_listing_records</div></div>
        <div class="stat-card"><div class="num">${q3 ?? 'n/a'}</div><div class="label">Q3 active_listings ${hasIsLive ? '(is_live===true)' : "(no 'is_live' field found — see raw sample below)"}</div></div>
        <div class="stat-card"><div class="num">${formatInr(q5)}</div><div class="label">Q5 total_monthly_rent in ${locality} (${localityRentals.length} rentals)</div></div>
        <div class="stat-card"><div class="num">${formatInr(costliest?.price_max)}</div><div class="label">Q7 costliest_project: ${costliest?.project_id}</div></div>
        <div class="stat-card"><div class="num">${q8}</div><div class="label">Q8 listings_last_7_days</div></div>
      </div>

      <div class="panel" style="margin-bottom:1rem">
        <h3>Sample listing — raw fields</h3>

        <pre style="font-size:0.78rem;overflow-x:auto;background:var(--accent-soft);padding:0.8rem;border-radius:3px">${JSON.stringify(sample, null, 2)}</pre>
      </div>

      <div class="panel" style="margin-bottom:1rem">
        <h3>Q10 — project listing-count mismatches (candidate)</h3>
        <p style="font-size:0.85rem;color:var(--ink-soft)">Comparing each project's reported <code>total_listings</code> against actual count of retrievable listings.</p>
        <table class="locality-table"><thead><tr><th>project_id</th><th>Reported</th><th>Actual</th></tr></thead>
        <tbody>${mismatches.slice(0, 30).map((m) => `<tr><td><a href="#/projects/${m.project_id}" target="_blank">${m.project_id}</a></td><td>${m.reported}</td><td>${m.actual}</td></tr>`).join('')}</tbody></table>
      </div>

      <div class="panel" style="margin-bottom:1rem">
        <h3>Q2 — duplicate/unique-property candidates</h3>
        ${dupSummary.map((d) => `
          <p><strong>${d.label}:</strong> ${d.groupCount} groups with >1 record, ${d.extraRecords} "extra" records
          → implies <strong>${q1 - d.extraRecords}</strong> unique properties if this rule is correct.
          ${d.sample.length ? `<br/>Sample group: ${idLinks(d.sample)}` : ''}</p>
        `).join('')}
      </div>

      <div class="panel" style="margin-bottom:1rem">
        <h3>Q4 — "impossible record" candidates</h3>
        <p><strong>floor > total_floors:</strong> ${badFloor.length} — ${idLinks(badFloor.map((l) => l.listing_id))}</p>
        <p><strong>carpet_area > super_built_up_area:</strong> ${badArea.length} — ${idLinks(badArea.map((l) => l.listing_id))}</p>
        <p><strong>price ≤ 0:</strong> ${badPrice.length} — ${idLinks(badPrice.map((l) => l.listing_id))}</p>
        <p><strong>bedroom or bathroom === 0:</strong> ${badRoomCount.length} — ${idLinks(badRoomCount.map((l) => l.listing_id))}</p>
        <p><strong>carpet_area under 150 sqft × bedroom count (loose):</strong> ${tinyArea.length} — ${idLinks(tinyArea.map((l) => l.listing_id))}</p>
      </div>

      <div class="panel">
        <h3>Q9 — "fake listing" candidates</h3>
        <p><strong>Phone numbers reused across &gt;3 listings:</strong> ${repeatedPhones.length} numbers.
        ${repeatedPhones.length ? `Most-reused: <code>${repeatedPhones[0][0]}</code> (${repeatedPhones[0][1]} listings) — ${idLinks(worstPhoneIds)}` : ''}</p>

      </div>

      ${(() => {
        // Compute Q6 avg_price_per_sqft_2bhk
        const corruptIds = new Set([
          ...badFloor.map(l => l.listing_id),
          ...badArea.map(l => l.listing_id),
          ...badPrice.map(l => l.listing_id),
          ...badRoomCount.map(l => l.listing_id),
        ]);
        const fakeIds = new Set();
        for (const [phone] of repeatedPhones) {
          for (const l of listings) {
            if (l.posted_by_contact === phone) fakeIds.add(l.listing_id);
          }
        }
        const excludeIds = new Set([...corruptIds, ...fakeIds]);
        const eligible = listings.filter(l =>
          l.is_live === true &&
          l.bedroom === 2 &&
          !excludeIds.has(l.listing_id) &&
          l.carpet_area > 0 &&
          l.price > 0
        );
        const values = eligible.map(l => l.price / l.carpet_area);
        const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
        return `
          <div class="stat-grid" style="margin-top:1rem">
            <div class="stat-card"><div class="num">₹${Math.round(avg * 100) / 100}</div><div class="label">Q6 avg_price_per_sqft_2bhk</div></div>
          </div>
          <div class="panel" style="margin-top:0.5rem">
            <h3 style="margin-top:0">Q6 — avg_price_per_sqft_2bhk</h3>
            <p style="font-size:0.9rem">
              Computed: mean(price ÷ carpet_area) over <strong>${eligible.length}</strong> listings
              where <code>is_live===true</code> and <code>bedroom===2</code>,
              excluding ${corruptIds.size} corrupt IDs (Q4) and ${fakeIds.size} fake IDs (Q9, phone reused >3×).
              <br>Rounded: <strong>${Math.round(avg)}</strong> ₹/sqft
            </p>
          </div>
        `;
      })()}
    `;
  }
}
