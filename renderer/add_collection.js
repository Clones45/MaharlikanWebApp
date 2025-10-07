/* add_collection.js — robust lookup + diagnostics */

const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

const toastEl = (() => {
  const x = document.getElementById('toast') || document.createElement('div');
  if (!x.id) { x.id = 'toast'; document.body.appendChild(x); }
  x.classList.add('toast');
  return x;
})();
function toast(msg, type='info'){
  toastEl.textContent = msg || '';
  toastEl.style.borderColor = type==='error' ? '#d33' : type==='success' ? '#2d6' : '#2c3548';
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> toastEl.classList.remove('show'), 2600);
}
const esc = s => (s==null ? '' : String(s).replace(/[&<>]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m])));
const currency = n => `₱${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`;

let supabase = null;
let currentMember = null;

function infoSet(html){ const el=qs('#memberInfo'); if (el) el.innerHTML = html; }
function infoPrepend(line, ok=true){
  const el = qs('#memberInfo'); if (!el) return;
  const c = ok ? '#77dd77' : '#e66';
  el.innerHTML = `<div style="margin-bottom:6px;color:${c};font-size:12px">${esc(line)}</div>` + (el.innerHTML||'');
}

async function boot(){
  try{
    // 1) Load env
    let env = null;
    if (window.electronAPI?.getEnv) {
      try { env = await window.electronAPI.getEnv(); } catch {}
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) { if (window.__ENV__) env = window.__ENV__; }

    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY){
      infoSet(`<span style="color:#e66">Missing Supabase env (URL/KEY). Check preload/main.</span>`);
      toast('Missing Supabase env', 'error');
      return;
    }

    // 2) Client + session
    if (!window.supabase?.createClient){
      infoSet(`<span style="color:#e66">Supabase SDK not loaded.</span>`);
      toast('Supabase SDK not loaded', 'error'); return;
    }
    supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    const { data: { session }, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) console.warn('[getSession]', sessErr);
    if (!session){
      infoSet(`<span style="color:#e66">Not signed in. Please log in again.</span>`);
      toast('Not signed in', 'error'); return;
    }



    // 3) Wire UI
    wire();



  }catch(e){
    console.error('[boot] error', e);
    infoSet(`<span style="color:#e66">Init failed: ${esc(e.message||e)}</span>`);
    toast('Init failed', 'error');
  }
}

function wire(){
  qs('#collectForm')?.addEventListener('submit', onSave);

  const maf = qs('#maf_no');
  const amt = qs('#amount');

  // trigger lookup very aggressively so it can't be missed
  const fire = () => loadMemberForMAF();
  ['input','keyup','blur','change'].forEach(ev => maf?.addEventListener(ev, fire));
  amt?.addEventListener('focus', fire);

  qs('#btnReset')?.addEventListener('click', ()=>{
    qs('#collectForm')?.reset();
    currentMember = null;
    infoSet('Enter AF No and tab/click away to load member details.');
  });
  qs('#btnBack')?.addEventListener('click', ()=> history.back?.());
}

async function loadMemberForMAF(){
  const info = qs('#memberInfo');
  const raw = (qs('#maf_no')?.value || '').trim();
  currentMember = null;

  if (!raw){ info.textContent = 'Enter AF No and tab/click away to load member details.'; return; }
  if (raw.length < 2){ return; }

  const maf_no = raw.toUpperCase();
  info.textContent = `Looking up AF No: ${maf_no} …`;
  console.log('[lookup] maf_no:', maf_no);

  try{
    // exact
    let { data, error } = await supabase
      .from('members')
      .select('id, maf_no, first_name, last_name, middle_name, address, plan_type, monthly_due, contracted_price, balance')
      .eq('maf_no', maf_no)
      .limit(1);

    console.log('[members exact] data:', data, 'error:', error);

    // numeric fallback
    if (!error && (!data || data.length === 0)) {
      const n = Number(maf_no);
      if (Number.isFinite(n)) {
        const { data: d2, error: e2 } = await supabase
          .from('members')
          .select('id, maf_no, first_name, last_name, middle_name, address, plan_type, monthly_due, contracted_price, balance')
          .eq('maf_no', String(n))
          .limit(1);
        console.log('[members numeric] data:', d2, 'error:', e2);
        if (!e2 && d2 && d2.length) { data = d2; error = null; }
      }
    }

    if (error){
      info.innerHTML = `<span style="color:#e66">Load failed: ${esc(error.message)}</span>`;
      return;
    }
    if (!data || !data.length){
      info.innerHTML = `<span style="color:#e66">Member not found for AF No: ${esc(maf_no)}</span>`;
      return;
    }

    currentMember = data[0];
    info.innerHTML = [
      `<b>Name:</b> ${esc(currentMember.first_name || 'N/A')} ${esc(currentMember.last_name||'')}`,
      `<b>Plan:</b> ${esc(currentMember.plan_type || 'N/A')}`,
      `<b>Monthly Due:</b> ${currency(currentMember.monthly_due)}`,
      `<b>Contracted Price:</b> ${currency(currentMember.contracted_price)}`,
      `<b>Balance:</b> ${currency(currentMember.balance)}`,
      `<b>Address:</b> ${esc(currentMember.address || 'N/A')}`,
    ].join('\n');
    console.log('[member]', currentMember);

  }catch(e){
    console.error('[loadMemberForMAF] exception', e);
    info.innerHTML = `<span style="color:#e66">Lookup exception: ${esc(e.message||e)}</span>`;
  }
}

async function onSave(e){
  e.preventDefault();
  const maf_no = (qs('#maf_no')?.value || '').trim();
  const amount = Number((qs('#amount')?.value || '').toString().replace(/[, ]/g,''));

  if (!maf_no){ toast('AF No is required.', 'error'); qs('#maf_no')?.focus(); return; }
  if (!Number.isFinite(amount) || amount <= 0){ toast('Enter a valid amount.', 'error'); qs('#amount')?.focus(); return; }

  if (!currentMember) await loadMemberForMAF();
  if (!currentMember){ toast('Member not found.', 'error'); return; }

  try{
    const today = new Date().toISOString().slice(0,10);

    const { error: insErr } = await supabase.from('collections').insert({
      member_id: currentMember.id,
      maf_no: currentMember.maf_no,
      payment: amount,
      date_paid: today,
      last_name: currentMember.last_name || null,
      first_name: currentMember.first_name || null,
      middle_name: currentMember.middle_name || null,
      address: currentMember.address || null,
      plan_type: currentMember.plan_type || null,
    });
    if (insErr) throw insErr;

    const { data: pays, error: sumErr } = await supabase
      .from('collections').select('payment').eq('member_id', currentMember.id);
    if (sumErr) throw sumErr;

    const totalPaid = (pays||[]).reduce((a,r)=> a + Number(r.payment||0), 0);
    const contracted = Number(currentMember.contracted_price || 0);
    const newBalance = Math.max(0, contracted - totalPaid);

    const { error: updErr } = await supabase
      .from('members').update({ balance: newBalance }).eq('id', currentMember.id);
    if (updErr) throw updErr;

    toast('✅ Collection saved.', 'success');
    qs('#amount').value = '';
    await loadMemberForMAF();
  }catch(e){
    console.error('[onSave] error', e);
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('row-level security')) toast('RLS blocked the action. Check policies on members/collections.', 'error');
    else toast(e?.message || 'Request failed.', 'error');
  }
}

window.addEventListener('DOMContentLoaded', boot);
