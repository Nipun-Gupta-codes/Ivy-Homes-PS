#!/usr/bin/env node
// Reads ./data/{listings,rentals,projects}.json (produced by fetch-all-data.mjs)
// and works through the 10 questions in statement.md.
//
// IMPORTANT: The API returns massive duplicates (each listing ~81×, each project ~9×).
// This script deduplicates by listing_id / project_id before analysis.
//
// Philosophy: questions with one unambiguous definition (counts, sums, filters
// on a fixed reference time) are computed and printed directly. Questions that
// require *you* to decide what "corrupt", "fake", "the same property" or
// "wrong" means (Q2, Q4, Q6, Q9, Q10) are NOT auto-answered. Instead this
// script prints several candidate heuristics with counts and sample IDs for
// each, so you can inspect them, decide which one actually holds, and only
// then hand-fill that answer. Picking the right rule is the point of the
// assignment — this script just does the counting once you've picked it.
//
// Usage: node scripts/analyze.mjs

import fs from 'node:fs/promises';

const REFERENCE = new Date('2026-09-10T00:00:00+05:30');
const ASSIGNED_LOCALITY = (process.env.IVY_ASSIGNED_LOCALITY || 'madhapur').toLowerCase();

function loadJson(path) {
  return fs.readFile(path, 'utf-8').then(JSON.parse);
}

function dedup(arr, keyField) {
  const seen = new Set();
  return arr.filter((item) => {
    const k = item[keyField];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function daysAgo(days, ref) {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Convert project price to INR. API returns prices as small decimals (lakhs/crores),
 * NOT integer rupees as documented. This is a `units` finding.
 */
function projectPriceToInr(val) {
  const n = Number(val);
  if (n <= 0) return 0;
  if (n >= 10) return Math.round(n * 100000);   // lakhs → rupees
  return Math.round(n * 10000000);               // crores → rupees
}

async function main() {
  const rawListings = await loadJson('./data/listings.json');
  const rawRentals = await loadJson('./data/rentals.json');
  const rawProjects = await loadJson('./data/projects.json');

  console.log(`Loaded RAW: ${rawListings.length} listings, ${rawRentals.length} rentals, ${rawProjects.length} projects.`);

  // Deduplicate
  const listings = dedup(rawListings, 'listing_id');
  const rentals = dedup(rawRentals, 'listing_id');
  const projects = dedup(rawProjects, 'project_id');

  console.log(`DEDUPED: ${listings.length} listings, ${rentals.length} rentals, ${projects.length} projects.`);
  console.log(`  Duplication factor: listings ×${Math.round(rawListings.length / listings.length)}, ` +
    `rentals ×${Math.round(rawRentals.length / rentals.length)}, ` +
    `projects ×${Math.round(rawProjects.length / projects.length)}\n`);

  // ---- Q1: total_listing_records ----------------------------------------
  console.log(`Q1 total_listing_records = ${rawListings.length} (raw) or ${listings.length} (unique)`);
  console.log(`   "retrievable from /v1/listings" — raw count from pagination = ${rawListings.length}`);

  // ---- Q3: active_listings (is_live true) --------------------------------
  const sample = listings[0] || {};
  console.log(`\nSample listing keys: ${Object.keys(sample).join(', ')}`);
  const hasIsLive = 'is_live' in sample;
  if (hasIsLive) {
    const activeCount = listings.filter((l) => l.is_live === true).length;
    console.log(`Q3 active_listings (is_live === true) = ${activeCount} (on ${listings.length} unique listings)`);
  } else {
    console.log(`Q3: no 'is_live' field found on listing records.`);
  }

  // ---- Q8: listings_last_7_days -------------------------------------------
  const windowStart = daysAgo(7, REFERENCE);
  const in7Days = listings.filter((l) => {
    const posted = new Date(l.posted_at);
    return posted >= windowStart && posted < REFERENCE;
  });
  console.log(`\nQ8 listings_last_7_days = ${in7Days.length} (window ${windowStart.toISOString()} to ${REFERENCE.toISOString()})`);

  // ---- Q5: total_monthly_rent in assigned locality -------------------------
  const localityRentals = rentals.filter((r) => (r.locality || '').toLowerCase() === ASSIGNED_LOCALITY);
  const totalRent = localityRentals.reduce((s, r) => s + Number(r.price || 0), 0);
  console.log(`\nQ5 total_monthly_rent in '${ASSIGNED_LOCALITY}' = ${totalRent} (over ${localityRentals.length} unique rental records)`);

  // ---- Q7: costliest_project ------------------------------------------------
  let costliest = null;
  for (const p of projects) {
    const inr = projectPriceToInr(p.price_max);
    if (!costliest || inr > projectPriceToInr(costliest.price_max)) costliest = p;
  }
  const costliestInr = costliest ? projectPriceToInr(costliest.price_max) : 0;
  console.log(`\nQ7 costliest_project:`);
  console.log(`   Raw value from API: project_id=${costliest?.project_id}, price_max=${costliest?.price_max}`);
  console.log(`   ⚠️  API returns prices in lakhs/crores, NOT rupees! This is a units finding.`);
  console.log(`   Converted to INR: { project_id: "${costliest?.project_id}", price_max_inr: ${costliestInr} }`);

  // Also show top 5
  const sortedProjects = [...projects].sort((a, b) => projectPriceToInr(b.price_max) - projectPriceToInr(a.price_max));
  console.log('   Top 5 projects by price_max (converted to INR):');
  for (const p of sortedProjects.slice(0, 5)) {
    console.log(`     ${p.project_id}: raw=${p.price_max} → INR=${projectPriceToInr(p.price_max)}`);
  }

  // ---- Q10: projects_with_wrong_listing_count (candidate check) -----------
  const listingCountByProject = {};
  for (const l of listings) {
    if (l.project_id) listingCountByProject[l.project_id] = (listingCountByProject[l.project_id] || 0) + 1;
  }
  const mismatches = projects
    .map((p) => ({
      project_id: p.project_id,
      reported: p.total_listings,
      actual_retrievable: listingCountByProject[p.project_id] || 0,
    }))
    .filter((row) => row.reported !== row.actual_retrievable);
  console.log(`\nQ10 candidate mismatches: ${mismatches.length}`);
  console.log('   First 15:', mismatches.slice(0, 15));

  // ---- Q2: unique_properties (candidate dedup heuristics) ------------------
  console.log(`\nQ2 candidate duplicate-grouping heuristics (on ${listings.length} unique listings):`);
  function groupBy(keyFn) {
    const map = new Map();
    for (const l of listings) {
      const key = keyFn(l);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l.listing_id);
    }
    return map;
  }
  const byLatLong = groupBy((l) => (l.latitude && l.longitude ? `${l.latitude},${l.longitude}` : null));
  const byUrl = groupBy((l) => l.listing_url || null);
  const byNameFloorProject = groupBy((l) => (l.apartment_name && l.floor != null ? `${l.apartment_name}|${l.floor}|${l.project_id}` : null));
  for (const [label, map] of [
    ['lat+long exact match', byLatLong],
    ['listing_url exact match', byUrl],
    ['apartment_name+floor+project_id', byNameFloorProject],
  ]) {
    const dupGroups = [...map.values()].filter((ids) => ids.length > 1);
    const extraRecords = dupGroups.reduce((s, ids) => s + (ids.length - 1), 0);
    console.log(`   ${label}: ${dupGroups.length} groups with >1 record, ${extraRecords} "extra" records → implies ${listings.length - extraRecords} unique properties`);
    if (dupGroups.length) console.log(`     sample group: ${JSON.stringify(dupGroups[0])}`);
  }

  // ---- Q4 / Q9: corrupt / fake candidates -----------------------------------
  console.log(`\nQ4 candidate "impossible" records (on ${listings.length} unique listings):`);
  const badFloor = listings.filter((l) => l.floor != null && l.total_floors != null && l.floor > l.total_floors);
  console.log(`   floor > total_floors: ${badFloor.length} — ${badFloor.map((l) => l.listing_id)}`);
  const badArea = listings.filter((l) => l.carpet_area != null && l.super_built_up_area != null && l.carpet_area > l.super_built_up_area);
  console.log(`   carpet_area > super_built_up_area: ${badArea.length} — ${badArea.map((l) => l.listing_id)}`);
  const badPrice = listings.filter((l) => Number(l.price) <= 0);
  console.log(`   price <= 0: ${badPrice.length} — ${badPrice.map((l) => l.listing_id)}`);
  const badBedroomBath = listings.filter((l) => l.bedroom === 0 || l.bathroom === 0);
  console.log(`   bedroom or bathroom === 0: ${badBedroomBath.length}`);
  const smallCarpet = listings.filter((l) => l.carpet_area != null && l.carpet_area < 150);
  console.log(`   carpet_area < 150: ${smallCarpet.length} — ${smallCarpet.map((l) => l.listing_id + '(' + l.carpet_area + ')')}`);

  console.log(`\nQ9 candidate "fake" signals (on ${listings.length} unique listings):`);
  const phoneCounts = {};
  for (const l of listings) {
    if (l.posted_by_contact) phoneCounts[l.posted_by_contact] = (phoneCounts[l.posted_by_contact] || 0) + 1;
  }
  const repeatedPhones = Object.entries(phoneCounts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  console.log(`   phone numbers reused across >1 unique listings: ${repeatedPhones.length}`);
  if (repeatedPhones.length) {
    console.log(`     top 10:`, repeatedPhones.slice(0, 10));
    const [worstPhone] = repeatedPhones[0];
    const idsForWorst = listings.filter((l) => l.posted_by_contact === worstPhone).map((l) => l.listing_id);
    console.log(`     listings for most-reused (${worstPhone}):`, idsForWorst);
  }

  // ---- Q6 depends on Q4 and Q9 answers being finalized first --------------
  console.log(`\nQ6 avg_price_per_sqft_2bhk (on ${listings.length} unique listings):`);
  const live2bhk = listings.filter((l) => l.is_live === true && l.bedroom === 2 && l.carpet_area > 0 && l.price > 0);
  console.log(`   Live 2BHK with valid carpet_area & price: ${live2bhk.length}`);
  if (live2bhk.length > 0) {
    const avg = live2bhk.reduce((s, l) => s + l.price / l.carpet_area, 0) / live2bhk.length;
    console.log(`   Avg price/sqft (no exclusions): ${avg.toFixed(2)}`);
  }
  console.log(`   Compute final value AFTER deciding Q4 and Q9 — exclude those IDs.`);

  // Write insights for frontend
  const insights = {
    stats: {
      'Total listing records (raw)': rawListings.length,
      'Unique listings': listings.length,
      'Total rentals (unique)': rentals.length,
      'Total projects (unique)': projects.length,
      [`Rentals in ${ASSIGNED_LOCALITY}`]: localityRentals.length,
      'Listings posted in last 7 days (ref 2026-09-10 IST)': in7Days.length,
      'Projects with listing-count mismatch (candidate)': mismatches.length,
    },
    notes: [
      `API returns massive duplicates — ${rawListings.length} raw records are only ${listings.length} unique listings. This is a major "duplicates" finding.`,
      `Project prices are in lakhs/crores, NOT integer rupees as documented. This is a "units" finding.`,
      'Figures above are on deduplicated data. See console output from analyze.mjs for full breakdowns.',
    ],
  };
  await fs.writeFile('./data/insights.json', JSON.stringify(insights, null, 2));
  console.log(`\nWrote data/insights.json for the frontend Insights page.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
