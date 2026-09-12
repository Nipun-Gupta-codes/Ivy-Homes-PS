#!/usr/bin/env node
// Pulls every retrievable record from /v1/listings, /v1/rentals and /v1/projects
// for your API key's city, and writes them to ./data/*.json.
//
// Usage:
//   IVY_API_KEY=IVY26-XXXX IVY_EMAIL=demo1@ivy.homes IVY_PASSWORD=xxxx node scripts/fetch-all-data.mjs
//
// Requires Node 18+ (for built-in fetch). No dependencies.
//
// NOTE: the docs say /v1/listings, /v1/rentals and /v1/projects only need the
// API key -- no login required. In practice the live API rejects requests
// without a Bearer token ("missing bearer token - log in at POST /auth/login
// first"), so this script logs in first regardless of what those endpoints
// are documented to need. Worth a `findings` entry.

const BASE_URL = process.env.IVY_BASE_URL || 'https://solve.ivy.homes';
const API_KEY = process.env.IVY_API_KEY;
const EMAIL = process.env.IVY_EMAIL || 'demo1@ivy.homes';
const PASSWORD = process.env.IVY_PASSWORD;
const LIMIT = 200; // documented max

if (!API_KEY) {
  console.error('Set IVY_API_KEY before running this script.');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('Set IVY_PASSWORD (the shared demo-account password from your registration email).');
  process.exit(1);
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${body.detail || ''}`);
  const token = body.token || body.access_token || body.jwt || body.auth_token;
  if (!token || typeof token !== 'string') {
    console.error('Raw login response:', JSON.stringify(body, null, 2));
    throw new Error('Login succeeded but no recognizable token field was found — see raw response above.');
  }
  return token;
}

async function fetchAllPages(path, token) {
  let page = 1;
  let all = [];
  let total = Infinity;
  while (all.length < total) {
    const url = `${BASE_URL}${path}?page=${page}&limit=${LIMIT}`;
    const res = await fetch(url, {
      headers: { 'X-API-Key': API_KEY, Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`${path} page ${page} failed: ${res.status} ${body.detail || ''}`);
    }
    total = body.total;
    all = all.concat(body.results || []);
    console.log(`  ${path}: page ${page}, +${body.results?.length || 0} records, ${all.length}/${total} so far`);
    if (!body.results || body.results.length === 0) break; // safety valve against infinite loop
    page += 1;
  }
  return all;
}

async function main() {
  const fs = await import('node:fs/promises');
  await fs.mkdir('./data', { recursive: true });

  console.log(`Logging in as ${EMAIL}...`);
  const token = await login();
  console.log('Logged in.\n');

  console.log('Fetching listings...');
  const listings = await fetchAllPages('/v1/listings', token);
  await fs.writeFile('./data/listings.json', JSON.stringify(listings, null, 2));
  console.log(`Saved ${listings.length} listings to data/listings.json\n`);

  console.log('Fetching rentals...');
  const rentals = await fetchAllPages('/v1/rentals', token);
  await fs.writeFile('./data/rentals.json', JSON.stringify(rentals, null, 2));
  console.log(`Saved ${rentals.length} rentals to data/rentals.json\n`);

  console.log('Fetching projects...');
  const projects = await fetchAllPages('/v1/projects', token);
  await fs.writeFile('./data/projects.json', JSON.stringify(projects, null, 2));
  console.log(`Saved ${projects.length} projects to data/projects.json\n`);

  console.log('Done. Now run: node scripts/analyze.mjs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
