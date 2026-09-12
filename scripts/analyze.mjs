#!/usr/bin/env node
// Reads ./data/{listings,rentals,projects}.json (produced by fetch-all-data.mjs)
// and works through the 10 questions in statement.md.
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

function daysAgo(days, ref) {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);
}

async function main() {
  const listings = await loadJson('./data/listings.json');
  const rentals = await loadJson('./data/rentals.json');
  const projects = await loadJson('./data/projects.json');

  console.log(`Loaded ${listings.length} listings, ${rentals.length} rentals, ${projects.length} projects.\n`);

  // ---- Q1: total_listing_records ----------------------------------------
  console.log(`Q1 total_listing_records = ${listings.length}`);

  // ---- Q3: active_listings (is_live true) --------------------------------
  // NOTE: the documented listing object has no `is_live` field — check what
  // the API actually returns. If none of your records carry it, that itself
  // is a documentation gap worth a finding.
  const sample = listings[0] || {};
  console.log(`\nSample listing keys: ${Object.keys(sample).join(', ')}`);
  const hasIsLive = 'is_live' in sample;
  if (hasIsLive) {
    const activeCount = listings.filter((l) => l.is_live === true).length;
    console.log(`Q3 active_listings (is_live === true) = ${activeCount}`);
  } else {
    console.log(`Q3: no 'is_live' field found on listing records — check the raw API response manually before answering.`);
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
  console.log(`\nQ5 total_monthly_rent in '${ASSIGNED_LOCALITY}' = ${totalRent} (over ${localityRentals.length} rental records)`);
  console.log(`   Double check ASSIGNED_LOCALITY spelling matches your email exactly.`);

  // ---- Q7: costliest_project ------------------------------------------------
  let costliest = null;
  for (const p of projects) {
    if (!costliest || Number(p.price_max) > Number(costliest.price_max)) costliest = p;
  }
  console.log(`\nQ7 costliest_project = { project_id: ${costliest?.project_id}, price_max_inr: ${costliest?.price_max} }`);

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
  console.log(`\nQ10 candidate mismatches (reported total_listings vs. count of listings with that project_id in /v1/listings): ${mismatches.length}`);
  console.log('   First 15:', mismatches.slice(0, 15));
  console.log('   Caution: total_listings is documented as "currently available", i.e. active listings only.');
  console.log('   If your /v1/listings pull already excludes inactive listings (per docs), this comparison is apples-to-apples.');
  console.log('   But if is_live exists and some retrievable listings are NOT live, re-run this filtered to is_live === true first.');

  // ---- Q2: unique_properties (candidate dedup heuristics) ------------------
  console.log(`\nQ2 candidate duplicate-grouping heuristics (inspect before choosing one):`);
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
    console.log(`   ${label}: ${dupGroups.length} groups with >1 record, ${extraRecords} "extra" records → implies ${listings.length - extraRecords} unique properties if this key is right`);
    if (dupGroups.length) console.log(`     sample group: ${JSON.stringify(dupGroups[0])}`);
  }

  // ---- Q4 / Q9: corrupt / fake candidates -----------------------------------
  console.log(`\nQ4 candidate "impossible" records (inspect each rule separately):`);
  const badFloor = listings.filter((l) => l.floor != null && l.total_floors != null && l.floor > l.total_floors);
  console.log(`   floor > total_floors: ${badFloor.length} — e.g. ${badFloor.slice(0, 10).map((l) => l.listing_id)}`);
  const badArea = listings.filter((l) => l.carpet_area != null && l.super_built_up_area != null && l.carpet_area > l.super_built_up_area);
  console.log(`   carpet_area > super_built_up_area: ${badArea.length} — e.g. ${badArea.slice(0, 10).map((l) => l.listing_id)}`);
  const badPrice = listings.filter((l) => Number(l.price) <= 0);
  console.log(`   price <= 0: ${badPrice.length} — e.g. ${badPrice.slice(0, 10).map((l) => l.listing_id)}`);
  const badBedroomBath = listings.filter((l) => l.bedroom === 0 || l.bathroom === 0);
  console.log(`   bedroom or bathroom === 0: ${badBedroomBath.length} — e.g. ${badBedroomBath.slice(0, 10).map((l) => l.listing_id)}`);
  const badBalcony = listings.filter((l) => l.balcony != null && l.bedroom != null && l.balcony > l.bedroom + 2);
  console.log(`   balcony notably higher than bedroom count (loose heuristic): ${badBalcony.length}`);

  console.log(`\nQ9 candidate "fake" signals (inspect before choosing one):`);
  const phoneCounts = {};
  for (const l of listings) {
    if (l.posted_by_contact) phoneCounts[l.posted_by_contact] = (phoneCounts[l.posted_by_contact] || 0) + 1;
  }
  const repeatedPhones = Object.entries(phoneCounts).filter(([, c]) => c > 3).sort((a, b) => b[1] - a[1]);
  console.log(`   phone numbers reused across >3 listings: ${repeatedPhones.length} numbers — top 10:`, repeatedPhones.slice(0, 10));
  if (repeatedPhones.length) {
    const [worstPhone] = repeatedPhones[0];
    const idsForWorst = listings.filter((l) => l.posted_by_contact === worstPhone).map((l) => l.listing_id);
    console.log(`   listings using the most-reused number (${worstPhone}):`, idsForWorst.slice(0, 15));
  }

  // ---- Q6 depends on Q4 and Q9 answers being finalized first --------------
  console.log(`\nQ6 avg_price_per_sqft_2bhk: compute this LAST, after you've finalized Q4 and Q9 answers.`);
  console.log(`   Formula once ready: mean of (price / carpet_area) over listings where is_live===true, bedroom===2,`);
  console.log(`   excluding listing_ids in your final corrupt_listing_ids and fake_listing_ids lists.`);

  // Write a small, safe subset to power the Insights page in the frontend.
  const insights = {
    stats: {
      'Total listing records': listings.length,
      'Total rentals': rentals.length,
      'Total projects': projects.length,
      [`Rentals in ${ASSIGNED_LOCALITY}`]: localityRentals.length,
      'Listings posted in last 7 days (ref 2026-09-10 IST)': in7Days.length,
      'Projects with reported vs. actual listing-count mismatch (candidate)': mismatches.length,
    },
    notes: [
      'Figures above are descriptive only — see console output from analyze.mjs for the full candidate breakdowns used to reach the graded answers.',
    ],
  };
  await fs.writeFile('./data/insights.json', JSON.stringify(insights, null, 2));
  console.log(`\nWrote data/insights.json for the frontend Insights page.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
