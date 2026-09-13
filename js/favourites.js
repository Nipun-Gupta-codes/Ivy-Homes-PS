// Pure localStorage-based favourites implementation.
// The documented /v1/favourites endpoint returns 404 on the live API — this is
// a genuine missing_endpoint finding. We fall back to localStorage so the feature
// works without a server-side endpoint.

import { getUser } from './auth.js';

function getStorageKey() {
  const user = getUser();
  if (user && user.email) {
    return `ivy_favourites_${user.email}`;
  }
  return 'ivy_favourites_anon';
}

let cache = null;
let currentKey = null;

function ensureCache() {
  const expectedKey = getStorageKey();
  if (!cache || currentKey !== expectedKey) {
    currentKey = expectedKey;
    try {
      cache = new Set(JSON.parse(localStorage.getItem(currentKey) || '[]'));
    } catch {
      cache = new Set();
    }
  }
}

function writeIds() {
  if (!cache) return;
  localStorage.setItem(currentKey, JSON.stringify([...cache]));
}

export let lastLoadError = null;

export async function loadFavourites() {
  ensureCache();
  lastLoadError = null;
  // Return an array of { listing_id } objects so callers that iterate .results still work.
  return [...cache].map((id) => ({ listing_id: id }));
}

export function isFavourited(id) {
  ensureCache();
  return cache.has(id);
}

export async function addFavourite(id) {
  ensureCache();
  cache.add(id);
  writeIds();
}

export async function removeFavourite(id) {
  ensureCache();
  cache.delete(id);
  writeIds();
}
