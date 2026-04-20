// public/js/shared.js
// Shared client-side helpers for Just Dink It

const API = '/api';

/* ─── API helpers ─── */
export async function apiGet(path) {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

export async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Authenticated API call - automatically pulls Supabase token
export async function apiAuth(path, body) {
  const { getAccessToken } = await import('/js/supabase-client.js');
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  const res = await fetch(`${API}/${path}`, {
    method: body !== undefined ? 'POST' : 'GET',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ─── Header partial (injected on every page) ─── */
export function renderHeader(activePage = '') {
  const isActive = (p) => (p === activePage ? 'active' : '');
  return `
    <header class="header">
      <div class="container header-inner">
        <a href="/" class="brand">
          <div class="brand-mark">JDI</div>
          <div>
            <div class="brand-name">Just Dink It<span class="dot">.</span></div>
            <div class="brand-tag">South Bay · Summer 2026</div>
          </div>
        </a>
        <nav class="nav">
          <a href="/" class="${isActive('home')}">Home</a>
          <a href="/teams.html" class="${isActive('teams')}">Teams</a>
          <a href="/schedule.html" class="${isActive('schedule')}">Schedule</a>
          <a href="/scores.html" class="${isActive('scores')}">Scores</a>
          <a href="/stats.html" class="${isActive('stats')}">Stats</a>
          <a href="/gallery.html" class="${isActive('gallery')}">Photos</a>
          <a href="/sponsors.html" class="${isActive('sponsors')}">Sponsors</a>
          <a href="/register.html" class="btn btn-amber btn-sm">Register →</a>
        </nav>
      </div>
    </header>
  `;
}

/* ─── Footer partial ─── */
export function renderFooter() {
  return `
    <footer class="footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="brand">
              <div class="brand-mark">JDI</div>
              <div>
                <div class="brand-name" style="color: var(--c-cream);">Just Dink It<span class="dot">.</span></div>
                <div class="brand-tag">South Bay Pickleball League</div>
              </div>
            </div>
            <p style="margin-top: 16px; font-size: 13px; max-width: 320px; line-height: 1.6;">
              The South Bay's home for league pickleball. Hermosa to PV, June through July, every season.
            </p>
          </div>
          <div>
            <h4>League</h4>
            <a href="/teams.html">Teams</a>
            <a href="/schedule.html">Schedule</a>
            <a href="/stats.html">Stats</a>
            <a href="/gallery.html">Photos</a>
          </div>
          <div>
            <h4>Get involved</h4>
            <a href="/register.html">Register a team</a>
            <a href="/sponsors.html">Sponsor</a>
            <a href="/captain.html">Captain login</a>
          </div>
          <div>
            <h4>Contact</h4>
            <a href="mailto:hi@justdinkit.com">hi@justdinkit.com</a>
            <a href="tel:+13105550142">(310) 555-0142</a>
            <a href="https://instagram.com/justdinkit" target="_blank">Instagram</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© 2026 Just Dink It · South Bay Pickleball League</span>
          <span>Hermosa · Manhattan · Redondo · PV · Torrance</span>
        </div>
      </div>
    </footer>
  `;
}

/* ─── Mount partials on page load ─── */
export function mountChrome(activePage) {
  const headerEl = document.getElementById('header');
  const footerEl = document.getElementById('footer');
  if (headerEl) headerEl.innerHTML = renderHeader(activePage);
  if (footerEl) footerEl.innerHTML = renderFooter();
}

/* ─── Pickleball mark SVG (reusable) ─── */
export const pickleballMark = (size = 30, fill = '#D85A30', dotColor = '#FAF7F2') => `
  <svg width="${size}" height="${size}" viewBox="0 0 30 30">
    <circle cx="15" cy="15" r="14" fill="${fill}"/>
    <circle cx="15" cy="15" r="14" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="0.6"/>
    <circle cx="9.5" cy="9.5" r="1.4" fill="${dotColor}"/>
    <circle cx="20.5" cy="9.5" r="1.4" fill="${dotColor}"/>
    <circle cx="15" cy="15" r="1.4" fill="${dotColor}"/>
    <circle cx="9.5" cy="20.5" r="1.4" fill="${dotColor}"/>
    <circle cx="20.5" cy="20.5" r="1.4" fill="${dotColor}"/>
    <circle cx="15" cy="9.5" r="1.4" fill="${dotColor}"/>
    <circle cx="15" cy="20.5" r="1.4" fill="${dotColor}"/>
  </svg>
`;

/* ─── Format helpers ─── */
export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export const fmtRecord = (w, l) => `${w}–${l}`;

export const winPct = (w, l) => {
  const total = w + l;
  return total > 0 ? Math.round((w / total) * 1000) / 10 : 0;
};

/* ─── Auth (Supabase) ─── */
import { getCurrentUser, getAccessToken, isAdmin as supaIsAdmin, signOut as supaSignOut, onAuthChange } from '/js/supabase-client.js';

// Re-export for convenience so pages can import from one place
export { getCurrentUser, getAccessToken, supaSignOut as signOut, onAuthChange };

export async function userIsAdmin() {
  const user = await getCurrentUser();
  return supaIsAdmin(user);
}

// Captain check is implicit - the captain.js function will return their team if they are one
// (no separate role needed - identity is by email match)
export async function userIsAuthenticated() {
  const user = await getCurrentUser();
  return user !== null;
}
