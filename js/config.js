// Fill in your own key here before deploying, or set it via localStorage in the browser console:
//   localStorage.setItem('ivy_api_key', 'IVY26-XXXXXXXXXXXX')
// The app falls back to this constant if nothing is in localStorage.
export const BASE_URL = 'https://solve.ivy.homes';
export const DEFAULT_API_KEY = 'IVY26-33921F0CFE7B';

export function getApiKey() {
  return localStorage.getItem('ivy_api_key') || DEFAULT_API_KEY;
}
