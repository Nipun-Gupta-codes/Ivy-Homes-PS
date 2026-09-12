import { route, startRouter } from './router.js';
import { isLoggedIn, getUser, logout } from './auth.js';
import { renderLogin } from './pages/login.js';
import { renderListings } from './pages/listings.js';
import { renderListingDetail } from './pages/listingDetail.js';
import { renderRentals } from './pages/rentals.js';
import { renderProjects, renderProjectDetail } from './pages/projects.js';
import { renderFavourites } from './pages/favouritesPage.js';
import { renderInsights } from './pages/insights.js';
import { renderAnalysis } from './pages/analysis.js';

const NAV_LINKS = [
  ['#/listings', 'Listings'],
  ['#/rentals', 'Rentals'],
  ['#/projects', 'Projects'],
  ['#/favourites', 'Saved'],
  ['#/insights', 'Insights'],
  ['#/analysis', 'Analysis'],
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
      location.hash = '#/login';
    };
  } else {
    session.innerHTML = `<a href="#/login">Log in</a>`;
  }
}

function requireAuth(handler) {
  return (params, app) => {
    if (!isLoggedIn()) {
      location.hash = '#/login';
      return;
    }
    return handler(params, app);
  };
}

route('/login', renderLogin);
route('/listings', requireAuth(renderListings));
route('/listings/:id', requireAuth(renderListingDetail));
route('/rentals', requireAuth(renderRentals));
route('/projects', requireAuth(renderProjects));
route('/projects/:id', requireAuth(renderProjectDetail));
route('/favourites', requireAuth(renderFavourites));
route('/insights', requireAuth(renderInsights));
route('/analysis', requireAuth(renderAnalysis));

renderSession();
startRouter();
