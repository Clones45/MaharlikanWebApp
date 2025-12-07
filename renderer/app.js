let supabase = null;
let env = null;

/* -------------------- DOM helpers -------------------- */
const qs = (s, r = document) => r.querySelector(s);
const show = (el) => { if (el) el.classList.remove('hidden'); };
const hide = (el) => { if (el) el.classList.add('hidden'); };

function setBusy(el, busy) {
  if (!el) return;
  el.disabled = !!busy;
  if (busy) el.setAttribute('data-busy', '1');
  else el.removeAttribute('data-busy');
}

function setMsg(sel, text, mountSel) {
  let el = qs(sel);
  if (!el && mountSel) {
    const mount = qs(mountSel);
    if (mount) {
      el = document.createElement('p');
      el.id = sel.replace(/^#/, '');
      el.className = 'muted';
      el.setAttribute('aria-live', 'polite');
      mount.appendChild(el);
    }
  }
  if (el) el.textContent = text || '';
}

/* -------------------- Watermark -------------------- */
function setLoginWatermark() {
  try {
    const url = new URL('../assets/logo-watermark.png', window.location.href).toString();
    document.documentElement.style.setProperty('--login-logo', `url("${url}")`);
    const img = document.getElementById('login-mark');
    if (img) img.src = url;
  } catch (e) {
    console.warn('[watermark] failed:', e);
  }
}

/* -------------------- Navigation helper -------------------- */
function openWindow(file) {
  try {
    if (window.electronAPI?.openWindow) {
      window.electronAPI.openWindow(file);
    } else {
      window.location.assign(`./${file}`);
    }
  } catch (e) {
    console.error(`[openWindow] failed for ${file}:`, e);
    window.location.assign(`./${file}`);
  }
}

/* -------------------- Boot -------------------- */
async function init() {
  try {
    // 1. Load Environment
    if (window.electronAPI?.getEnv) env = await window.electronAPI.getEnv();
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) env = window.__ENV__ || {};

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      setMsg('#loginMsg', 'Missing Supabase environment.', '#login-section');
      return;
    }

    if (!window.supabase?.createClient) {
      setMsg('#loginMsg', 'Supabase client not loaded (CDN).', '#login-section');
      return;
    }

    // 2. Initialize Supabase (SINGLE INSTANCE)
    // ✅ ENABLE session persistence and auto-refresh to prevent JWT expiration
    if (!supabase) {
      supabase = window.supabase.createClient(
        env.SUPABASE_URL,
        env.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,        // ✅ ENABLE: Store session in localStorage
            autoRefreshToken: true,      // ✅ ENABLE: Auto-refresh tokens before expiry
            detectSessionInUrl: false,   // Not needed for main window
            storage: window.localStorage // ✅ Use real localStorage
          }
        }
      );

      // ✅ Listen for auth state changes (token refresh, sign out, etc.)
      supabase.auth.onAuthStateChange((event, session) => {
        console.log('[Auth] State changed:', event, session?.user?.email);

        if (event === 'SIGNED_OUT') {
          console.log('[Auth] User signed out');
          // Redirect to login page if not already there
          if (!window.location.pathname.includes('login.html')) {
            window.location.href = 'login.html';
          }
        }

        if (event === 'TOKEN_REFRESHED') {
          console.log('[Auth] ✅ Token auto-refreshed successfully');
        }

        if (event === 'SIGNED_IN') {
          console.log('[Auth] User signed in:', session?.user?.email);
        }
      });
    }

    console.log('✅ App initialized. Waiting for manual login.');

    // 3. UI Setup
    // Always show login screen initially.
    // If we are on login.html, show the section.
    if (qs('#login-section')) {
      show(qs('#login-section'));
      setLoginWatermark();
    }

    // 4. Check for existing session (from localStorage)
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      console.log('[Auth] ✅ Existing session found, user already logged in');
      // If we're on login page but have a session, go to dashboard
      if (window.location.pathname.includes('login.html')) {
        window.location.href = 'index.html';
        return;
      }
    } else {
      console.log('[Auth] No existing session, showing login');
    }

    attach();

  } catch (e) {
    console.error('[init error]', e);
    setMsg('#loginMsg', 'Init failed: ' + e.message, '#login-section');
  }
}

/* -------------------- Events -------------------- */
function attach() {
  qs('#loginBtn')?.addEventListener('click', onLogin);
  qs('#signOutBtn')?.addEventListener('click', onSignOut);
  qs('#btnMenuLogout')?.addEventListener('click', onSignOut);

  ['#username', '#password'].forEach(sel => {
    qs(sel)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onLogin();
    });
  });

  // Dashboard Buttons
  const dashboardMap = {
    '#btnNewMember': 'add_member.html',
    '#btnViewMembers': 'view_members.html',
    '#btnAddCollections': 'add_collection.html',
    '#btnViewCollections': 'view-collections.html',
    '#btnViewCommissions': 'view-commissions.html',
    '#btnViewHierarchy': 'view_hierarchy.html',
    '#btnEditMembers': 'edit-member.html',
    '#btnSoa': 'soa.html',
    '#btnRegisterAgent': 'register-agent.html',
    '#btnInquires': 'inquiries.html',
    '#btnRequest': 'view-withdrawals.html',
    '#btnGenerate': 'access_codes.html'
  };

  Object.entries(dashboardMap).forEach(([selector, file]) => {
    const btn = qs(selector);
    if (btn) {
      btn.addEventListener('click', async () => {
        console.log(`[Dashboard] Clicked ${selector} -> opening ${file}`);

        let target = file;
        const session = await supabase.auth.getSession();
        const token = session?.data?.session?.access_token;
        const refresh = session?.data?.session?.refresh_token;

        if (token && refresh) {
          target += `?access_token=${token}&refresh_token=${refresh}`;
        } else if (token) {
          target += `?access_token=${token}`;
        }

        openWindow(target);
      });
    }
  });
}

/* -------------------- LOGIN -------------------- */
async function onLogin() {
  // ✅ Anti-double-submit guard
  if (window.__loggingIn) return;
  window.__loggingIn = true;

  const btn = qs('#loginBtn');
  const usernameInput = qs('#username');
  const passwordInput = qs('#password');

  const identifier = usernameInput?.value?.trim();
  const password = passwordInput?.value;

  if (!identifier || !password) {
    setMsg('#loginMsg', 'Enter username and password.', '#login-section');
    window.__loggingIn = false;
    return;
  }

  setBusy(btn, true);
  setMsg('#loginMsg', 'Signing in...', '#login-section');

  try {
    // 1. Resolve Email if Username provided
    let email = identifier.includes('@') ? identifier : null;

    if (!email) {
      const { data: resolvedEmail, error: rpcErr } =
        await supabase.rpc('auth_email_for_username', { _username: identifier });

      if (rpcErr || !resolvedEmail) {
        setMsg('#loginMsg', 'Invalid username.', '#login-section');
        return; // Stop here
      }
      email = resolvedEmail;
    }

    // 2. Clear any existing session before new login attempt
    await supabase.auth.signOut({ scope: 'local' });

    // 3. Sign In
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMsg('#loginMsg', 'Invalid username or password.', '#login-section');
      return; // Stop here
    }

    if (!data?.session) {
      setMsg('#loginMsg', 'Login failed (no session).', '#login-section');
      return;
    }

    // 4. Handle Successful Login
    await afterLogin(data.session);

  } catch (e) {
    console.error('[login error]', e);
    setMsg('#loginMsg', e.message || 'Login failed.', '#login-section');
  } finally {
    setBusy(btn, false);
    window.__loggingIn = false; // ✅ Release guard
  }
}

/* -------------------- After login -------------------- */
async function afterLogin(session) {
  try {
    const userId = session.user.id;
    console.log('✅ LOGGED USER:', userId);

    // 1. Check Admin Role
    const { data: prof, error } = await supabase
      .from('users_profile')
      .select('role, display_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !prof) {
      throw new Error('No profile found in users_profile.');
    }

    if ((prof.role || '').toLowerCase() !== 'admin') {
      await supabase.auth.signOut({ scope: 'local' }); // ✅ Immediate logout if not admin
      throw new Error('Admins only.');
    }

    // 2. Update UI (Safe Access)
    const userInfo = qs('#user-info');
    if (userInfo) {
      userInfo.textContent = `${prof.display_name || 'Admin'} (admin)`;
    }

    // 3. Redirect to Dashboard
    // If we are on the login page (login-section exists), we MUST redirect to index.html
    // to load the full dashboard environment.
    if (qs('#login-section')) {
      window.location.href = "index.html";
      return;
    }

    // If we are already on index.html (dashboard exists), just show it.
    hide(qs('#login-section'));
    show(qs('#dashboard'));

  } catch (e) {
    console.error('[afterLogin]', e);
    setMsg('#loginMsg', e.message, '#login-section');
    // Ensure we are logged out if afterLogin fails
    await supabase.auth.signOut({ scope: 'local' });
    show(qs('#login-section'));
    hide(qs('#dashboard'));
  }
}

/* -------------------- Logout -------------------- */
async function onSignOut() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (e) {
    console.warn('[logout]', e);
  } finally {
    // ✅ Manual Logout: Always redirect to login.html or show login section
    // This ensures a clean state for the next login.
    if (qs('#login-section')) {
      show(qs('#login-section'));
      setMsg('#loginMsg', 'Signed out.', '#login-section');
      setLoginWatermark();
      // Clear inputs
      if (qs('#username')) qs('#username').value = '';
      if (qs('#password')) qs('#password').value = '';
    } else {
      window.location.href = "login.html";
    }
  }
}

/* -------------------- DOM Ready -------------------- */
window.addEventListener('DOMContentLoaded', () => {
  setLoginWatermark();
  init();
});
