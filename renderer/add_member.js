// add_member.js
let supabase = null, env = null;

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

/* ✅ HARD-CODED PLAN DATA (no DB table needed) */
const PLAN_DATA = {
  "PACKAGE A1": {
    casket: "JUNIOR PLAIN",
    price: 29880,
    monthly: 498,
  },
  "PACKAGE A2": {
    casket: "JUNIOR PLAIN",
    price: 30000,
    monthly: 500,
  },
  "PACKAGE B1": {
    casket: "JUNIOR PLAIN",
    price: 20880,
    monthly: 348,
  },
  "PACKAGE B2": {
    casket: "JUNIOR PLAIN",
    price: 21000,
    monthly: 350,
  },
  "MS": {
    casket: "NO CASKET",
    price: 0,
    monthly: 0,
  },
};

function setMsg(text) { const el = qs('#formMsg'); if (el) el.textContent = text || ''; }
function setBusy(b) {
  const btn = qs('#saveBtn');
  if (btn) { btn.disabled = !!b; btn.dataset.busy = b ? '1' : ''; btn.textContent = b ? 'Saving…' : 'Save Member'; }
}
function err(field, message) {
  const el = document.querySelector(`[data-err="${field}"]`);
  if (el) el.textContent = message || '';
}
function clearErrors() {
  qsa('[data-err]').forEach(el => el.textContent = '');
  qsa('input,select,textarea').forEach(el => el.classList.remove('invalid'));
}

async function boot() {
  try {
    // ✅ Added: Create Back/Home button at top
    const formWrap = qs('body');
    if (formWrap && !qs('#homeBtn')) {
      const backBtn = document.createElement('button');
      backBtn.id = 'homeBtn';
      backBtn.textContent = '🏠 Home';
      backBtn.style.position = 'fixed';
      backBtn.style.top = '14px';
      backBtn.style.right = '18px';
      backBtn.style.zIndex = '9999';
      backBtn.style.background = '#0b4d87';
      backBtn.style.color = '#fff';
      backBtn.style.border = '0';
      backBtn.style.borderRadius = '8px';
      backBtn.style.padding = '8px 14px';
      backBtn.style.cursor = 'pointer';
      backBtn.style.fontWeight = '600';
      backBtn.onclick = () => window.location.href = 'index.html';
      backBtn.onmouseenter = () => backBtn.style.filter = 'brightness(0.9)';
      backBtn.onmouseleave = () => backBtn.style.filter = 'brightness(1)';
      formWrap.appendChild(backBtn);
    }

    // 1) Get env from Electron preload or fallback to window.__ENV__
    env = null;
    if (window.electronAPI?.getEnv) {
      try { env = await window.electronAPI.getEnv(); } catch { }
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
      if (window.__ENV__) env = window.__ENV__;
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
      setMsg('Missing Supabase env. Check .env / preload / main IPC.');
      return;
    }

    // 2) Ensure SDK is loaded
    if (!window.supabase?.createClient) {
      setMsg('Supabase SDK not loaded (check script tag).');
      return;
    }

    // 🛑 CRITICAL: Use dummy storage to prevent clearing main window's localStorage
    const dummyStorage = {
      getItem: () => null,
      setItem: () => { },
      removeItem: () => { },
    };

    // 3) Create client + check session
    supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,       // ✅ Don't duplicate storage (main window handles this)
        autoRefreshToken: true,      // ✅ ENABLE: Auto-refresh tokens before expiry
        detectSessionInUrl: false,
        storage: dummyStorage        // ✅ ISOLATE from localStorage
      },
    });

    // ✅ Listen for auth state changes (especially token refresh)
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[add_member Auth] State changed:', event);

      if (event === 'TOKEN_REFRESHED') {
        console.log('[add_member Auth] ✅ Token auto-refreshed successfully');
      }

      if (event === 'SIGNED_OUT') {
        console.log('[add_member Auth] User signed out (session invalid/expired).');
        // 🛑 PREVENT REDIRECT LOOP: Do not auto-close or redirect.
        // Just warn the user so they don't lose data.
        alert('⚠️ Session expired or invalid.\n\nPlease keep this window open and sign in again on the main window to save your work.');
      }
    });

    // 3b) Set Session from URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get("access_token");
    const refresh = params.get("refresh_token");
    let session = null;

    if (token && refresh) {
      const { data, error } = await supabase.auth.setSession({
        access_token: token,
        refresh_token: refresh,
      });
      if (error) console.warn("[add_member] Failed to set session:", error);
      session = data.session;
    } else {
      // Fallback: try getSession (will likely fail if no persistence, but safe)
      const { data } = await supabase.auth.getSession();
      session = data.session;
    }

    if (!session) {
      setMsg('Not signed in. Please log in again.');
      // Optional: redirect to login or show error
      return;
    }

    // 4) Wire UI events
    wire();

    // 5) Load agents for required dropdown
    await loadAgents();

    // 6) Preselect agent based on the logged-in user’s profile (if mapped)
    try {
      const { data: prof } = await supabase
        .from('users_profile')
        .select('agent_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      const sel = document.getElementById('agentSelect');
      if (sel && prof?.agent_id) {
        const want = String(prof.agent_id);
        if ([...sel.options].some(o => o.value === want)) sel.value = want;
      }
    } catch (e) {
      console.warn('[preselect agent] skipped:', e);
    }

    setMsg('');
  } catch (e) {
    console.error('[boot] error:', e);
    setMsg('Init failed: ' + (e.message || e));
  }
}

function wire() {
  qs('#memberForm')?.addEventListener('submit', onSave);
  qs('#addBeneBtn')?.addEventListener('click', addBeneRow);

  // Auto-calc Age
  const bd = qs('input[name="birth_date"]');
  const age = qs('input[name="age"]');
  bd?.addEventListener('change', () => {
    if (!bd.value) return;
    try {
      const dob = new Date(bd.value + 'T00:00:00');
      const today = new Date();
      let a = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) a--;
      if (a >= 0 && Number.isFinite(a)) age.value = String(a);
    } catch (_) { }
  });

  // ✅ Auto-populate plan fields when plan is selected
  const planSel = qs('#planType');
  if (planSel) {
    planSel.addEventListener('change', onPlanChange);

    // ✅ Autocomplete Logic
    planSel.addEventListener('input', () => showSuggestions(planSel.value));
    planSel.addEventListener('focus', () => showSuggestions(planSel.value));

    // Hide when clicking outside
    document.addEventListener('click', (e) => {
      if (!planSel.contains(e.target) && !qs('#planSuggestions')?.contains(e.target)) {
        hideSuggestions();
      }
    });

    // Trigger on load if a plan is already selected
    if (planSel.value) {
      console.log('[wire] Triggering initial plan change for:', planSel.value);
      onPlanChange();
    }
  }
}


/* ✅ PLAN CHANGE HANDLER */
function onPlanChange() {
  const planSel = qs('#planType');
  if (!planSel) {
    console.warn('[onPlanChange] planType select not found');
    return;
  }

  const val = planSel.value;
  console.log('[onPlanChange] Selected plan:', val);

  const casketInput = qs('input[name="casket_type"]');
  const priceInput = qs('input[name="contracted_price"]');
  const monthlyInput = qs('input[name="monthly_due"]');

  console.log('[onPlanChange] Found inputs:', {
    casket: !!casketInput,
    price: !!priceInput,
    monthly: !!monthlyInput
  });

  if (!val || !PLAN_DATA[val]) {
    console.log('[onPlanChange] No plan selected or invalid plan, clearing fields');
    if (casketInput) casketInput.value = '';
    if (priceInput) priceInput.value = '';
    if (monthlyInput) monthlyInput.value = '';
    return;
  }

  const plan = PLAN_DATA[val];
  console.log('[onPlanChange] Plan data:', plan);

  if (casketInput) casketInput.value = plan.casket;
  if (priceInput) priceInput.value = plan.price;   // stays numeric, DB accepts 0 for CARD
  if (monthlyInput) monthlyInput.value = plan.monthly; // stays numeric, DB accepts 0 for CARD

  console.log('[onPlanChange] Fields updated:', {
    casket: casketInput?.value,
    price: priceInput?.value,
    monthly: monthlyInput?.value
  });
}


/* ✅ SUGGESTIONS UI */
function showSuggestions(query) {
  const list = qs('#planSuggestions');
  if (!list) return;

  const q = (query || '').toUpperCase().trim();
  const keys = Object.keys(PLAN_DATA);
  const matches = keys.filter(k => k.includes(q));

  if (matches.length === 0) {
    list.classList.add('hidden');
    return;
  }

  list.innerHTML = '';
  matches.forEach(key => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.textContent = key;
    div.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent document click from closing immediately
      const planSel = qs('#planType');
      if (planSel) {
        planSel.value = key;
        console.log('[Suggestion] Selected:', key);
        hideSuggestions();
        onPlanChange(); // Trigger data fill
      }
    });
    list.appendChild(div);
  });

  list.classList.remove('hidden');
}

function hideSuggestions() {
  const list = qs('#planSuggestions');
  if (list) list.classList.add('hidden');
}

async function loadAgents() {
  const sel = document.getElementById('agentSelect');
  if (!sel) {
    console.error('[loadAgents] agentSelect element not found in DOM');
    return;
  }

  console.log('[loadAgents] Starting to load agents...');
  sel.innerHTML = '<option value="">Loading…</option>';

  try {
    console.log('[loadAgents] Querying agents table...');
    const { data, error } = await supabase
      .from('agents')
      .select('id, firstname, lastname')
      .order('lastname', { ascending: true });

    if (error) {
      console.error('[loadAgents] Supabase error:', error);
      sel.innerHTML = '<option value="">Cannot load agents (check RLS/CSP)</option>';
      setMsg('Failed to load agents: ' + (error.message || 'check RLS/CSP'));
      return;
    }

    console.log('[loadAgents] Query successful, received data:', data);
    const rows = Array.isArray(data) ? data : [];
    console.log('[loadAgents] Number of agents:', rows.length);

    if (!rows.length) {
      console.warn('[loadAgents] No agents found in database');
      sel.innerHTML = '<option value="">No agents found</option>';
      return;
    }

    sel.innerHTML = '<option value="">— Select —</option>';
    for (const a of rows) {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = `${a.lastname || ''}, ${a.firstname || ''}`.trim() || `Agent #${a.id}`;
      sel.appendChild(opt);
    }
    console.log('[loadAgents] Successfully populated', rows.length, 'agents into dropdown');
  } catch (e) {
    console.error('[loadAgents] Exception:', e);
    sel.innerHTML = '<option value="">Cannot load agents (runtime error)</option>';
    setMsg('Failed to load agents: ' + (e.message || e));
  }
}


function addBeneRow() {
  const wrap = qs('#beneList');
  const div = document.createElement('div');
  div.className = 'bene-row grid';
  div.innerHTML = `
    <div class="col-3"><label>Last Name</label><input name="b_last_name[]" autocomplete="off"></div>
    <div class="col-3"><label>First Name</label><input name="b_first_name[]" autocomplete="off"></div>
    <div class="col-3"><label>Middle</label><input name="b_middle_name[]" autocomplete="off"></div>
    <div class="col-3"><label>Relation</label><input name="b_relation[]" autocomplete="off"></div>

    <div class="col-6"><label>Address</label><input name="b_address[]" autocomplete="off"></div>
    <div class="col-3"><label>Birthdate</label><input type="date" name="b_birth_date[]"></div>
    <div class="col-2"><label>Age</label><input type="number" name="b_age[]" min="0"></div>
    <div class="col-1" style="display:flex;align-items:flex-end;justify-content:flex-end;">
      <button type="button" class="btn danger" aria-label="Remove">×</button>
    </div>
  `;
  div.querySelector('button.btn.danger').addEventListener('click', () => div.remove());
  wrap.appendChild(div);
}

function gather(form) {
  const fd = new FormData(form);
  const get = (k) => (fd.get(k) ?? '').toString().trim();
  const num = (k) => {
    const v = (fd.get(k) ?? '').toString().trim();
    return v === '' ? null : Number(v);
  };

  const payload = {
    maf_no: get('maf_no'),
    last_name: get('last_name'),
    first_name: get('first_name'),
    middle_name: get('middle_name') || null,
    birthplace: get('birthplace') || null,
    birth_date: get('birth_date') || null,
    age: num('age'),
    height: get('height') || null,
    weight: get('weight') || null,
    gender: get('gender') || null,
    phone_number: get('phone_number') || null,
    religion: get('religion') || null,
    civil_status: get('civil_status') || null,
    address: get('address') || null,
    zipcode: get('zipcode') || null,
    nationality: get('nationality') || null,
    occupation: get('occupation') || null,
    membership: get('membership') || null,
    plan_type: get('plan_type'),
    casket_type: get('casket_type') || null,
    contracted_price: num('contracted_price'),
    monthly_due: num('monthly_due'),
    balance: num('contracted_price'), // ✅ Initialize balance = contracted_price (nothing paid yet)
    date_joined: get('date_joined') || new Date().toISOString().split('T')[0], // ✅ Default to today if empty
    agent_id: num('agent_id'),
  };

  const benes = [];
  const b_ln = fd.getAll('b_last_name[]');
  const b_fn = fd.getAll('b_first_name[]');
  const b_mn = fd.getAll('b_middle_name[]');
  const b_addr = fd.getAll('b_address[]');
  const b_bd = fd.getAll('b_birth_date[]');
  const b_age = fd.getAll('b_age[]');
  const b_rel = fd.getAll('b_relation[]');

  for (let i = 0; i < b_ln.length; i++) {
    const row = {
      last_name: (b_ln[i] ?? '').toString().trim(),
      first_name: (b_fn[i] ?? '').toString().trim(),
      middle_name: (b_mn[i] ?? '').toString().trim() || null,
      address: (b_addr[i] ?? '').toString().trim() || null,
      birth_date: (b_bd[i] ?? '').toString().trim() || null,
      age: (b_age[i] ?? '').toString().trim() === '' ? null : Number(b_age[i]),
      relation: (b_rel[i] ?? '').toString().trim() || null,
    };
    if (row.last_name || row.first_name) benes.push(row);
  }
  console.log('[add_member] Gathered beneficiaries:', benes);
  return { payload, benes };
}

function validate(payload) {
  clearErrors();
  let ok = true;
  const missing = [];
  let firstField = null;

  const sel = {
    maf_no: '[name="maf_no"]',
    last_name: '[name="last_name"]',
    first_name: '[name="first_name"]',
    birth_date: '[name="birth_date"]',
    age: '[name="age"]',
    membership: '[name="membership"]',
    plan_type: '[name="plan_type"]',
    casket_type: '[name="casket_type"]',
    contracted_price: '[name="contracted_price"]',
    monthly_due: '[name="monthly_due"]',
    agent_id: '#agentSelect',
  };

  const requiredKeys = [
    'maf_no', 'last_name', 'first_name', 'birth_date', 'age',
    'membership', 'plan_type', 'casket_type', 'contracted_price', 'monthly_due',
    'agent_id'
  ];

  for (const key of requiredKeys) {
    const v = payload[key];
    const empty = (v === null || v === undefined || v === '' || Number.isNaN(v));
    if (empty) {
      missing.push(key.replace(/_/g, ' '));
      err(key, 'This field is required');
      const node = qs(sel[key]); if (node) { node.classList.add('invalid'); if (!firstField) firstField = node; }
      ok = false;
    }
  }

  if (!ok) {
    if (firstField) { firstField.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstField.focus(); }
    alert('Please fill the required fields:\n\n- ' + missing.map(s => s.toUpperCase()).join('\n- '));
  }
  return ok;
}

function resetForm(form) {
  try {
    form.reset();
    clearErrors();
    qsa('.bene-row').forEach(el => el.remove());
    const sel = document.getElementById('agentSelect');
    if (sel) sel.selectedIndex = 0;
    setMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (_) { }
}

function friendlyError(err) {
  const msg = (err?.message || '').toLowerCase();

  if (err?.code === '23505' || msg.includes('duplicate key value')) {
    if (msg.includes('members_maf_no_key')) return 'MAF No already exists. Please enter a different MAF No.';
    return 'Duplicate value violates a unique constraint.';
  }

  if (err?.code === '23503' || msg.includes('foreign key constraint')) {
    if (msg.includes('agent')) return 'Invalid agent selected. Please pick a valid agent.';
    return 'Invalid related value (foreign key).';
  }

  if (err?.code === '23502' || msg.includes('null value in column')) {
    const m = msg.match(/null value in column "([^"]+)"/);
    return m ? `Missing required field: ${m[1]}` : 'A required field is missing.';
  }

  if (msg.includes('row-level security') || msg.includes('rls')) {
    return 'Permission denied by Row Level Security policy. Please check your permissions.';
  }

  return err?.message || 'Unknown error';
}

async function onSave(e) {
  e.preventDefault();
  setMsg('');
  setBusy(true);

  try {
    const form = e.currentTarget;
    const { payload, benes } = gather(form);

    if (!validate(payload)) {
      setMsg('Please complete the missing fields.');
      setBusy(false);
      return;
    }

    const { data: member, error: mErr } = await supabase
      .from('members')
      .insert(payload)
      .select('id')
      .single();
    if (mErr) throw mErr;

    console.log('[onSave] Member inserted:', member.id);
    console.log('[onSave] Beneficiaries to insert:', benes);

    if (benes.length) {
      const rows = benes.map(b => ({ ...b, member_id: member.id }));
      const { error: bErr } = await supabase.from('beneficiaries').insert(rows);
      if (bErr) {
        console.error('[onSave] Beneficiary insert failed:', bErr);
        throw bErr;
      }
      console.log('[onSave] Beneficiaries inserted successfully.');
    } else {
      console.log('[onSave] No beneficiaries to insert.');
    }

    resetForm(form);
    alert('✅ Saved successfully.');
  } catch (err) {
    console.error('[save member] ', err);
    const human = friendlyError(err);
    setMsg('Save failed: ' + human);
    alert('❌ Save failed:\n\n' + human);
  } finally {
    setBusy(false);
  }
}

window.addEventListener('DOMContentLoaded', boot);
