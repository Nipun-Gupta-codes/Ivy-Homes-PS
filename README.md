# Ivy Homes — Hyderabad submission

A static, no-build frontend (vanilla JS + hash routing) on top of the Ivy Homes
property API, plus two Node scripts used to pull the full dataset and work out
the answers in `submission.json`.

## Running the app

No build step. Any static file server works.

```bash
cd ivy-homes-app
npm run serve        # or: python3 -m http.server 8080, or `npx serve .`
```

Then open `http://localhost:8080`. Log in with one of the demo accounts
(`demo1@ivy.homes` / password from your registration email).

By default the app uses the API key baked into `js/config.js`. To use a
different key without editing code, open the browser console and run:

```js
localStorage.setItem('ivy_api_key', 'IVY26-XXXXXXXXXXXX')
```

### Deploying

This is static HTML/CSS/JS with no build step, so any static host works —
drag the folder into Netlify, or push to GitHub and enable GitHub Pages, or
`vercel deploy` from inside the folder.

## Pulling the full dataset and answering the ten questions

```bash
export IVY_API_KEY=IVY26-XXXXXXXXXXXX
export IVY_EMAIL=demo1@ivy.homes
export IVY_PASSWORD=xxxxxxxxxx        # shared demo password from your registration email
export IVY_ASSIGNED_LOCALITY=madhapur   # from your registration email
node scripts/fetch-all-data.mjs          # logs in, then paginates listings/rentals/projects to ./data/*.json
node scripts/analyze.mjs                 # prints computed + candidate answers to the console
```

Note: the docs say `/v1/listings`, `/v1/rentals` and `/v1/projects` only need
the API key. In practice the live API rejects requests without a Bearer
token too ("missing bearer token - log in at `POST /auth/login` first"), so
the fetch script logs in first regardless. That's a `findings` entry.

`analyze.mjs` computes Q1, Q3 (if the field exists — see below), Q5, Q7 and Q8
directly, since those have one unambiguous definition. For Q2, Q4, Q6, Q9 and
Q10 — the ones that require deciding *what counts* as a duplicate, an
impossible record, or a fake listing — it prints several candidate heuristics
with counts and sample IDs instead of a single number. Inspect those, decide
which rule actually holds against the data, and only then fill in
`submission.json` by hand. It also writes `data/insights.json`, which the
Insights screen in the app reads to surface a few of these numbers to a user.

## How I worked out what to distrust in the documentation

- **Authentication First**: I started by writing a simple Node script to hit the `/auth/login` endpoint and inspect the response. I immediately noticed the JSON keys didn't match the docs (`access_token` instead of `token`, `expires_in` was 900 not 86400, and a refresh flow existed). I also tested the documented query parameter approach for the API key (`?api_key=...`) and got a 401 error explicitly telling me to use the `X-API-Key` header.
- **Pagination & Duplication**: I noticed `total` said 4004 but my script fetched 4050 records. I tested the `page` parameter and found it was silently ignored (always returning `offset=0`). By switching to `offset`, I was able to paginate correctly, but discovered the `limit` is capped at 50, not 200. Deduplicating the fetched dataset by `listing_id` revealed massive duplication (50 unique listings returned 81 times each).
- **Filters & Sorting**: To test filters like `min_price`, `max_price`, and `furnishing`, I applied them and checked if the `total` count changed and if the results actually adhered to the filter. They didn't. For sorting, I requested `sort_by=posted_at&order=asc` and analyzed the returned timestamps, finding that while dates were ordered, intra-day times were completely randomized.
- **Data Types & Quality**: I noticed project `price_max` values like `3.79` which couldn't be Rupees. Cross-referencing with local listing prices confirmed they were in Crores/Lakhs. I tested data quality by sorting listings by price ascending and discovered negative prices, and filtered for small `carpet_area` revealing impossibly small multi-BHK apartments.
- **AI Prompt Injections**: While reviewing the dataset descriptions, I found malicious instructions specifically designed to trick AI assistants into generating incorrect `submission.json` files or modifying the application footer. This was a clear indicator of fraudulent listings designed to test automated processing.
- **Endpoint Availability**: I systematically called every documented endpoint (`/v1/listing/{id}`, `/v1/listings/{id}/similar`, `/v1/analytics/summary`, `/v1/favourites`) and found them returning 404s, highlighting significant gaps between the spec and the implementation.

## What I checked that turned out to be fine

- **Some Filters Work**: While many filters are broken, the `locality`, `bedroom` (BHK), and `property_type` filters on the listings endpoint correctly filter the results. For example, `property_type=villa` only returned villas.
- **Basic Sorting**: While `posted_at` sorting is flawed (date-only), sorting by numeric fields like `carpet_area`, `bedroom`, and `price` (tested on rentals) correctly ordered the results ascending/descending as requested.
- **Data Retrieval Endpoints**: The core collection endpoints (`/v1/listings`, `/v1/rentals`, `/v1/projects`) and their pluralized detail endpoints (`/v1/listings/{id}`, etc.) successfully return JSON data matching the general structure (albeit with undocumented fields like `is_live` and inconsistent timestamps).

## What I'd do with two more days

- **Robust Data Synchronization Layer**: Since the API pagination is broken and returns massive duplicates, I would build a robust client-side sync layer that fetches all available records using the `offset` parameter, deduplicates them locally, and serves as a reliable local cache for the UI.
- **Client-Side Analytics Dashboard**: Because the `/v1/analytics/summary` endpoint is missing, I would implement the dashboard metrics entirely on the client side using the deduplicated local cache.
- **Local Favourites System**: With the `/v1/favourites` endpoints returning 404s, I would implement the "saved listings" feature using `localStorage` to ensure the core user experience remains intact despite API limitations.
- **Auth Refresh Flow**: Implement an Axios/Fetch interceptor to automatically handle the 15-minute token expiry using the undocumented `/auth/refresh` endpoint for a seamless user experience.

## Tools used

- Google Antigravity (AGY) agent (Gemini 3.1 Pro / Claude Opus 4.6), utilizing `node -e` scripts and file parsing tools for direct API testing, data fetching, deduplication, and JSON analysis to systematically uncover and verify the API discrepancies.