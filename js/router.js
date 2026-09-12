const routes = [];

export function route(pattern, handler) {
  // pattern like '/listings/:id' -> regex with named groups
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

function currentPath() {
  const hash = location.hash || '#/listings';
  return hash.slice(1) || '/listings';
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
  app.innerHTML = '<div class="empty">Not found.</div>';
}

function highlightNav(path) {
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', path.startsWith(a.getAttribute('href').slice(1)));
  });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
