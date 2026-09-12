import { BASE_URL, getApiKey } from './config.js';

const TOKEN_KEY = 'ivy_token';
const USER_KEY = 'ivy_user';
const EXPIRES_KEY = 'ivy_token_expires_at';

export function getToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(localStorage.getItem(EXPIRES_KEY) || 0);
  if (!token || Date.now() > expiresAt) return null;
  return token;
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function isLoggedIn() {
  return !!getToken();
}

export async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': getApiKey() },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.detail || `Login failed (${res.status})`);
  }

  // The docs promise a `token` field. If the live response uses a different
  // name, don't silently store the string "undefined" (which is what causes
  // a confusing "malformed or tampered token" error on the *next* request
  // instead of a clear error right here). Try the documented name and a
  // couple of common alternates, and fail loudly if none match.
  const token = body.token || body.access_token || body.jwt || body.auth_token;
  if (!token || typeof token !== 'string') {
    console.error('Login response did not contain a recognizable token field. Raw response:', body);
    throw new Error(
      'Login succeeded but no usable token was found in the response. Check the browser console for the raw response shape — the field name may differ from what the docs promise.'
    );
  }

  const expiresAt = Date.now() + (body.expires_in ? body.expires_in * 1000 : 86400 * 1000);
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(body.user || { email }));
  localStorage.setItem(EXPIRES_KEY, String(expiresAt));
  return body;
}

export async function logout() {
  const token = getToken();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(EXPIRES_KEY);
  if (token) {
    try {
      await fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-API-Key': getApiKey() },
      });
    } catch {
      // best-effort; local session is already cleared
    }
  }
}
