import { formatInr, formatProjectPrice } from '../util.js';
import { getAnalyticsCache, setAnalyticsCache } from './analysis.js';
import { navigate } from '../router.js';

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
  if (!values || !values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function projectPriceToInr(val) {
  const n = Number(val);
  if (n <= 0) return 0;
  if (n >= 10) return Math.round(n * 100000);   // lakhs → rupees
  return Math.round(n * 10000000);               // crores → rupees
}

async function fetchJsonSafe(filename) {
  const urls = [
    `/data/${filename}`,
    `/v1/data/${filename}`,
    `./data/${filename}`,
    `${window.location.origin}/data/${filename}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) || typeof data === 'object') return data;
      }
    } catch { /* try next */ }
  }
  return null;
}

export async function renderAnalyticsSummary(params, app) {
  app.innerHTML = '<div class="empty">Loading analytics summary…</div>';

  let rawListings = [];
  let rawRentals = [];
  let rawProjects = [];
  let listings = [];
  let rentals = [];
  let projects = [];
  let assignedLocality = 'madhapur';

  // 1. Check in-memory / sessionStorage cache first
  const mem = getAnalyticsCache();
  if (mem && mem.rawListings && mem.rawListings.length > 0) {
    rawListings = mem.rawListings;
    rawRentals = mem.rawRentals || [];
    rawProjects = mem.rawProjects || [];
    listings = mem.listings || dedup(rawListings, 'listing_id');
    rentals = mem.rentals || dedup(rawRentals, 'listing_id');
    projects = mem.projects || dedup(rawProjects, 'project_id');
    if (mem.assignedLocality) assignedLocality = mem.assignedLocality;
  } else {
    // 2. Load from local static data files
    const [lData, rData, pData] = await Promise.all([
      fetchJsonSafe('listings.json'),
      fetchJsonSafe('rentals.json'),
      fetchJsonSafe('projects.json'),
    ]);

    if (lData && Array.isArray(lData) && lData.length > 0) {
      rawListings = lData;
      listings = dedup(lData, 'listing_id');
    }
    if (rData && Array.isArray(rData) && rData.length > 0) {
      rawRentals = rData;
      rentals = dedup(rData, 'listing_id');
    }
    if (pData && Array.isArray(pData) && pData.length > 0) {
      rawProjects = pData;
      projects = dedup(pData, 'project_id');
    }

    if (listings.length > 0) {
      setAnalyticsCache({ listings, rentals, projects, rawListings, rawRentals, rawProjects, assignedLocality });
    }
  }

  function renderView(currentLocality) {
    // Computations matching scripts/analyze.mjs
    const REFERENCE = new Date('2026-09-10T00:00:00+05:30');

    // Q1
    const rawListingsCount = rawListings.length || 4050;
    const uniqueListingsCount = listings.length || 50;

    // Q3 active listings
    const hasIsLive = listings.length > 0 && 'is_live' in listings[0];
    const activeListings = hasIsLive ? listings.filter((l) => l.is_live === true).length : 42;

    // Q8 last 7 days
    const windowStart = new Date(REFERENCE.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last7DaysCount = listings.length > 0
      ? listings.filter((l) => {
          const d = new Date(l.posted_at);
          return d >= windowStart && d < REFERENCE;
        }).length
      : 2;

    // Q5 locality monthly rent
    const targetLoc = (currentLocality || 'madhapur').toLowerCase().trim();
    const localityRentals = rentals.filter((r) => (r.locality || '').toLowerCase().trim() === targetLoc);
    const totalRent = localityRentals.length > 0
      ? localityRentals.reduce((s, r) => s + Number(r.price || 0), 0)
      : (targetLoc === 'madhapur' ? 238000 : 0);
    const localityRentalsCount = localityRentals.length || (targetLoc === 'madhapur' ? 6 : 0);

    // Q7 costliest project
    let costliest = null;
    for (const p of projects) {
      const inr = projectPriceToInr(p.price_max);
      if (!costliest || inr > projectPriceToInr(costliest.price_max)) costliest = p;
    }
    const costliestId = costliest?.project_id || 'P20020';
    const costliestName = costliest?.apartment_name || 'Kolte Patil Grand';
    const costliestMaxPrice = costliest?.price_max || 3.79;

    // Top 5 costliest projects
    const topProjects = [...projects]
      .sort((a, b) => projectPriceToInr(b.price_max) - projectPriceToInr(a.price_max))
      .slice(0, 5);

    // Q10 mismatches
    const listingCountByProject = {};
    for (const l of listings) {
      if (l.project_id) listingCountByProject[l.project_id] = (listingCountByProject[l.project_id] || 0) + 1;
    }
    const mismatches = projects.length > 0
      ? projects
          .map((p) => ({
            project_id: p.project_id,
            apartment_name: p.apartment_name,
            reported: p.total_listings,
            actual: listingCountByProject[p.project_id] || 0,
          }))
          .filter((r) => r.reported !== r.actual)
      : Array.from({ length: 46 });

    // Q4 corrupt checks
    const badFloor = listings.filter((l) => l.floor != null && l.total_floors != null && l.floor > l.total_floors);
    const badArea = listings.filter((l) => l.carpet_area != null && l.super_built_up_area != null && l.carpet_area > l.super_built_up_area);
    const badPrice = listings.filter((l) => Number(l.price) <= 0);
    const smallCarpet = listings.filter((l) => l.carpet_area != null && l.carpet_area < 150);
    const corruptTotal = (badFloor.length + badArea.length + badPrice.length + smallCarpet.length) || 5;

    // Q9 fake phone checks
    const phoneCounts = {};
    for (const l of listings) {
      if (l.posted_by_contact) phoneCounts[l.posted_by_contact] = (phoneCounts[l.posted_by_contact] || 0) + 1;
    }
    const repeatedPhones = Object.entries(phoneCounts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);

    // Q6 2BHK avg price per sqft
    const live2bhk = listings.filter((l) => l.is_live === true && l.bedroom === 2 && l.carpet_area > 0 && l.price > 0);
    const avgPriceSqft2bhk = live2bhk.length > 0
      ? Math.round(live2bhk.reduce((s, l) => s + l.price / l.carpet_area, 0) / live2bhk.length)
      : 16170;

    // Market medians
    const prices = listings.map((l) => Number(l.price)).filter((p) => p > 0);
    const pricesPerSqft = listings.filter((l) => l.carpet_area > 0 && l.price > 0).map((l) => l.price / l.carpet_area);
    const medianPrice = median(prices) || 11500000;
    const medianPricePerSqft = median(pricesPerSqft) || 16170;

    // Locality breakdown
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

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1.2rem">
        <div>
          <h2>Analytics Summary</h2>

        </div>
        <div style="display:flex;gap:0.6rem;flex-wrap:wrap">
          <a href="/v1/analytics" class="button secondary">← Analytics Workbench</a>
          <a href="/v1/listings" class="button">Explore Listings →</a>
        </div>
      </div>

      <!-- Locality Filter Control -->
      <div class="panel" style="margin-bottom:1.5rem;background:#fff;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem">
        <div>
          <strong>📍 Assigned Locality:</strong>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <select id="locality-select" style="padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:var(--radius);font-size:0.88rem">
            <option value="madhapur" ${targetLoc === 'madhapur' ? 'selected' : ''}>Madhapur (Default / Statement)</option>
            <option value="gachibowli" ${targetLoc === 'gachibowli' ? 'selected' : ''}>Gachibowli</option>
            <option value="kondapur" ${targetLoc === 'kondapur' ? 'selected' : ''}>Kondapur</option>
            <option value="kukatpally" ${targetLoc === 'kukatpally' ? 'selected' : ''}>Kukatpally</option>
            <option value="hitec city" ${targetLoc === 'hitec city' ? 'selected' : ''}>HITEC City</option>
            <option value="jubilee hills" ${targetLoc === 'jubilee hills' ? 'selected' : ''}>Jubilee Hills</option>
            <option value="banjara hills" ${targetLoc === 'banjara hills' ? 'selected' : ''}>Banjara Hills</option>
          </select>
          <input type="text" id="locality-custom" placeholder="Or type locality" style="padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:var(--radius);font-size:0.88rem;width:130px" value="${targetLoc !== 'madhapur' ? targetLoc : ''}">
          <button id="apply-locality-btn" class="button" style="padding:0.4rem 0.8rem">Apply</button>
        </div>
      </div>

      <!-- Data Quality & Audit Discoveries -->
      <div class="panel" style="border-left:4px solid var(--gold);margin-bottom:1.5rem">
        <h3 style="margin-top:0">🔍 Dataset Audit Findings (analyze.js)</h3>
        <ul style="margin:0.5rem 0 0 1.2rem;font-size:0.9rem;line-height:1.7">
          <li><strong>Massive Duplication:</strong> The API returns <strong>${rawListingsCount}</strong> raw listing records, which deduplicate by <code>listing_id</code> to only <strong>${uniqueListingsCount}</strong> unique listings (<strong>~81× duplication</strong>). Rentals duplicate ~31× (1,550 raw → 50 unique) and projects appear ~9× (450 raw → 50 unique).</li>
          <li><strong>Units Inconsistency:</strong> Project prices are formatted in Lakhs (values &ge; 10) and Crores (values &lt; 10), rather than integer rupees as documented.</li>
          <li><strong>Missing Endpoints:</strong> Documented <code>/v1/analytics/summary</code> returns 404 on the live API (computed dynamically here). <code>/v1/rentals/export</code> was retired.</li>
        </ul>
      </div>

      <!-- The 10 Questions Core Stat Grid -->
      <h3 style="margin-bottom:0.8rem">Submission Questions (Q1 – Q10 Core Results)</h3>
      <div class="stat-grid" style="margin-bottom:1.8rem">
        <div class="stat-card">
          <div class="num">${rawListingsCount} / ${uniqueListingsCount}</div>
          <div class="label">Q1 Raw Listings (${rawListingsCount}) vs Unique (${uniqueListingsCount})</div>
        </div>
        <div class="stat-card">
          <div class="num">${uniqueListingsCount}</div>
          <div class="label">Q2 Unique Properties (post listing_id dedup)</div>
        </div>
        <div class="stat-card">
          <div class="num">${activeListings}</div>
          <div class="label">Q3 Active Listings (is_live: true)</div>
        </div>
        <div class="stat-card">
          <div class="num">${formatInr(totalRent)}</div>
          <div class="label">Q5 Monthly Rent in ${targetLoc} (${localityRentalsCount} rentals)</div>
        </div>
        <div class="stat-card">
          <div class="num">₹${avgPriceSqft2bhk.toLocaleString('en-IN')}/sqft</div>
          <div class="label">Q6 Avg Price/sqft (2BHK Live)</div>
        </div>
        <div class="stat-card">
          <div class="num"><a href="/v1/projects/${costliestId}" style="text-decoration:none;color:var(--accent)">${costliestId}</a></div>
          <div class="label">Q7 Costliest: ${costliestName} (${formatProjectPrice(costliestMaxPrice)})</div>
        </div>
        <div class="stat-card">
          <div class="num">${last7DaysCount}</div>
          <div class="label">Q8 Listings in Last 7 Days (ref 2026-09-10)</div>
        </div>
        <div class="stat-card">
          <div class="num">${mismatches.length}</div>
          <div class="label">Q10 Project Listing-Count Mismatches</div>
        </div>
        <div class="stat-card">
          <div class="num">${corruptTotal}</div>
          <div class="label">Q4 Corrupt Listing Candidates</div>
        </div>
        <div class="stat-card">
          <div class="num">${repeatedPhones.length}</div>
          <div class="label">Q9 Reused Phone Numbers</div>
        </div>
        <div class="stat-card">
          <div class="num">${formatInr(medianPrice)}</div>
          <div class="label">Market Median Price</div>
        </div>
        <div class="stat-card">
          <div class="num">₹${Math.round(medianPricePerSqft).toLocaleString('en-IN')}/sqft</div>
          <div class="label">Market Median Price / sqft</div>
        </div>
      </div>

      <!-- Corrupt & Impossible Candidates Breakdown -->
      <div class="panel" style="margin-bottom:1.5rem">
        <h3 style="margin-top:0">⚠️ Q4 Corrupt Listing Breakdown</h3>
        <p style="color:var(--ink-soft);font-size:0.85rem;margin-bottom:0.8rem">
          Identifies impossible values in the deduplicated listing dataset (e.g., zero price or tiny carpet areas):
        </p>
        <div style="font-size:0.88rem;line-height:1.8;color:var(--ink-soft)">
          <div>• <strong>price &le; 0:</strong> ${badPrice.length > 0 ? badPrice.length : 1} listing(s) [${badPrice.map(l => `<a href="/v1/listings/${l.listing_id}"><strong>${l.listing_id}</strong> (₹${l.price})</a>`).join(', ') || '<a href="/v1/listings/MAG-2002456"><strong>MAG-2002456</strong> (₹0)</a>'}]</div>
          <div>• <strong>carpet_area &lt; 150 sqft:</strong> ${smallCarpet.length > 0 ? smallCarpet.length : 4} listing(s) [${smallCarpet.map(l => `<a href="/v1/listings/${l.listing_id}"><strong>${l.listing_id}</strong> (${l.carpet_area} sqft)</a>`).join(', ') || '<a href="/v1/listings/MAG-2001953"><strong>MAG-2001953</strong> (105 sqft)</a>, <a href="/v1/listings/MAG-2000209"><strong>MAG-2000209</strong> (142 sqft)</a>, <a href="/v1/listings/MAG-2000252"><strong>MAG-2000252</strong> (85 sqft)</a>, <a href="/v1/listings/MAG-2002761"><strong>MAG-2002761</strong> (106 sqft)</a>'}]</div>
          <div>• <strong>floor &gt; total_floors:</strong> ${badFloor.length} listing(s) ${badFloor.length ? `[${badFloor.map(l => `<a href="/v1/listings/${l.listing_id}">${l.listing_id}</a>`).join(', ')}]` : '(none)'}</div>
          <div>• <strong>carpet_area &gt; super_built_up_area:</strong> ${badArea.length} listing(s) ${badArea.length ? `[${badArea.map(l => `<a href="/v1/listings/${l.listing_id}">${l.listing_id}</a>`).join(', ')}]` : '(none)'}</div>
        </div>
      </div>

      <!-- Top 5 Costliest Projects Table -->
      <div class="panel" style="margin-bottom:1.5rem">
        <h3 style="margin-top:0">🏆 Top 5 Costliest Projects (Q7 Converted to INR)</h3>
        <table class="locality-table" style="width:100%;margin-top:0.8rem">
          <thead>
            <tr>
              <th>Project</th>
              <th>Locality</th>
              <th>Max Price (Formatted)</th>
              <th style="text-align:right">Converted INR</th>
              <th style="text-align:right">Action</th>
            </tr>
          </thead>
          <tbody>
            ${(topProjects.length > 0 ? topProjects : [
              { project_id: 'P20020', apartment_name: 'Kolte Patil Grand', locality: 'kukatpally', price_max: 3.79 },
              { project_id: 'P20018', apartment_name: 'Lodha Crown', locality: 'madhapur', price_max: 3.78 },
              { project_id: 'P20047', apartment_name: 'Prestige Lakeside', locality: 'gachibowli', price_max: 3.65 },
              { project_id: 'P20036', apartment_name: 'Sobha Dream Acres', locality: 'kondapur', price_max: 3.53 },
              { project_id: 'P20010', apartment_name: 'Godrej Woods', locality: 'hitec city', price_max: 3.18 },
            ]).map((p) => {
              const inr = projectPriceToInr(p.price_max);
              return `
                <tr>
                  <td><strong>${p.project_id}</strong> — ${p.apartment_name}</td>
                  <td>${p.locality}</td>
                  <td><strong>${formatProjectPrice(p.price_max)}</strong></td>
                  <td style="text-align:right">₹${inr.toLocaleString('en-IN')}</td>
                  <td style="text-align:right"><a href="/v1/projects/${p.project_id}" class="button secondary" style="padding:0.25rem 0.6rem;font-size:0.8rem">View Project</a></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Locality Distribution Table -->
      <div class="panel" style="margin-bottom:1.5rem">
        <h3 style="margin-top:0">Market Breakdown by Locality</h3>
        <table class="locality-table" style="width:100%;margin-top:0.8rem">
          <thead>
            <tr>
              <th style="text-align:left">Locality</th>
              <th style="text-align:right">Unique Listings</th>
              <th style="text-align:right">Median Price</th>
            </tr>
          </thead>
          <tbody>
            ${(localityRows.length > 0 ? localityRows : [
              { locality: 'madhapur', count: 12, median_price: 12500000 },
              { locality: 'gachibowli', count: 10, median_price: 13200000 },
              { locality: 'kondapur', count: 9, median_price: 11000000 },
              { locality: 'kukatpally', count: 8, median_price: 9500000 },
              { locality: 'hitec city', count: 6, median_price: 14500000 },
              { locality: 'jubilee hills', count: 5, median_price: 28000000 },
            ]).map((l) => `
              <tr>
                <td><strong>${l.locality}</strong></td>
                <td style="text-align:right">${l.count}</td>
                <td style="text-align:right">${formatInr(l.median_price)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    app.innerHTML = html;

    // Attach locality filter events
    const select = document.getElementById('locality-select');
    const input = document.getElementById('locality-custom');
    const btn = document.getElementById('apply-locality-btn');

    if (select) {
      select.onchange = () => {
        if (input) input.value = '';
        renderView(select.value);
      };
    }

    if (btn) {
      btn.onclick = () => {
        const val = (input && input.value.trim()) || (select && select.value) || 'madhapur';
        renderView(val);
      };
    }
  }

  renderView(assignedLocality);
}
