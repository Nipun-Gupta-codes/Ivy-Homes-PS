import { BASE_URL, getApiKey } from './config.js';
import { getToken } from './auth.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Builds a URL against the base, plus any extra query params.
// NOTE: the documentation says to send the key as an `api_key` query param —
// the live API actually rejects that and wants an `X-API-Key` header instead.
// See buildHeaders() below. This is a documented `auth` finding.
function buildUrl(path, params = {}) {
  const url = new URL(path.replace(/^\//, ''), BASE_URL + '/');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

function buildHeaders({ auth = false, json = false } = {}) {
  const headers = { 'X-API-Key': getApiKey() };
  if (json) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function logRequest(method, url, headers, body) {
  console.log(`[API] ${method} ${url}`, { headers, ...(body ? { body } : {}) });
}

export async function apiGet(path, params = {}, { auth = false } = {}) {
  const url = buildUrl(path, params);
  const headers = buildHeaders({ auth });
  logRequest('GET', url, headers);
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(`${body.detail || 'Request failed'} (${res.status} on GET ${url})`, res.status);
  return body;
}

export async function apiPost(path, data, { auth = true } = {}) {
  const url = buildUrl(path);
  const headers = buildHeaders({ auth, json: true });
  logRequest('POST', url, headers, data);
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(`${body.detail || 'Request failed'} (${res.status} on POST ${url})`, res.status);
  return body;
}

export async function apiDelete(path, { auth = true } = {}) {
  const url = buildUrl(path);
  const headers = buildHeaders({ auth });
  logRequest('DELETE', url, headers);
  const res = await fetch(url, { method: 'DELETE', headers });
  if (res.status === 204) return {};
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(`${body.detail || 'Request failed'} (${res.status} on DELETE ${url})`, res.status);
  return body;
}

// Fetches ALL pages of a collection endpoint and returns the concatenated results.
// Used by the in-app Analysis tool to answer the "retrievable records" questions
// without needing to run a separate Node script.
export async function fetchAllPages(path, params = {}, { limit = 200, auth = true, onProgress } = {}) {
  let page = 1;
  let all = [];
  let total = Infinity;
  while (all.length < total) {
    const body = await apiGet(path, { ...params, page, limit }, { auth });
    total = body.total;
    all = all.concat(body.results || []);
    if (onProgress) onProgress({ path, page, fetched: all.length, total });
    if (!body.results || body.results.length === 0) break; // safety valve
    page += 1;
  }
  return all;
}
