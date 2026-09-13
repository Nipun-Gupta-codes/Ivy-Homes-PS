const routes = [];

export function route(pattern, handler) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const regex = new RegExp(`^${regexStr}/?$`);
  routes.push({ regex, paramNames, handler });
}

export function normalizePath(p) {
  if (!p) return '/v1/listings';
  let clean = p.replace(/^#\/?/, '/').trim();
  if (!clean.startsWith('/')) clean = '/' + clean;
  // Handle root or index
  if (clean === '/' || clean === '/index.html') return '/v1/listings';
  // Ensure /v1 prefix if not present (unless it's a known route like /login)
  if (!clean.startsWith('/v1/') && clean !== '/v1') {
    clean = '/v1' + clean;
  }
  return clean;
}

export function currentPath() {
  if (location.hash) {
    const fromHash = location.hash.replace(/^#\/?/, '/');
    const normalized = normalizePath(fromHash);
    // Replace hash with clean path in browser URL bar
    try {
      history.replaceState(null, '', normalized);
    } catch { /* fine */ }
    return normalized;
  }

  const p = location.pathname;
  return normalizePath(p);
}

export function navigate(path) {
  const normalized = normalizePath(path);
  if (location.pathname !== normalized || location.hash) {
    history.pushState(null, '', normalized);
  }
  resolve();
}

export async function resolve() {
  const path = currentPath();
  const app = document.getElementById('app');

  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
      app.innerHTML = '<div class="empty">Loading…</div>';
      try {
        await r.handler(params, app);
      } catch (err) {
        app.innerHTML = `<div class="notice error">${err.message || 'Something went wrong.'}</div>`;
      }
      highlightNav(path);
      return;
    }
  }

  app.innerHTML = `
    <div class="panel" style="text-align:center;padding:2rem">
      <h2>Page Not Found</h2>
      <p style="color:var(--ink-soft);margin-top:0.5rem">The requested path <code>${path}</code> does not exist.</p>
      <p style="margin-top:1rem"><a href="/v1/listings" class="button">Go to Listings</a></p>
    </div>
  `;
}

function highlightNav(path) {
  const normPath = normalizePath(path);
  document.querySelectorAll('#nav a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const normHref = normalizePath(href);
    const isActive = normPath === normHref;
    a.classList.toggle('active', isActive);
  });
}

export function startRouter() {
  window.addEventListener('popstate', resolve);
  window.addEventListener('hashchange', resolve);

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;

    // Ignore external or target=_blank links
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//') || a.target === '_blank') {
      return;
    }

    // Intercept internal routes (both path and hash)
    if (href.startsWith('/') || href.startsWith('#')) {
      e.preventDefault();
      navigate(href);
    }
  });

  const path = currentPath();
  if (location.pathname === '/' || location.pathname === '/index.html' || location.hash) {
    try {
      history.replaceState(null, '', path);
    } catch { /* fine */ }
  }

  resolve();
}
