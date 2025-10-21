/* add_collection.js — unlimited payments + membership detection + commission logic + manual date selection + live plan_commission_map sync */

const qs  = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

/* ---------- Tiny UI helpers ---------- */
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

/* ---------- App state ---------- */
let supabase = null;
let currentMember = null;
let planCache = {}; // store plan_commission_map results

/* ---------- Info panel helpers ---------- */
function infoSet(html){ const el=qs('#memberInfo'); if (el) el.innerHTML = html; }
function infoPrepend(line, ok=true){
  const el = qs('#memberInfo'); if (!el) return;
  const c = ok ? '#77dd77' : '#e66';
  el.innerHTML = `<div style="margin-bottom:6px;color:${c};font-size:12px">${esc(line)}</div>` + (el.innerHTML||'');
}

/* ---------- Boot ---------- */
async function boot(){
  try{
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

    // Default date value to today
    const dateBox = qs('#date_paid');
    if (dateBox) {
      const today = new Date().toISOString().slice(0,10);
      dateBox.value = today;
    }

    wire();
  }catch(e){
    console.error('[boot] error', e);
    infoSet(`<span style="color:#e66">Init failed: ${esc(e.message||e)}</span>`);
    toast('Init failed', 'error');
  }
}

/* ---------- Wire UI ---------- */
function wire(){
  qs('#collectForm')?.addEventListener('submit', onSave);

  const maf = qs('#maf_no');
  const amt = qs('#amount');

  const fire = () => loadMemberForMAF();
  ['input','keyup','blur','change'].forEach(ev => maf?.addEventListener(ev, fire));
  amt?.addEventListener('focus', fire);

  qs('#btnReset')?.addEventListener('click', ()=>{
    qs('#collectForm')?.reset();
    const dateBox = qs('#date_paid');
    if (dateBox) dateBox.value = new Date().toISOString().slice(0,10);
    currentMember = null;
    infoSet('Enter AF No and tab/click away to load member details.');
  });
  qs('#btnBack')?.addEventListener('click', ()=> history.back?.());
}

/* ---------- Member lookup ---------- */
async function loadMemberForMAF(){
  const info = qs('#memberInfo');
  const raw = (qs('#maf_no')?.value || '').trim();
  currentMember = null;

  if (!raw){ info.textContent = 'Enter AF No and tab/click away to load member details.'; return; }
  if (raw.length < 2){ return; }

  const maf_no = raw.toUpperCase();
  info.textContent = `Looking up AF No: ${maf_no} …`;

  try{
    let { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('maf_no', maf_no)
      .limit(1);

    if (error){
      info.innerHTML = `<span style="color:#e66">Load failed: ${esc(error.message)}</span>`;
      return;
    }
    if (!data || !data.length){
      info.innerHTML = `<span style="color:#e66">Member not found for AF No: ${esc(maf_no)}</span>`;
      return;
    }

    currentMember = data[0];

    // Show details
    info.innerHTML = [
      `<b>Name:</b> ${esc(currentMember.first_name || 'N/A')} ${esc(currentMember.last_name||'')}`,
      `<b>Plan:</b> ${esc(currentMember.plan_type || 'N/A')}`,
      `<b>Monthly Due:</b> ${currency(currentMember.monthly_due)}`,
      `<b>Contracted Price:</b> ${currency(currentMember.contracted_price)}`,
      `<b>Balance:</b> ${currency(currentMember.balance)}`,
      `<b>Membership Paid:</b> ${currentMember.membership_paid ? '✅ Yes' : '❌ No'}`,
      `<b>Address:</b> ${esc(currentMember.address || 'N/A')}`,
    ].join('\n');
  }catch(e){
    console.error('[loadMemberForMAF] exception', e);
    info.innerHTML = `<span style="color:#e66">Lookup exception: ${esc(e.message||e)}</span>`;
  }
}

/* ---------- Plan helpers ---------- */
async function planInfo(plan_type) {
  const key = (plan_type || '').toUpperCase().trim();
  if (!key) return { code:'UNKNOWN', monthlyDue:0, monthlyComm:0, outrightComm:0 };
  if (planCache[key]) return planCache[key];

  try {
    const { data, error } = await supabase
      .from('plan_commission_map')
      .select('*')
      .eq('plan_type', key)
      .maybeSingle();

    if (error || !data) {
      console.warn('[planInfo] fallback used for', key, error);
      // fallback
      if (key.includes('A1')) return { code:'A1', monthlyDue:498, monthlyComm:120, outrightComm:150 };
      if (key.includes('A2')) return { code:'A2', monthlyDue:500, monthlyComm:120, outrightComm:150 };
      if (key.includes('B1')) return { code:'B1', monthlyDue:348, monthlyComm:100, outrightComm:130 };
      if (key.includes('B2')) return { code:'B2', monthlyDue:350, monthlyComm:100, outrightComm:130 };
      return { code:'UNKNOWN', monthlyDue:0, monthlyComm:0, outrightComm:0 };
    }

    const mapped = {
      code: key.replace(/^PLAN\s+/, ''),
      monthlyDue: data.monthly_payment,
      monthlyComm: data.monthly_commission,
      outrightComm: data.outright_commission
    };
    planCache[key] = mapped;
    return mapped;
  } catch(e) {
    console.error('[planInfo]', e);
    return { code:'UNKNOWN', monthlyDue:0, monthlyComm:0, outrightComm:0 };
  }
}

/* ---------- Save ---------- */
async function onSave(e){
  e.preventDefault();
  const maf_no = (qs('#maf_no')?.value || '').trim();
  const amount = Number((qs('#amount')?.value || '').toString().replace(/[, ]/g,''));
  const outrightMode = qs('#deduct_now')?.checked ? 'deduct' : 'accrue';
  const date_paid = qs('#date_paid')?.value || new Date().toISOString().slice(0,10);

  if (!maf_no){ toast('AF No is required.', 'error'); qs('#maf_no')?.focus(); return; }
  if (!Number.isFinite(amount) || amount <= 0){ toast('Enter a valid amount.', 'error'); qs('#amount')?.focus(); return; }

  if (!currentMember) await loadMemberForMAF();
  if (!currentMember){ toast('Member not found.', 'error'); return; }

  try{
    const { data: prev, error: prevErr } = await supabase
      .from('collections')
      .select('id').eq('member_id', currentMember.id).limit(1);
    if (prevErr) throw prevErr;
    const isFirstPayment = !prev || prev.length === 0;

    const { data: inserted, error: insErr } = await supabase.from('collections').insert({
      member_id: currentMember.id,
      maf_no: currentMember.maf_no,
      payment: amount,
      date_paid: date_paid,
      last_name: currentMember.last_name || null,
      first_name: currentMember.first_name || null,
      middle_name: currentMember.middle_name || null,
      address: currentMember.address || null,
      plan_type: currentMember.plan_type || null,
      outright_mode: outrightMode
    }).select().single();
    if (insErr) throw insErr;

    const planCode = (currentMember.plan_type || '').toUpperCase().trim();
    if (amount === 500 && !currentMember.membership_paid && planCode !== 'PLAN A2') {
      await handleMembershipPayment(inserted, currentMember, outrightMode);
    } else {
      await handleRegularPayment(inserted, currentMember, outrightMode, isFirstPayment);
    }

    const { data: pays, error: sumErr } = await supabase
      .from('collections').select('payment').eq('member_id', currentMember.id);
    if (sumErr) throw sumErr;

    const totalPaid = (pays||[]).reduce((a,r)=> a + Number(r.payment||0), 0);
    const contracted = Number(currentMember.contracted_price || 0);
    const newBalance = Math.max(0, contracted - totalPaid);
    await supabase.from('members').update({ balance: newBalance }).eq('id', currentMember.id);

    toast('✅ Collection saved successfully.', 'success');
    qs('#amount').value = '';
    await loadMemberForMAF();
  }catch(e){
    console.error('[onSave] error', e);
    toast(e?.message || 'Request failed.', 'error');
  }
}

/* ---------- Handle Membership Payment ---------- */
async function handleMembershipPayment(collection, member, outrightMode){
  try {
    const plan = { monthlyComm:120, outrightComm:150 }; // fixed membership bonus
    const agentMonthly = plan.monthlyComm;
    const recruiterMonthly = agentMonthly * 0.10;

    await supabase.from('members').update({
      membership_paid: true,
      membership_paid_date: collection.date_paid
    }).eq('id', member.id);

    let recruiter_id = null;
    if (member.agent_id) {
      const { data: agentRow } = await supabase
        .from('agents')
        .select('recruiter_id')
        .eq('id', member.agent_id)
        .maybeSingle();
      recruiter_id = agentRow?.recruiter_id || null;
    }

    const rows = [
      {
        member_id: member.id,
        collection_id: collection.id,
        agent_id: member.agent_id,
        commission_type: 'membership_outright',
        plan_type: 'MEMBERSHIP',
        basis_amount: plan.outrightComm,
        amount: plan.outrightComm,
        outright_mode: outrightMode,
        date_earned: collection.date_paid
      },
      {
        member_id: member.id,
        collection_id: collection.id,
        agent_id: member.agent_id,
        commission_type: 'membership_monthly',
        plan_type: 'MEMBERSHIP',
        basis_amount: plan.monthlyComm,
        amount: plan.monthlyComm,
        outright_mode: outrightMode,
        date_earned: collection.date_paid
      }
    ];

    if (recruiter_id) {
      rows.push({
        member_id: member.id,
        collection_id: collection.id,
        agent_id: recruiter_id,
        recruiter_id,
        commission_type: 'membership_recruiter',
        plan_type: 'MEMBERSHIP',
        basis_amount: plan.monthlyComm,
        percentage: 10,
        amount: recruiterMonthly,
        date_earned: collection.date_paid
      });
    }

    await supabase.from('commissions').insert(rows);
    toast('🎉 Membership payment processed with commissions.', 'success');
  } catch(e) {
    console.error('[handleMembershipPayment]', e);
    toast('Error processing membership payment', 'error');
  }
}

/* ---------- Handle Regular Payment ---------- */
/* ---------- Handle Regular Payment ---------- */
async function handleRegularPayment(collection, member, outrightMode, isFirstPayment) {
  try {
    const plan = await planInfo(member.plan_type);
    const agentMonthly = plan.monthlyComm;
    const recruiterMonthly = agentMonthly * 0.10;

    // 1️⃣ Count previous payments
    const { data: prevPays, error: prevErr } = await supabase
      .from('collections')
      .select('payment')
      .eq('member_id', member.id);
    if (prevErr) throw prevErr;

    const totalPrev = (prevPays || [])
      .filter(p => p.id !== collection.id)
      .reduce((a, r) => a + Number(r.payment || 0), 0);

    // 2️⃣ Compute monthly rate and months paid this time
    const monthlyRate = plan.monthlyDue || 0;
    const monthsPaidNow = monthlyRate > 0 ? Math.floor(collection.payment / monthlyRate) : 0;
    const monthsAlreadyPaid = monthlyRate > 0 ? Math.floor(totalPrev / monthlyRate) : 0;
    const monthsRemainingOut = Math.max(0, 12 - monthsAlreadyPaid);

    // 3️⃣ Split outright vs monthly commission
    const outrightMonths = Math.min(monthsPaidNow, monthsRemainingOut);
    const monthlyMonths = Math.max(0, monthsPaidNow - outrightMonths);

    // 4️⃣ Compute commission amounts
    const outrightAmount = plan.outrightComm * outrightMonths;
    const monthlyAmount = plan.monthlyComm * monthlyMonths;

    // 5️⃣ Recruiter info
    let recruiter_id = null;
    if (member.agent_id) {
      const { data: agentRow } = await supabase
        .from('agents')
        .select('recruiter_id')
        .eq('id', member.agent_id)
        .maybeSingle();
      recruiter_id = agentRow?.recruiter_id || null;
    }

    // 6️⃣ Commission rows
    const rows = [];

    if (outrightMonths > 0) {
      rows.push({
        member_id: member.id,
        collection_id: collection.id,
        agent_id: member.agent_id,
        commission_type: 'plan_outright',
        plan_type: plan.code,
        basis_amount: plan.outrightComm,
        months_covered: outrightMonths,
        amount: outrightAmount,
        outright_mode: outrightMode,
        eligible_outright: true,
        date_earned: collection.date_paid
      });
    }

    if (monthlyMonths > 0) {
      rows.push({
        member_id: member.id,
        collection_id: collection.id,
        agent_id: member.agent_id,
        commission_type: 'plan_monthly',
        plan_type: plan.code,
        basis_amount: plan.monthlyComm,
        months_covered: monthlyMonths,
        amount: monthlyAmount,
        outright_mode: outrightMode,
        date_earned: collection.date_paid
      });
    }

    if (recruiter_id) {
      rows.push({
        member_id: member.id,
        collection_id: collection.id,
        agent_id: recruiter_id,
        recruiter_id,
        commission_type: 'recruiter_bonus',
        plan_type: plan.code,
        basis_amount: plan.monthlyComm,
        percentage: 10,
        amount: recruiterMonthly * monthsPaidNow,
        date_earned: collection.date_paid
      });
    }

    await supabase.from('commissions').insert(rows);
    console.log('[Regular payment commissions]', rows);
  } catch (e) {
    console.error('[handleRegularPayment]', e);
  }
}


/* ---------- Start ---------- */
window.addEventListener('DOMContentLoaded', boot);
