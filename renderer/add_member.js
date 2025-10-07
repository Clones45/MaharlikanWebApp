// add_member.js
let supabase = null, env = null;

const qs  = (s)=>document.querySelector(s);
const qsa = (s)=>Array.from(document.querySelectorAll(s));

function setMsg(text){ const el=qs('#formMsg'); if (el) el.textContent = text || ''; }
function setBusy(b){
  const btn = qs('#saveBtn');
  if (btn){ btn.disabled = !!b; btn.dataset.busy = b ? '1' : ''; btn.textContent = b ? 'Saving…' : 'Save Member'; }
}
function err(field, message){
  const el = document.querySelector(`[data-err="${field}"]`);
  if (el) el.textContent = message || '';
}
function clearErrors(){
  qsa('[data-err]').forEach(el=> el.textContent='');
  qsa('input,select,textarea').forEach(el=> el.classList.remove('invalid'));
}

async function boot(){
  try{
    // 1) Get env from Electron preload or fallback to window.__ENV__
    env = null;
    if (window.electronAPI?.getEnv) {
      try { env = await window.electronAPI.getEnv(); } catch {}
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

    // 3) Create client + check session
    supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    const { data: { session }, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) console.warn('[getSession]', sessErr);
    if (!session){
      setMsg('Not signed in. Please log in again.');
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
  }catch(e){
    console.error('[boot] error:', e);
    setMsg('Init failed: ' + (e.message || e));
  }
}

function wire(){
  qs('#memberForm')?.addEventListener('submit', onSave);
  qs('#addBeneBtn')?.addEventListener('click', addBeneRow);

  // Auto-calc Age
  const bd = qs('input[name="birth_date"]');
  const age = qs('input[name="age"]');
  bd?.addEventListener('change', ()=>{
    if (!bd.value) return;
    try{
      const dob = new Date(bd.value + 'T00:00:00');
      const today = new Date();
      let a = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m===0 && today.getDate() < dob.getDate())) a--;
      if (a>=0 && Number.isFinite(a)) age.value = String(a);
    }catch(_){}
  });
}

async function loadAgents(){
  const sel = document.getElementById('agentSelect');
  if (!sel) return;

  sel.innerHTML = '<option value="">Loading…</option>';

  try{
    const { data, error } = await supabase
      .from('agents')
      .select('id, firstname, lastname')
      .order('lastname', { ascending: true });

    if (error) {
      console.error('[loadAgents] error:', error);
      sel.innerHTML = '<option value="">Cannot load agents (check RLS/CSP)</option>';
      setMsg('Failed to load agents: ' + (error.message || 'check RLS/CSP'));
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
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
  } catch (e) {
    console.error('[loadAgents] exception:', e);
    sel.innerHTML = '<option value="">Cannot load agents (runtime error)</option>';
    setMsg('Failed to load agents: ' + (e.message || e));
  }
}

function addBeneRow(){
  const wrap = qs('#beneList');
  const div  = document.createElement('div');
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
  div.querySelector('button.btn.danger').addEventListener('click', ()=> div.remove());
  wrap.appendChild(div);
}

function gather(form){
  const fd = new FormData(form);
  const get = (k)=> (fd.get(k) ?? '').toString().trim();
  const num = (k)=> {
    const v = (fd.get(k) ?? '').toString().trim();
    return v==='' ? null : Number(v);
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
    contact_number: get('contact_number') || null,
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
    agent_id: num('agent_id'),            // from <select name="agent_id">
  };

  // beneficiaries
  const benes = [];
  const b_ln = fd.getAll('b_last_name[]');
  const b_fn = fd.getAll('b_first_name[]');
  const b_mn = fd.getAll('b_middle_name[]');
  const b_addr = fd.getAll('b_address[]');
  const b_bd = fd.getAll('b_birth_date[]');
  const b_age = fd.getAll('b_age[]');
  const b_rel = fd.getAll('b_relation[]');

  for(let i=0;i<b_ln.length;i++){
    const row = {
      last_name: (b_ln[i] ?? '').toString().trim(),
      first_name: (b_fn[i] ?? '').toString().trim(),
      middle_name: (b_mn[i] ?? '').toString().trim() || null,
      address: (b_addr[i] ?? '').toString().trim() || null,
      birth_date: (b_bd[i] ?? '').toString().trim() || null,
      age: (b_age[i] ?? '').toString().trim()==='' ? null : Number(b_age[i]),
      relation: (b_rel[i] ?? '').toString().trim() || null,
    };
    if (row.last_name || row.first_name) benes.push(row);
  }

  return { payload, benes };
}

/**
 * Strict validation (agent_id is required)
 */
function validate(payload){
  clearErrors();
  let ok = true;
  const missing = [];
  let firstField = null;

  const sel = {
    maf_no:            '[name="maf_no"]',
    last_name:         '[name="last_name"]',
    first_name:        '[name="first_name"]',
    birth_date:        '[name="birth_date"]',
    age:               '[name="age"]',
    membership:        '[name="membership"]',
    plan_type:         '[name="plan_type"]',
    casket_type:       '[name="casket_type"]',
    contracted_price:  '[name="contracted_price"]',
    monthly_due:       '[name="monthly_due"]',
    agent_id:          '#agentSelect',
  };

  const requiredKeys = [
    'maf_no','last_name','first_name','birth_date','age',
    'membership','plan_type','casket_type','contracted_price','monthly_due',
    'agent_id'
  ];

  for (const key of requiredKeys){
    const v = payload[key];
    const empty = (v===null || v===undefined || v==='' || Number.isNaN(v));
    if (empty){
      missing.push(key.replace(/_/g,' '));
      err(key, 'This field is required');
      const node = qs(sel[key]); if (node){ node.classList.add('invalid'); if (!firstField) firstField = node; }
      ok = false;
    }
  }

  if (!ok){
    if (firstField){ firstField.scrollIntoView({behavior:'smooth', block:'center'}); firstField.focus(); }
    alert('Please fill the required fields:\n\n- ' + missing.map(s=>s.toUpperCase()).join('\n- '));
  }
  return ok;
}

function resetForm(form){
  try {
    form.reset();
    clearErrors();
    qsa('.bene-row').forEach(el => el.remove());
    const sel = document.getElementById('agentSelect');
    if (sel) sel.selectedIndex = 0;
    setMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch(_) {}
}

// Map Postgres/Supabase errors to user-friendly text
function friendlyError(err){
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

async function onSave(e){
  e.preventDefault();
  setMsg('');
  setBusy(true);

  try{
    const form = e.currentTarget;
    const { payload, benes } = gather(form);

    if (!validate(payload)){
      setMsg('Please complete the missing fields.');
      setBusy(false);
      return;
    }

    // Insert member
    const { data: member, error: mErr } = await supabase
      .from('members')
      .insert(payload)
      .select('id')
      .single();
    if (mErr) throw mErr;

    // Insert beneficiaries (if any)
    if (benes.length){
      const rows = benes.map(b => ({ ...b, member_id: member.id }));
      const { error: bErr } = await supabase.from('beneficiaries').insert(rows);
      if (bErr) throw bErr;
    }

    resetForm(form);
    alert('✅ Saved successfully.');
  }catch(err){
    console.error('[save member] ', err);
    const human = friendlyError(err);
    setMsg('Save failed: ' + human);
    alert('❌ Save failed:\n\n' + human);
  }finally{
    setBusy(false);
  }
}

window.addEventListener('DOMContentLoaded', boot);
