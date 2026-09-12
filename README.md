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

<!-- TODO: replace with your own account. Suggested structure:
- What you checked first (e.g. hit every documented endpoint once, diffed the
  shape of a real response against the documented example)
- Which specific fields/params you suspected were wrong and why (e.g. a field
  name that doesn't appear in the docs at all, like `is_live`)
- How you tested each hypothesis against the *whole* dataset rather than one
  record, and what the base rate looked like
-->

## What I checked that turned out to be fine

<!-- TODO: this is explicitly asked for in the assignment — list the
hypotheses you tested and ruled out, not just the ones that panned out. -->

## What I'd do with two more days

<!-- TODO -->

## Tools used

<!-- TODO: name the LLM(s)/tools you used and roughly how, per the assignment's
rules — this costs nothing to disclose and not disclosing it costs the
internship. -->
