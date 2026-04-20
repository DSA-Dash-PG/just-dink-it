// public/js/auth-modal.js
// Reusable auth modal: email + password, Google OAuth, sign in/up toggle.
// Usage: import { openAuthModal } from '/js/auth-modal.js'; openAuthModal();

import { getSupabase } from '/js/supabase-client.js';

let _modalEl = null;

function ensureModal() {
  if (_modalEl) return _modalEl;
  _modalEl = document.createElement('div');
  _modalEl.id = 'auth-modal';
  _modalEl.style.cssText = `
    display: none; position: fixed; inset: 0; background: rgba(4, 52, 44, 0.6);
    z-index: 10000; align-items: center; justify-content: center; padding: 20px;
  `;
  _modalEl.innerHTML = `
    <div style="background: var(--c-paper); border-radius: var(--r-lg); max-width: 420px; width: 100%; padding: 32px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
      <div class="flex justify-between items-center" style="margin-bottom: 8px;">
        <p class="eyebrow" id="auth-mode-label">Sign in</p>
        <button id="auth-close" style="background: none; border: none; font-size: 24px; color: var(--c-ink-mute); cursor: pointer; line-height: 1; padding: 0;">×</button>
      </div>
      <h2 style="margin: 0; font-family: var(--font-serif); font-style: italic; font-size: 28px; color: var(--c-teal-dark); line-height: 1.1;" id="auth-headline">
        Welcome back<span style="color: var(--c-coral);">.</span>
      </h2>
      <p style="margin: 8px 0 0; font-size: 13px; color: var(--c-ink-soft);" id="auth-subhead">
        Sign in with your email or Google.
      </p>

      <button id="auth-google" class="btn" style="margin-top: 24px; width: 100%; justify-content: center; background: var(--c-paper); color: var(--c-ink); border: 1px solid var(--c-rule-strong); box-shadow: none; font-weight: 500;">
        <svg width="18" height="18" viewBox="0 0 18 18" style="margin-right: 4px;"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
        Continue with Google
      </button>

      <div style="margin: 20px 0; display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--c-ink-mute); letter-spacing: 0.1em; text-transform: uppercase;">
        <div style="flex: 1; height: 1px; background: var(--c-rule);"></div>
        <span>or with email</span>
        <div style="flex: 1; height: 1px; background: var(--c-rule);"></div>
      </div>

      <form id="auth-form">
        <div class="field">
          <label>Email</label>
          <input type="email" name="email" required placeholder="you@example.com" />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" name="password" required minlength="6" placeholder="At least 6 characters" />
        </div>
        <div id="auth-error" style="display: none; padding: 10px 12px; background: #FCEBEB; color: #A32D2D; border-radius: var(--r-sm); font-size: 13px; margin-bottom: 12px;"></div>
        <div id="auth-success" style="display: none; padding: 10px 12px; background: #EAF3DE; color: #3B6D11; border-radius: var(--r-sm); font-size: 13px; margin-bottom: 12px;"></div>
        <button type="submit" class="btn btn-primary btn-block" id="auth-submit">Sign in</button>
      </form>

      <p style="margin: 16px 0 0; text-align: center; font-size: 13px; color: var(--c-ink-soft);">
        <span id="auth-toggle-prompt">New to the league?</span>
        <a href="#" id="auth-toggle" style="color: var(--c-coral); font-weight: 500;">Create account</a>
      </p>
    </div>
  `;
  document.body.appendChild(_modalEl);

  let mode = 'signin'; // or 'signup'

  const setMode = (m) => {
    mode = m;
    const isSignup = m === 'signup';
    document.getElementById('auth-mode-label').textContent = isSignup ? 'Create account' : 'Sign in';
    document.getElementById('auth-headline').innerHTML = isSignup
      ? 'Join the league<span style="color: var(--c-coral);">.</span>'
      : 'Welcome back<span style="color: var(--c-coral);">.</span>';
    document.getElementById('auth-subhead').textContent = isSignup
      ? 'Create an account with your email or Google. Captains: use the same email you registered your team with.'
      : 'Sign in with your email or Google.';
    document.getElementById('auth-submit').textContent = isSignup ? 'Create account' : 'Sign in';
    document.getElementById('auth-toggle-prompt').textContent = isSignup ? 'Already have an account?' : 'New to the league?';
    document.getElementById('auth-toggle').textContent = isSignup ? 'Sign in' : 'Create account';
    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('auth-success').style.display = 'none';
  };

  document.getElementById('auth-close').onclick = () => { _modalEl.style.display = 'none'; };
  _modalEl.onclick = (e) => { if (e.target === _modalEl) _modalEl.style.display = 'none'; };

  document.getElementById('auth-toggle').onclick = (e) => {
    e.preventDefault();
    setMode(mode === 'signin' ? 'signup' : 'signin');
  };

  document.getElementById('auth-google').onclick = async () => {
    const supabase = await getSupabase();
    // Strip query params (e.g. ?error=...) so a failed previous OAuth attempt
    // doesn't poison the state on retry. Keep only the origin + path.
    const cleanUrl = window.location.origin + window.location.pathname;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: cleanUrl },
    });
  };

  document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email');
    const password = fd.get('password');
    const errEl = document.getElementById('auth-error');
    const okEl = document.getElementById('auth-success');
    const btn = document.getElementById('auth-submit');
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = mode === 'signup' ? 'Creating...' : 'Signing in...';

    try {
      const supabase = await getSupabase();
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          // Auto-confirmed (email confirmation disabled) - reload
          window.location.reload();
        } else {
          // Email confirmation required
          okEl.textContent = '✓ Account created. Check your email for a verification link.';
          okEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Create account';
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.reload();
      }
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    }
  };

  return _modalEl;
}

export function openAuthModal(mode = 'signin') {
  ensureModal();
  // Trigger mode setter
  if (mode === 'signup') {
    document.getElementById('auth-toggle').click();
  }
  _modalEl.style.display = 'flex';
}

export function closeAuthModal() {
  if (_modalEl) _modalEl.style.display = 'none';
}
