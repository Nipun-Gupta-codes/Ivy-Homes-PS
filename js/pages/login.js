import { login } from '../auth.js';
import { renderSession } from '../main.js';
import { navigate } from '../router.js';

export function renderLogin(params, app) {
  app.innerHTML = `
    <form class="login-form panel" id="login-form">
      <h2>Log in</h2>
      <div id="login-error"></div>
      <input type="email" id="email" placeholder="demo1@ivy.homes" required />
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit">Log in</button>
    </form>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errorBox = document.getElementById('login-error');
    errorBox.innerHTML = '';
    try {
      await login(email, password);
      renderSession();
      navigate('/v1/listings');
    } catch (err) {
      errorBox.innerHTML = `<div class="notice error">${err.message}</div>`;
    }
  });
}
