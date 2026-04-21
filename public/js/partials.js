// The Dink Society — partials.js
// Renders nav, live ticker, and footer into placeholder divs so every page
// stays in sync. Active nav link is set via <body data-page="leaderboard"> etc.

(function () {
  const NAV_LINKS = [
    { id: 'standings',   href: '/standings.html',   label: 'Standings' },
    { id: 'schedule',    href: '/schedule.html',    label: 'Schedule' },
    { id: 'teams',       href: '/teams.html',       label: 'Teams' },
    { id: 'leaderboard', href: '/leaderboard.html', label: 'Leaderboard' },
    { id: 'rules',       href: '/rules.html',       label: 'Rules' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // NAVBAR
  // ─────────────────────────────────────────────────────────────────────────
  function renderNav() {
    const slot = document.querySelector('[data-partial="nav"]');
    if (!slot) return;

    const activePage = document.body.dataset.page || '';
    const linksHTML = NAV_LINKS.map(l =>
      `<a href="${l.href}" class="${l.id === activePage ? 'active' : ''}">${l.label}</a>`
    ).join('');

    slot.outerHTML = `
      <nav class="nav">
        <a href="/" class="nav-brand" aria-label="The Dink Society — home">
          <svg class="nav-brand-mark" viewBox="0 0 220 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="6" y="14" width="208" height="100" fill="none" stroke="#E8B542" stroke-width="4"/>
            <line x1="110" y1="14" x2="110" y2="114" stroke="#E8B542" stroke-width="4" stroke-dasharray="6 5"/>
            <text x="41" y="80" font-family="ui-sans-serif, system-ui, sans-serif" font-size="44" font-weight="500" fill="#E8B542" text-anchor="middle" letter-spacing="-2">D</text>
            <text x="179" y="80" font-family="ui-sans-serif, system-ui, sans-serif" font-size="44" font-weight="500" fill="#E8B542" text-anchor="middle" letter-spacing="-2">S</text>
          </svg>
          <span class="nav-brand-text">THE DINK SOCIETY</span>
        </a>
        <div class="nav-links">${linksHTML}</div>
        <div class="nav-actions">
          <a href="/captain.html" class="nav-signin">SIGN IN</a>
          <a href="/register.html" class="nav-cta">JOIN</a>
        </div>
      </nav>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIVE TICKER (shows live + recent matches; pulls from public-data API)
  // ─────────────────────────────────────────────────────────────────────────
  async function renderTicker() {
    const slot = document.querySelector('[data-partial="ticker"]');
    if (!slot) return;

    // Default static ticker; real data fills in if available
    let items = [
      { kind: 'upcoming', text: 'REGISTRATION OPEN — SUMMER 2026' },
    ];

    try {
      const r = await fetch('/api/public-data?action=season-overview');
      if (r.ok) {
        const data = await r.json();
        if (data && data.matches && data.matches.length) {
          const live = data.matches.filter(m => m.status === 'awaiting_confirmation' || m.status === 'in_progress');
          const recent = data.matches.filter(m => m.status === 'final').slice(-3);
          const upcoming = data.matches.filter(m => m.status === 'scheduled')
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
            .slice(0, 2);

          const teamMap = Object.fromEntries((data.teams || []).map(t => [t.id, t]));
          const tn = id => (teamMap[id]?.name || '???').toUpperCase();

          items = [];
          live.forEach(m => items.push({ kind: 'live', text: `${tn(m.homeTeamId)} v ${tn(m.awayTeamId)}` }));
          recent.forEach(m => {
            const home = (teamMap[m.homeTeamId]?.name || '').toUpperCase();
            const away = (teamMap[m.awayTeamId]?.name || '').toUpperCase();
            items.push({ kind: 'final', text: `${home} v ${away} — FINAL` });
          });
          upcoming.forEach(m => items.push({ kind: 'upcoming', text: `${tn(m.homeTeamId)} v ${tn(m.awayTeamId)} — ${formatTickerDate(m.date)}` }));
        }
      }
    } catch (_) {
      /* fallback to default */
    }

    if (!items.length) items = [{ kind: 'upcoming', text: 'REGISTRATION OPEN — SUMMER 2026' }];

    const html = items.flatMap((item, i) => {
      const out = [];
      if (i > 0) out.push(`<span class="ticker-divider">|</span>`);
      if (item.kind === 'live') out.push(`<span class="ticker-live">● LIVE</span>`);
      out.push(`<span>${escapeHTML(item.text)}</span>`);
      return out;
    }).join(' ');

    slot.outerHTML = `<div class="ticker">${html}</div>`;
  }

  function formatTickerDate(iso) {
    if (!iso) return 'TBD';
    try {
      const d = new Date(iso);
      const today = new Date();
      const diff = Math.floor((d - today) / 86400000);
      if (diff <= 0) return 'TONIGHT';
      if (diff === 1) return 'TOMORROW';
      const opts = { weekday: 'short' };
      return d.toLocaleDateString('en-US', opts).toUpperCase();
    } catch { return 'TBD'; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FOOTER
  // ─────────────────────────────────────────────────────────────────────────
  function renderFooter() {
    const slot = document.querySelector('[data-partial="footer"]');
    if (!slot) return;

    const year = new Date().getFullYear();
    slot.outerHTML = `
      <footer class="footer">
        <div class="footer-grid">
          <div class="footer-col">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
              <svg style="width: 36px; height: 22px;" viewBox="0 0 220 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="6" y="14" width="208" height="100" fill="none" stroke="#E8B542" stroke-width="4"/>
                <line x1="110" y1="14" x2="110" y2="114" stroke="#E8B542" stroke-width="4" stroke-dasharray="6 5"/>
                <text x="41" y="80" font-family="ui-sans-serif, system-ui, sans-serif" font-size="44" font-weight="500" fill="#E8B542" text-anchor="middle" letter-spacing="-2">D</text>
                <text x="179" y="80" font-family="ui-sans-serif, system-ui, sans-serif" font-size="44" font-weight="500" fill="#E8B542" text-anchor="middle" letter-spacing="-2">S</text>
              </svg>
              <span style="font-size: 12px; font-weight: 500; letter-spacing: 0.18em; color: var(--cream);">THE DINK SOCIETY</span>
            </div>
            <p style="font-size: 12px; line-height: 1.7; color: var(--sage); max-width: 260px;">
              Southern California's most competitive social pickleball league. Six teams, seven weeks, one cup.
            </p>
          </div>
          <div class="footer-col">
            <h4>League</h4>
            <a href="/standings.html">Standings</a>
            <a href="/schedule.html">Schedule</a>
            <a href="/teams.html">Teams</a>
            <a href="/leaderboard.html">Leaderboard</a>
          </div>
          <div class="footer-col">
            <h4>Get Involved</h4>
            <a href="/register.html">Register a team</a>
            <a href="/register.html#free-agent">Join free-agent pool</a>
            <a href="/rules.html">League rules</a>
          </div>
          <div class="footer-col">
            <h4>Contact</h4>
            <a href="mailto:hi@thedinksociety.com">hi@thedinksociety.com</a>
            <a href="tel:+13105550142">(310) 555-0142</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${year} The Dink Society — Southern California</span>
          <span>South Bay · LA · Westside · Eastside · OC</span>
        </div>
      </footer>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHARED HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Expose helpers globally for page scripts to use
  window.DS = window.DS || {};
  window.DS.escapeHTML = escapeHTML;

  // ─────────────────────────────────────────────────────────────────────────
  // BOOTSTRAP
  // ─────────────────────────────────────────────────────────────────────────
  function init() {
    renderNav();
    renderTicker();
    renderFooter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
