import { route, startRouter, navigate } from './router.js';
import { isLoggedIn, getUser, logout } from './auth.js';
import { renderLogin } from './pages/login.js';
import { renderListings } from './pages/listings.js';
import { renderListingDetail } from './pages/listingDetail.js';
import { renderRentals } from './pages/rentals.js';
import { renderProjects, renderProjectDetail } from './pages/projects.js';
import { renderFavourites } from './pages/favouritesPage.js';
import { renderInsights } from './pages/insights.js';
import { renderAnalytics } from './pages/analysis.js';
import { renderAnalyticsSummary } from './pages/analyticsSummary.js';

const NAV_LINKS = [
  ['/v1/listings', 'Listings'],
  ['/v1/rentals', 'Rentals'],
  ['/v1/projects', 'Projects'],
  ['/v1/favourites', 'Saved'],
  ['/v1/insights', 'Insights'],
  ['/v1/analytics', 'Analytics'],
  ['/v1/analytics/summary', 'Summary'],
];

export function renderSession() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join('');

  const session = document.getElementById('session');
  if (isLoggedIn()) {
    const user = getUser();
    session.innerHTML = `<span>${user?.name || user?.email || 'Logged in'}</span><button id="logout-btn">Log out</button>`;
    document.getElementById('logout-btn').onclick = async () => {
      await logout();
      renderSession();
      navigate('/v1/login');
    };
  } else {
    session.innerHTML = `<a href="/v1/login">Log in</a>`;
  }
}

function requireAuth(handler) {
  return (params, app) => {
    if (!isLoggedIn()) {
      navigate('/v1/login');
      return;
    }
    return handler(params, app);
  };
}

// Canonical /v1/ routes
route('/v1/login', renderLogin);
route('/v1/listings', requireAuth(renderListings));
route('/v1/listings/:id', requireAuth(renderListingDetail));
route('/v1/rentals', requireAuth(renderRentals));
route('/v1/projects', requireAuth(renderProjects));
route('/v1/projects/:id', requireAuth(renderProjectDetail));
route('/v1/favourites', requireAuth(renderFavourites));
route('/v1/insights', requireAuth(renderInsights));
route('/v1/analytics/summary', renderAnalyticsSummary);
route('/v1/analytics', renderAnalytics);

// Aliases without /v1 prefix for fallback and direct entry
route('/login', renderLogin);
route('/listings', requireAuth(renderListings));
route('/listings/:id', requireAuth(renderListingDetail));
route('/rentals', requireAuth(renderRentals));
route('/projects', requireAuth(renderProjects));
route('/projects/:id', requireAuth(renderProjectDetail));
route('/favourites', requireAuth(renderFavourites));
route('/insights', requireAuth(renderInsights));
route('/analytics/summary', renderAnalyticsSummary);
route('/analytics', renderAnalytics);
route('/analysis', renderAnalytics);

renderSession();
startRouter();
