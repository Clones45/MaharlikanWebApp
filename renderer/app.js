// renderer/app.js
let supabase = null;
let env = null;

const REMEMBER_KEY = 'maharlikan.remember'; // local storage flag

/* ---------- DOM helpers ---------- */
const qs  = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
const show = (el) => { if (el) el.classList.remove('hidden'); };
const hide = (el) => { if (el) el.classList.add('hidden'); };

function setBusy(el, busy) {
  if (!el) return;
  el.disabled = !!busy;
  if (busy) el.setAttribute('data-busy', '1'); else el.removeAttribute('data-busy');
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

/* ---------- Optional watermark ---------- */
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

/* ---------- Columns ---------- */
const MEMBER_COLUMNS = [
  'id','maf_no','first_name','middle_name','last_name','birth_date','age','gender','civil_status','religion',
  'address','contact_number','zipcode','birthplace','nationality','occupation','membership','plan_type',
  'monthly_due','contracted_price','balance','date_joined','agent','casket_type','weight','height',
  'created_at','updated_at'
];

/* ---------- Boot ---------- */
async function init() {
  try {
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

    // ⛔ If user did NOT choose "Remember me", never restore old session
    const remember = localStorage.getItem(REMEMBER_KEY) === '1';
    if (!remember) {
      // this clears any previously stored session tokens
      await supabase.auth.signOut().catch(() => {});
    }

    // Try restoring (only works if remember===true and a valid session exists)
    const { data: { session } } = await supabase.auth.getSession();

    if (session && remember) {
      await afterLogin(session);
    } else {
      show(qs('#login-section'));
      hide(qs('#dashboard'));
    }

    attach();
    setLoginWatermark();
  } catch (e) {
    console.error('[init] error:', e);
    setMsg('#loginMsg', 'Init failed: ' + (e.message || e), '#login-section');
  }
}

/* ---------- Events ---------- */
function attach() {
  qs('#loginBtn')?.addEventListener('click', onLogin);
  qs('#signOutBtn')?.addEventListener('click', onSignOut);
  qs('#btnMenuLogout')?.addEventListener('click', onSignOut);

  ['#email', '#password'].forEach(sel => {
    qs(sel)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });
  });

// New Member → open new window via Electron, else navigate in-place
qs('#btnNewMember')?.addEventListener('click', () => {
  try {
    if (window.electronAPI?.openWindow) {
      // ✓ new child window handled by main.js
      window.electronAPI.openWindow('add_member.html');
    } else {
      // ✓ fallback: same window (works even without preload/ipc)
      window.location.assign('./add_member.html');
    }
  } catch (e) {
    console.error('open new member failed:', e);
    // last-resort fallback
    window.location.assign('./add_member.html');
  }
});

qs('#btnAddCollections')?.addEventListener('click', () => {
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow('add_collection.html');
  } else {
    alert('Window open not available in this build.');
  }
});

qs('#btnViewCollections')?.addEventListener('click', () => {
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow('view-collections.html');
  } else {
    alert('Window open not available in this build.');
  }
});

qs('#btnSoa')?.addEventListener('click', () => {
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow('soa.html');
  } else {
    alert('Window open not available in this build.');
  }
});

qs('#btnRegisterAgent')?.addEventListener('click', () => {
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow('register-agent.html');
  } else {
    alert('Window open not available in this build.');
  }
});

qs('#btnEditMembers')?.addEventListener('click', () => {
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow('edit-member.html');
  } else {
    alert('Window open not available in this build.');
  }
});

qs('#btnViewMembers')?.addEventListener('click', () => {
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow('view_members.html');
  } else {
    alert('Window open not available in this build.');
  }
});

  qs('#m-search')?.addEventListener('input', debounce(loadMembers, 350));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- Auth ---------- */
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

    // persist remember flag (controls next launch behavior)
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');

    await afterLogin(data.session);
  } catch (e) {
    console.error('[onLogin] error:', e);
    setMsg('#loginMsg', 'Login failed: ' + (e.message || 'Unknown error'), '#login-section');
  } finally {
    setBusy(btn, false);
  }
}

/* ---------- After login ---------- */
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

    hide(qs('#login-section'));
    show(qs('#dashboard'));
  } catch (e) {
    console.error('[afterLogin] error:', e);
    setMsg('#loginMsg', e.message || 'Access denied.', '#login-section');
    show(qs('#login-section'));
    hide(qs('#dashboard'));
  }
}

/* ---------- Sign out ---------- */
async function onSignOut() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[signOut] error:', e);
  } finally {
    localStorage.removeItem(REMEMBER_KEY); // clear remember so next launch won’t auto-login
    const userInfo = qs('#user-info');
    if (userInfo) userInfo.textContent = '';
    show(qs('#login-section'));
    hide(qs('#dashboard'));
    setMsg('#loginMsg', 'Signed out.', '#login-section');
    setLoginWatermark();
  }
}

/* ---------- Members ---------- */
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

/* ---------- DOM ready ---------- */
window.addEventListener('DOMContentLoaded', () => {
  setLoginWatermark();
  init();
});
