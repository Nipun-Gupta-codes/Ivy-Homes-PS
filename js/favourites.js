import { apiGet, apiPost, apiDelete, ApiError } from './api.js';

let cache = null; // Set of listing_ids, refreshed per session
export let lastLoadError = null; // exposed so pages can show a helpful note

export async function loadFavourites() {
  try {
    const body = await apiGet('/v1/favourites', {}, { auth: true });
    cache = new Set((body.results || []).map((l) => l.listing_id));
    lastLoadError = null;
    return body.results || [];
  } catch (err) {
    lastLoadError = err;
    cache = cache || new Set();
    // Re-throw so callers that want to show a specific message still can —
    // but they can also just check lastLoadError.status afterwards.
    throw err;
  }
}

export function isFavourited(id) {
  return !!cache && cache.has(id);
}

export async function addFavourite(id) {
  await apiPost('/v1/favourites', { id }, { auth: true });
  if (cache) cache.add(id);
}

export async function removeFavourite(id) {
  await apiDelete(`/v1/favourites/${encodeURIComponent(id)}`, { auth: true });
  if (cache) cache.delete(id);
}
