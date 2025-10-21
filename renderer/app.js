// renderer/app.js
let supabase = null;
let env = null;

const REMEMBER_KEY = 'maharlikan.remember'; // local storage flag

/* -------------------- DOM helpers -------------------- */
const qs  = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
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

/* -------------------- Members table columns -------------------- */
const MEMBER_COLUMNS = [
  'id','maf_no','first_name','middle_name','last_name','birth_date','age','gender','civil_status','religion',
  'address','contact_number','zipcode','birthplace','nationality','occupation','membership','plan_type',
  'monthly_due','contracted_price','balance','date_joined','agent','casket_type','weight','height',
  'created_at','updated_at'
];

/* -------------------- Navigation helper -------------------- */
/** Try to open a renderer page via IPC. Fallback: navigate current window. */
function openWindow(file) {
  try {
    if (window.electronAPI?.openWindow) {
      // IPC to main process (preferred)
      window.electronAPI.openWindow(file);
    } else {
      // Fallback to same-window navigation
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
    const IS_LOGIN_PAGE = !!document.querySelector('#login-section'); // detect page

    // get env from preload if present, else fallback to window.__ENV__
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

    supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    // If user did NOT choose "Remember me", never restore old session
    const remember = localStorage.getItem(REMEMBER_KEY) === '1';
    if (!remember) {
      await supabase.auth.signOut().catch(() => {});
    }

    // Try restoring session
    const { data: { session } } = await supabase.auth.getSession();

    if (session && remember) {
      // Already logged in
      if (IS_LOGIN_PAGE) {
        // If user opens login.html while already logged in → redirect to dashboard
        window.location.href = "index.html";
        return;
      } else {
        await afterLogin(session);
      }
    } else {
      // Not logged in
      if (IS_LOGIN_PAGE) {
        show(qs('#login-section'));
        setLoginWatermark();
      } else {
        // Trying to access index.html directly → redirect to login
        window.location.href = "login.html";
        return;
      }
    }

    attach();
  } catch (e) {
    console.error('[init] error:', e);
    setMsg('#loginMsg', 'Init failed: ' + (e.message || e), '#login-section');
  }
}

/* -------------------- Events -------------------- */
function attach() {
  qs('#loginBtn')?.addEventListener('click', onLogin);
  qs('#signOutBtn')?.addEventListener('click', onSignOut);
  qs('#btnMenuLogout')?.addEventListener('click', onSignOut);

  ['#email', '#password'].forEach(sel => {
    qs(sel)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });
  });

  // Centralized routes: button id -> file name
  const routes = {
    btnNewMember:       'add_member.html',
    btnViewMembers:     'view_members.html',
    btnAddCollections:  'add_collection.html',
    btnViewCollections: 'view-collections.html',
    btnEditMembers:     'edit-member.html',
    btnSoa:             'soa.html',
    btnRegisterAgent:   'register-agent.html',
    btnViewHierarchy:   'view_hierarchy.html', // ✅ added here
    btnViewCommissions: 'view-commissions.html',
  };

  // Single click handler for all menu buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-btn');
    if (!btn || !btn.id) return;

    if (btn.id === 'btnMenuLogout') {
      onSignOut();
      return;
    }

    const file = routes[btn.id];
    if (!file) return;

    // Special case: View Members has in-page fallback
    if (btn.id === 'btnViewMembers') {
      if (window.electronAPI?.openWindow) {
        openWindow(file);
      } else {
        try {
          qsa('.view').forEach(hide);
          show(qs('#view-members'));
          loadMembers();
        } catch (err) {
          console.warn('[btnViewMembers] fallback failed:', err);
          window.location.assign(`./${file}`);
        }
      }
      return;
    }

    openWindow(file);
  });

  // live filter for in-page "View Members" fallback
  qs('#m-search')?.addEventListener('input', debounce(loadMembers, 350));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* -------------------- Auth -------------------- */
async function onLogin() {
  const btn = qs('#loginBtn');
  const usernameInput = qs('#email');
  const passwordInput = qs('#password');
  const rememberInput = qs('#remember');

  const identifier = usernameInput?.value?.trim();
  const password   = passwordInput?.value;
  const remember   = !!rememberInput?.checked;

  if (!identifier || !password) {
    setMsg('#loginMsg', 'Please enter username and password.', '#login-section');
    return;
  }

  setBusy(btn, true);
  setMsg('#loginMsg', 'Signing in...', '#login-section');

  try {
    // username -> email via RPC if needed
    let email = identifier.includes('@') ? identifier : null;
    if (!email) {
      const { data: resolvedEmail, error: rpcErr } =
        await supabase.rpc('auth_email_for_username', { _username: identifier });
      if (rpcErr) throw rpcErr;
      if (!resolvedEmail) {
        setMsg('#loginMsg', 'Invalid username.', '#login-section');
        return;
      }
      email = resolvedEmail;
    }

    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      setMsg('#loginMsg', 'Invalid username or password.', '#login-section');
      return;
    }

    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
    await afterLogin(data.session);
  } catch (e) {
    console.error('[onLogin] error:', e);
    setMsg('#loginMsg', 'Login failed: ' + (e.message || 'Unknown error'), '#login-section');
  } finally {
    setBusy(btn, false);
  }
}

/* -------------------- After login -------------------- */
async function afterLogin(session) {
  try {
    const userId = session.user.id;
    const { data: prof, error } = await supabase
      .from('users_profile')
      .select('role, display_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!prof) throw new Error('No profile found for this account.');

    if ((prof.role || '').toLowerCase() !== 'admin') {
      await supabase.auth.signOut();
      localStorage.removeItem(REMEMBER_KEY);
      throw new Error('Admins only. You were signed out.');
    }

    const name = prof.display_name || 'Admin';
    const userInfo = qs('#user-info');
    if (userInfo) userInfo.textContent = `${name} (admin)`;

    // If on login page, redirect to index.html
    if (qs('#login-section')) {
      window.location.href = "index.html";
      return;
    }

    hide(qs('#login-section'));
    show(qs('#dashboard'));
  } catch (e) {
    console.error('[afterLogin] error:', e);
    setMsg('#loginMsg', e.message || 'Access denied.', '#login-section');
    show(qs('#login-section'));
    hide(qs('#dashboard'));
  }
}

/* -------------------- Sign out -------------------- */
async function onSignOut() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[signOut] error:', e);
  } finally {
    localStorage.removeItem(REMEMBER_KEY);
    const userInfo = qs('#user-info');
    if (userInfo) userInfo.textContent = '';
    if (qs('#dashboard')) {
      hide(qs('#dashboard'));
    }
    if (qs('#login-section')) {
      show(qs('#login-section'));
      setMsg('#loginMsg', 'Signed out.', '#login-section');
      setLoginWatermark();
    } else {
      // Redirect to login page if not present
      window.location.href = "login.html";
    }
  }
}

/* -------------------- Members (in-page fallback) -------------------- */
async function loadMembers() {
  const thead = qs('#m-thead');
  const tbody = qs('#m-tbody');
  if (!thead || !tbody) return;

  thead.innerHTML = '<tr>' + MEMBER_COLUMNS.map(c => `<th>${c}</th>`).join('') + '</tr>';
  tbody.innerHTML = '';

  const q = qs('#m-search')?.value?.trim();
  let query = supabase.from('members').select(MEMBER_COLUMNS.join(','));
  if (q) query = query.or(`maf_no.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
  query = query.limit(500).order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    setMsg('#m-msg', 'Error: ' + error.message, '#view-members');
    return;
  }

  const rows = data || [];
  const esc = (v) => (v === null || v === undefined) ? '' : String(v);

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = MEMBER_COLUMNS.map(c => `<td>${esc(row[c])}</td>`).join('');
    tbody.appendChild(tr);
  }
  setMsg('#m-msg', `${rows.length} row(s)`, '#view-members');
}

/* -------------------- DOM ready -------------------- */
window.addEventListener('DOMContentLoaded', () => {
  setLoginWatermark();
  init();
});
