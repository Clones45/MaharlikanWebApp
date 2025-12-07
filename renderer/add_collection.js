/* add_collection.js — membership vs regular, OR No required, amount override (350/500), commissions via Supabase triggers */

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

/* ---------- Tiny UI helpers ---------- */
const toastEl = (() => {
  const x = document.getElementById('toast') || document.createElement('div');
  if (!x.id) { x.id = 'toast'; document.body.appendChild(x); }
  x.classList.add('toast');
  return x;
})();
function toast(msg, type = 'info') {
  toastEl.textContent = msg || '';
  toastEl.style.borderColor = type === 'error' ? '#d33' : type === 'success' ? '#2d6' : '#2c3548';
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
const esc = s => (s == null ? '' : String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])));
const currency = n => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---------- App state ---------- */
let supabase = null;
let currentMember = null;
let planCache = {}; // store plan_commission_map results

/* ---------- Info panel helpers ---------- */
function infoSet(html) { const el = qs('#memberInfo'); if (el) el.innerHTML = html; }
function infoPrepend(line, ok = true) {
  const el = qs('#memberInfo'); if (!el) return;
  const c = ok ? '#77dd77' : '#e66';
  el.innerHTML = `<div style="margin-bottom:6px;color:${c};font-size:12px">${esc(line)}</div>` + (el.innerHTML || '');
}

/* ---------- Calculate Installments Paid (SOA Logic) ---------- */
/**
 * calculateInstallmentsPaid(memberId, monthlyDue)
 * Fetches all collections for the member and calculates installments paid.
 * Formula: FLOOR(total_regular_payments / monthly_due)
 * Includes: regular payments + membership payments
 * Excludes: fees or other payment types
 */
async function calculateInstallmentsPaid(memberId, monthlyDue) {
  if (!memberId || !monthlyDue || monthlyDue <= 0) return 0;

  try {
    const { data: collections, error } = await supabase
      .from('collections')
      .select('payment, payment_for')
      .eq('member_id', memberId);

    if (error) {
      console.error('[calculateInstallmentsPaid] error:', error);
      return 0;
    }

    let totalRegularPayments = 0;
    for (const col of collections || []) {
      const payFor = (col.payment_for || '').toLowerCase();
      // Include regular and membership payments only (exclude fees)
      if (!payFor || payFor.includes('regular') || payFor.includes('membership')) {
        totalRegularPayments += Number(col.payment || 0);
      }
    }

    const installmentsPaid = Math.floor(totalRegularPayments / monthlyDue);
    return installmentsPaid;
  } catch (e) {
    console.error('[calculateInstallmentsPaid] exception:', e);
    return 0;
  }
}

/* ---------- UI Locking Logic (Installment-based) ---------- */
/**
 * applyInstallmentLocks(member)
 * - If member is null: reset all locks (enable checkboxes).
 * - If installments >= 13:
 *    - Disable Monthly Commission checkbox (#monthly_commission_given)
 *    - Disable "Deduct Now" checkbox (#deduct_now) — membership-out-of-pocket behavior
 *    - Leave Travel Allowance checkbox (#travel_allowance_given) untouched (still usable)
 * - If installments < 13:
 *    - Enable both checkboxes normally
 */
function applyInstallmentLocks(member) {
  const chkMonthly = qs('#monthly_commission_given');
  const chkPocket = qs('#deduct_now'); // Membership Out of Pocket

  // Optional: you can add an info element in HTML with this id to show installments
  const installInfo = qs('#installmentInfo');

  if (!member) {
    // Reset to enabled if no member loaded
    if (chkMonthly) { chkMonthly.disabled = false; chkMonthly.title = ""; }
    if (chkPocket) { chkPocket.disabled = false; chkPocket.title = ""; }
    if (installInfo) installInfo.textContent = '';
    return;
  }

  const monthlyDue = Number(member.monthly_due) || 0;
  const contracted = Number(member.contracted_price) || 0;
  const balance = Number(member.balance) || 0;

  // If no monthly due (e.g. CARD / special plan), skip installment logic
  if (monthlyDue <= 0 || contracted <= 0) {
    if (installInfo) installInfo.textContent = '';
    return;
  }

  // totalPaid = contracted - balance
  const totalPaid = Math.max(0, contracted - balance);
  const installments = Math.floor(totalPaid / monthlyDue); // whole months only

  console.log(`[UI Lock] Paid: ${totalPaid}, Due: ${monthlyDue}, Installments: ${installments}`);

  if (installInfo) {
    installInfo.textContent = `Monthly installments paid: ${installments}`;
  }

  // Rule: If 13 or more installments paid, disable Monthly Comm & Out of Pocket
  if (installments >= 13) {
    if (chkMonthly) {
      chkMonthly.checked = false;
      chkMonthly.disabled = true;
      chkMonthly.title = "Disabled: 13+ installments paid";
    }
    if (chkPocket) {
      chkPocket.checked = false;
      chkPocket.disabled = true;
      chkPocket.title = "Disabled: 13+ installments paid";
    }
    // Travel allowance checkbox (#travel_allowance_given) is intentionally NOT touched here.
  } else {
    if (chkMonthly) {
      chkMonthly.disabled = false;
      chkMonthly.title = "";
    }
    if (chkPocket) {
      chkPocket.disabled = false;
      chkPocket.title = "";
    }
  }
}

/* ---------- Boot ---------- */
async function boot() {
  try {
    let env = null;
    if (window.electronAPI?.getEnv) {
      try { env = await window.electronAPI.getEnv(); } catch { }
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) { if (window.__ENV__) env = window.__ENV__; }

    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
      infoSet(`<span style="color:#e66">Missing Supabase env (URL/KEY). Check preload/main.</span>`);
      const today = new Date().toISOString().slice(0, 10);
      const dateBox = qs('#date_paid');
      if (dateBox) dateBox.value = today;
    }

    // 🛑 CRITICAL: Use dummy storage to prevent clearing main window's localStorage
    const dummyStorage = {
      getItem: () => null,
      setItem: () => { },
      removeItem: () => { },
    };

    if (window.supabase?.createClient && env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY) {
      supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: dummyStorage
        },
      });

      // ✅ Listen for auth state changes (safe mode)
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          console.log('[add_collection Auth] User signed out (session invalid/expired).');
          alert('⚠️ Session expired or invalid.\n\nPlease keep this window open and sign in again on the main window to save your work.');
        }
      });
    }

    wire();
  } catch (e) {
    console.error('[boot] error', e);
    infoSet(`<span style="color:#e66">Init failed: ${esc(e.message || e)}</span>`);
    toast('Init failed', 'error');
  }
}

/* ---------- Wire UI ---------- */
function wire() {
  qs('#collectForm')?.addEventListener('submit', onSave);

  const maf = qs('#maf_no');
  const amt = qs('#amount');

  const fire = () => loadMemberForMAF();
  ['input', 'keyup', 'blur', 'change'].forEach(ev => maf?.addEventListener(ev, fire));
  amt?.addEventListener('focus', fire);

  qs('#btnReset')?.addEventListener('click', () => {
    qs('#collectForm')?.reset();
    const dateBox = qs('#date_paid');
    if (dateBox) dateBox.value = new Date().toISOString().slice(0, 10);
    currentMember = null;
    infoSet('Enter AF No and tab/click away to load member details.');
    // Reset locks
    applyInstallmentLocks(null);
  });
  qs('#btnBack')?.addEventListener('click', () => history.back?.());
}

/* ---------- Member lookup by MAF/AF No ---------- */
async function loadMemberForMAF() {
  const info = qs('#memberInfo');
  const raw = (qs('#maf_no')?.value || '').trim();
  currentMember = null;

  if (!raw) { info.textContent = 'Enter AF No and tab/click away to load member details.'; return; }
  if (raw.length < 2) { return; }

  const maf_no = raw.toUpperCase();
  info.textContent = `Looking up AF No: ${maf_no} …`;

  try {
    let { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('maf_no', maf_no)
      .limit(1);

    if (error) {
      info.innerHTML = `<span style="color:#e66">Load failed: ${esc(error.message)}</span>`;
      return;
    }
    if (!data || !data.length) {
      info.innerHTML = `<span style="color:#e66">Member not found for AF No: ${esc(maf_no)}</span>`;
      return;
    }

    currentMember = data[0];

    // Calculate installments paid using SOA logic
    const installmentsPaid = await calculateInstallmentsPaid(
      currentMember.id,
      Number(currentMember.monthly_due || 0)
    );

    // Show details
    info.innerHTML = [
      `<b>Name:</b> ${esc(currentMember.first_name || 'N/A')} ${esc(currentMember.last_name || '')}`,
      `<b>Plan:</b> ${esc(currentMember.plan_type || 'N/A')}`,
      `<b>Monthly Due:</b> ${currency(currentMember.monthly_due)}`,
      `<b>Contracted Price:</b> ${currency(currentMember.contracted_price)}`,
      `<b>Balance:</b> ${currency(currentMember.balance)}`,
      `<b>Installments Paid:</b> ${installmentsPaid} months`,
      `<b>Membership Paid:</b> ${currentMember.membership_paid ? '✅ Yes' : '❌ No'}`,
      `<b>Address:</b> ${esc(currentMember.address || 'N/A')}`,
    ].join('\n');

    // ✅ Apply UI locks immediately using current balance + monthly_due
    applyInstallmentLocks(currentMember);

  } catch (e) {
    console.error('[loadMemberForMAF] exception', e);
    info.innerHTML = `<span style="color:#e66">Lookup exception: ${esc(e.message || e)}</span>`;
  }
}

/* ---------- Plan helpers ---------- */
async function planInfo(plan_type) {
  const key = (plan_type || '').toUpperCase().trim();
  if (!key) return { code: 'UNKNOWN', monthlyDue: 0, monthlyComm: 0, outrightComm: 0 };
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
      if (key.includes('A1') || key.includes('A2') || key.includes('A')) return { code: 'A', monthlyDue: 500, monthlyComm: 120, outrightComm: 150 };
      if (key.includes('B1') || key.includes('B2') || key.includes('B')) return { code: 'B', monthlyDue: 350, monthlyComm: 100, outrightComm: 130 };
      return { code: 'UNKNOWN', monthlyDue: 0, monthlyComm: 0, outrightComm: 0 };
    }

    const mapped = {
      code: (data.plan_type || key).replace(/^PLAN\s+/, ''),
      monthlyDue: Number(data.monthly_payment || 0),
      monthlyComm: Number(data.monthly_commission || 0),
      outrightComm: Number(data.outright_commission || 0)
    };
    planCache[key] = mapped;
    return mapped;
  } catch (e) {
    console.error('[planInfo]', e);
    return { code: 'UNKNOWN', monthlyDue: 0, monthlyComm: 0, outrightComm: 0 };
  }
}

/* ---------- Save ---------- */
async function onSave(e) {
  e.preventDefault();
  if (!currentMember) await loadMemberForMAF();

  const maf_no = (qs('#maf_no')?.value || '').trim();
  const typedAmount = Number((qs('#amount')?.value || '').toString().replace(/[, ]/g, '')) || 0;
  const date_paid = qs('#date_paid')?.value || new Date().toISOString().slice(0, 10);
  const or_no = (qs('#or_no')?.value || '').trim();
  const payment_for_val = (qs('#payment_for')?.value || '').toLowerCase();
  const isMembership = payment_for_val.includes('membership');
  const outrightMode = qs('#deduct_now')?.checked ? 'deduct' : 'accrue';

  // Checkbox behavior (flags only — commissions are handled in Supabase triggers)
  const monthlyChecked = !!qs('#monthly_commission_given')?.checked;
  const travelChecked = !!qs('#travel_allowance_given')?.checked;

  if (!maf_no) { toast('AF No is required.', 'error'); qs('#maf_no')?.focus(); return; }
  if (!currentMember) { toast('Member not found.', 'error'); return; }
  if (!or_no) { toast('OR No. is required.', 'error'); qs('#or_no')?.focus(); return; }

  let amountToStore = typedAmount;
  if (isMembership) {
    // Membership amount is standardized: 350 (deduct) or 500 (accrue)
    amountToStore = outrightMode === 'deduct' ? 350 : 500;
  } else {
    if (!Number.isFinite(typedAmount) || typedAmount <= 0) {
      toast('Enter a valid amount.', 'error'); qs('#amount')?.focus(); return;
    }
  }

  if (!currentMember.agent_id) {
    toast("This member has no Agent Assigned yet. Assign it first.", "error");
    return;
  }

  try {
    // 🟢 Insert collection only — ALL commissions handled by Supabase trigger now
    const insertPayload = {
      member_id: currentMember.id,
      agent_id: currentMember.agent_id || null,
      maf_no: currentMember.maf_no,
      payment: amountToStore,
      date_paid,
      collection_month: date_paid.substring(0, 7) + '-01',
      last_name: currentMember.last_name || null,
      first_name: currentMember.first_name || null,
      middle_name: currentMember.middle_name || null,
      address: currentMember.address || null,
      plan_type: currentMember.plan_type || null,
      outright_mode: outrightMode,
      or_no,
      is_membership_fee: isMembership,
      payment_for: isMembership ? 'membership' : 'regular',
      deduct_now: !!qs('#deduct_now')?.checked,
      got_monthly_commission: monthlyChecked,
      got_travel_allowance: travelChecked,
    };

    const { data: inserted, error: insErr } = await supabase
      .from('collections')
      .insert(insertPayload)
      .select()
      .single();
    if (insErr) throw insErr;

    // 🔹 Recompute balance from ALL collections for this member
    const { data: pays, error: sumErr } = await supabase
      .from('collections')
      .select('payment, payment_for')
      .eq('member_id', currentMember.id);

    if (sumErr) {
      console.error('[Balance Sum Error]', sumErr);
      toast('⚠️ Collection saved, but failed to recompute balance.', 'error');
    } else {
      let totalPaid = 0;
      for (const r of pays || []) {
        const payFor = (r.payment_for || '').toLowerCase();
        // Treat membership + regular as contributory
        if (!payFor || payFor.includes('membership') || payFor.includes('regular')) {
          totalPaid += Number(r.payment || 0);
        }
      }

      // Use contracted_price if available; otherwise reconstruct from balance + paid
      let contracted = Number(currentMember.contracted_price || 0);
      if (!contracted || contracted <= 0) {
        contracted = Number(currentMember.balance || 0) + totalPaid;
      }

      const newBalance = Math.max(0, contracted - totalPaid);
      const safeBalance = Number.isFinite(newBalance) && newBalance >= 0
        ? Number(newBalance.toFixed(2))
        : 0;

      const { error: updErr } = await supabase
        .from('members')
        .update({ balance: safeBalance })
        .eq('id', currentMember.id);

      if (updErr) {
        console.error('[Balance Update Error]', updErr);
        toast('⚠️ Collection saved, but balance update failed.', 'error');
      } else {
        console.log(`✅ Updated balance: ₱${safeBalance.toLocaleString()}`);
        currentMember.balance = safeBalance;
      }
    }

    toast('✅ Collection saved successfully.', 'success');

    // 🔄 Refresh member info from DB to stay in sync
    try {
      const { data: updated, error: reloadErr } = await supabase
        .from('members')
        .select('*')
        .eq('id', currentMember.id)
        .single();

      if (!reloadErr && updated) {
        currentMember = updated;

        // Calculate updated installments paid
        const installmentsPaid = await calculateInstallmentsPaid(
          updated.id,
          Number(updated.monthly_due || 0)
        );

        // ✅ Update info panel with fresh data INCLUDING installments paid
        infoSet([
          `<b>Name:</b> ${esc(updated.first_name || 'N/A')} ${esc(updated.last_name || '')}`,
          `<b>Plan:</b> ${esc(updated.plan_type || 'N/A')}`,
          `<b>Monthly Due:</b> ${currency(updated.monthly_due)}`,
          `<b>Contracted Price:</b> ${currency(updated.contracted_price)}`,
          `<b>Balance:</b> ${currency(updated.balance)}`,
          `<b>Installments Paid:</b> ${installmentsPaid} months`,
          `<b>Membership Paid:</b> ${updated.membership_paid ? '✅ Yes' : '❌ No'}`,
          `<b>Address:</b> ${esc(updated.address || 'N/A')}`,
        ].join('\n'));

        // ✅ Reapply UI locks using updated balance after this collection
        applyInstallmentLocks(currentMember);
      }
    } catch (e) {
      console.error('[refresh balance]', e);
    }

    // Reset form fields only (keep the updated info panel visible)
    const form = qs('#collectForm');
    if (form) form.reset();

    const dateBox = qs('#date_paid');
    if (dateBox) dateBox.value = new Date().toISOString().slice(0, 10);

    // 🛑 FIX: Don't overwrite the info panel here - it already shows the updated balance
    // The info panel will naturally update when user enters a new AF No
    // KEEP the updated member displayed after save
    applyInstallmentLocks(currentMember);


  } catch (e) {
    console.error('[onSave] error', e);
    toast(e?.message || 'Request failed.', 'error');
  }
}

/* ---------- Start ---------- */
window.addEventListener('DOMContentLoaded', boot);
