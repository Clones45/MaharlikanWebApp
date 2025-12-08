/* add_collection.js — Cleaned & Refactored */

/* ==========================================================================
   1. UTILITIES & HELPERS
   ========================================================================== */
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

/** Safe number parser */
const num = (v) => Number(v || 0);

/** Currency formatter */
const peso = (n) => `₱${num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Safe HTML excaping */
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])));

/** Get today's date in YYYY-MM-DD */
const today = () => new Date().toISOString().slice(0, 10);

/** Checkbox state helper */
const isChecked = (selector) => !!qs(selector)?.checked;

/** Toast Notification */
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

function logError(context, err) {
  console.error(`[${context}]`, err);
  toast(`${context} failed. Check console.`, 'error');
}

/* ==========================================================================
   2. APP STATE & SUPABASE
   ========================================================================== */
let supabase = null;
let currentMember = null;
let planCache = {};

async function boot() {
  try {
    let env = null;
    if (window.electronAPI?.getEnv) {
      try { env = await window.electronAPI.getEnv(); } catch { }
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) { if (window.__ENV__) env = window.__ENV__; }

    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
      infoSet(`<span style="color:#e66">Missing Supabase env. Check preload/main.</span>`);
      const dateBox = qs('#date_paid');
      if (dateBox) dateBox.value = today();
      return;
    }

    const dummyStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };

    if (window.supabase?.createClient) {
      supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: dummyStorage
        },
      });

      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          console.log('[Auth] User signed out.');
          alert('⚠️ Session expired. Please sign in again on the main window.');
        }
      });
    }

    wireEvents();
  } catch (e) {
    logError('boot', e);
  }
}

/* ==========================================================================
   3. UI LOGIC & EVENTS
   ========================================================================== */
function wireEvents() {
  qs('#collectForm')?.addEventListener('submit', onSave);

  const mafInput = qs('#maf_no');
  const amountInput = qs('#amount');

  const lookupMember = () => loadMemberForMAF();

  // Wire member lookup
  if (mafInput) {
    ['input', 'keyup', 'blur', 'change'].forEach(ev => mafInput.addEventListener(ev, lookupMember));
  }

  // Wire amount focus to also trigger lookup if needed
  if (amountInput) {
    amountInput.addEventListener('focus', lookupMember);
  }

  qs('#btnReset')?.addEventListener('click', resetForm);
  qs('#btnBack')?.addEventListener('click', () => history.back?.());
}

function resetForm() {
  qs('#collectForm')?.reset();
  const dateBox = qs('#date_paid');
  if (dateBox) dateBox.value = today();

  applyInstallmentLocks(null);
  currentMember = null;
  infoSet('Enter AF No and tab/click away to load member details.');
}

function infoSet(html) {
  const el = qs('#memberInfo');
  if (el) el.innerHTML = html;
}

/* ==========================================================================
   4. MEMBER LOADING & LOGIC
   ========================================================================== */
async function loadMemberForMAF() {
  const info = qs('#memberInfo');
  const rawMaf = (qs('#maf_no')?.value || '').trim();

  // Reset state if empty
  if (!rawMaf) {
    currentMember = null;
    info.textContent = 'Enter AF No and tab/click away to load member details.';
    return;
  }
  if (rawMaf.length < 2) return;

  const afNumber = rawMaf.toUpperCase();
  if (currentMember && currentMember.maf_no === afNumber) return; // Debounce if already loaded

  info.textContent = `Looking up AF No: ${afNumber} …`;

  try {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('maf_no', afNumber)
      .limit(1);

    if (error) throw error;

    if (!data || !data.length) {
      info.innerHTML = `<span style="color:#e66">Member not found for AF No: ${esc(afNumber)}</span>`;
      currentMember = null;
      applyInstallmentLocks(null);
      return;
    }

    currentMember = data[0];

    // Calculate installments
    const installmentsPaid = await calculateInstallmentsPaid(
      currentMember.id,
      num(currentMember.monthly_due)
    );

    // Render Info
    info.innerHTML = [
      `<b>Name:</b> ${esc(currentMember.first_name || 'N/A')} ${esc(currentMember.last_name || '')}`,
      `<b>Plan:</b> ${esc(currentMember.plan_type || 'N/A')}`,
      `<b>Monthly Due:</b> ${peso(currentMember.monthly_due)}`,
      `<b>Contracted Price:</b> ${peso(currentMember.contracted_price)}`,
      `<b>Balance:</b> ${peso(currentMember.balance)}`,
      `<b>Installments Paid:</b> ${installmentsPaid} months`,
      `<b>Membership Paid:</b> ${currentMember.membership_paid ? '✅ Yes' : '❌ No'}`,
      `<b>Address:</b> ${esc(currentMember.address || 'N/A')}`,
    ].join('\n');

    applyInstallmentLocks(currentMember, installmentsPaid);

  } catch (e) {
    console.error('[loadMember_error]', e);
    info.innerHTML = `<span style="color:#e66">Lookup exception: ${esc(e.message)}</span>`;
  }
}

async function calculateInstallmentsPaid(memberId, monthlyDue) {
  if (!memberId || monthlyDue <= 0) return 0;

  try {
    const { data: cols, error } = await supabase
      .from('collections')
      .select('payment, payment_for')
      .eq('member_id', memberId);

    if (error) throw error;

    let totalRegular = 0;
    for (const c of cols || []) {
      const payFor = (c.payment_for || '').toLowerCase();
      // Count regular and membership payments
      if (!payFor || payFor.includes('regular') || payFor.includes('membership')) {
        totalRegular += num(c.payment);
      }
    }

    return Math.floor(totalRegular / monthlyDue);
  } catch (e) {
    console.error('[calcInstallments]', e);
    return 0;
  }
}

/**
 * applyInstallmentLocks(member, knownInstallments)
 * Locks UI checkboxes if member has paid >= 13 installments.
 */
function applyInstallmentLocks(member, knownInstallments = null) {
  const chkMonthly = qs('#monthly_commission_given');
  const chkPocket = qs('#deduct_now');
  const installInfo = qs('#installmentInfo');

  // Reset if no member
  if (!member) {
    if (chkMonthly) { chkMonthly.disabled = false; chkMonthly.title = ""; }
    if (chkPocket) { chkPocket.disabled = false; chkPocket.title = ""; }
    if (installInfo) installInfo.textContent = '';
    return;
  }

  let installments = knownInstallments;

  // If not provided, re-calculate roughly from balance (fallback)
  if (installments === null) {
    const monthlyDue = num(member.monthly_due);
    const contracted = num(member.contracted_price);
    const balance = num(member.balance);

    if (monthlyDue > 0 && contracted > 0) {
      const totalPaid = Math.max(0, contracted - balance);
      installments = Math.floor(totalPaid / monthlyDue);
    } else {
      installments = 0;
    }
  }

  if (installInfo) {
    installInfo.textContent = `Monthly installments paid: ${installments}`;
  }

  // Rule: >= 13 Installments -> Disable Monthly Comm & Out of Pocket
  const isLocked = installments >= 13;

  if (chkMonthly) {
    chkMonthly.disabled = isLocked;
    if (isLocked) {
      chkMonthly.checked = false;
      chkMonthly.title = "Disabled: 13+ installments paid";
    } else {
      chkMonthly.title = "";
    }
  }

  if (chkPocket) {
    chkPocket.disabled = isLocked;
    if (isLocked) {
      chkPocket.checked = false;
      chkPocket.title = "Disabled: 13+ installments paid";
    } else {
      chkPocket.title = "";
    }
  }

  // NOTE: Travel allowance is intentionally NOT locked.
}

/* ==========================================================================
   5. ACTIONS (SAVE & RECOMPUTE)
   ========================================================================== */
async function onSave(e) {
  e.preventDefault();
  if (!currentMember) {
    await loadMemberForMAF();
    if (!currentMember) return;
  }

  // --- 1. Gather Inputs ---
  const afNumber = (qs('#maf_no')?.value || '').trim();
  const rawAmount = (qs('#amount')?.value || '').replace(/[, ]/g, '');
  const inputAmount = num(rawAmount);
  const datePaid = qs('#date_paid')?.value || today();
  const orNumber = (qs('#or_no')?.value || '').trim();
  const paymentFor = (qs('#payment_for')?.value || '').toLowerCase();

  // --- 2. Determine Modes & Flags ---
  const isMembership = paymentFor.includes('membership');

  // Checkboxes
  // Ensure strict boolean values
  const isMonthly = isChecked('#monthly_commission_given');
  const isTravel = isChecked('#travel_allowance_given');

  // Logic: Deduct flag only applies to membership
  const isDeduct = !!(isMembership && isChecked('#deduct_now'));

  // Derived Personally Collected Status (User Logic)
  // If ANY commission flag is checked OR it is a deducted membership, we treat as paid/personally collected.
  const isPersonallyCollected = !!(isMonthly || isTravel || isDeduct);

  const outrightMode = isDeduct ? 'deduct' : 'accrue';

  // --- 3. Validate ---
  if (!afNumber) return toast('AF No is required.', 'error');
  if (!orNumber) {
    qs('#or_no')?.focus();
    return toast('OR No. is required.', 'error');
  }

  if (!currentMember.agent_id) {
    return toast("This member has no Agent Assigned yet.", "error");
  }

  // --- 4. Determine Exact Payment Amount ---
  let finalPayment = inputAmount;

  if (isMembership) {
    // Membership Rule: Deduct=350, Accrue=500
    finalPayment = isDeduct ? 350 : 500;
  } else {
    // Regular validation
    if (finalPayment <= 0) {
      qs('#amount')?.focus();
      return toast('Enter a valid amount.', 'error');
    }
  }

  try {
    // --- 5. Construct Payload ---
    const payload = {
      member_id: currentMember.id,
      agent_id: currentMember.agent_id,
      maf_no: currentMember.maf_no,

      payment: finalPayment,
      date_paid: datePaid,
      collection_month: datePaid.substring(0, 7) + '-01',

      // Demographics Snapshot
      last_name: currentMember.last_name,
      first_name: currentMember.first_name,
      middle_name: currentMember.middle_name,
      address: currentMember.address,
      plan_type: currentMember.plan_type,

      // Meta
      or_no: orNumber,
      payment_for: isMembership ? 'membership' : 'regular',
      is_membership_fee: isMembership,
      outright_mode: outrightMode,

      // 🛑 CRITICAL FLAGS
      deduct_now: isDeduct,
      got_monthly_commission: isMonthly,
      got_travel_allowance: isTravel,
      personally_collected: isPersonallyCollected
    };

    console.log('[onSave] Inserting:', payload);

    const { error: insErr } = await supabase
      .from('collections')
      .insert(payload)
      .single();

    if (insErr) throw insErr;

    // --- 6. Post-Save Actions ---
    await recomputeMemberBalance(currentMember.id);

    toast('✅ Collection saved successfully.', 'success');

    // Refresh UI with latest balance
    await loadMemberForMAF();

    // Reset Form (Partial)
    partialResetForm();

  } catch (err) {
    logError('onSave', err);
  }
}

function partialResetForm() {
  const form = qs('#collectForm');
  if (!form) return;

  qs('#amount').value = '';
  qs('#or_no').value = '';
  qs('#or_no').focus();

  // Reset date to today
  const dateBox = qs('#date_paid');
  if (dateBox) dateBox.value = today();

  // Reset flags
  if (qs('#monthly_commission_given')) qs('#monthly_commission_given').checked = false;
  if (qs('#travel_allowance_given')) qs('#travel_allowance_given').checked = false;
  if (qs('#deduct_now')) qs('#deduct_now').checked = false;
}

/**
 * Recomputes member balance based on all collections.
 */
async function recomputeMemberBalance(memberId) {
  try {
    const { data: allCollections, error: colErr } = await supabase
      .from('collections')
      .select('payment, payment_for')
      .eq('member_id', memberId);

    if (colErr) throw colErr;

    let totalPaid = 0;
    for (const c of allCollections || []) {
      const payFor = (c.payment_for || '').toLowerCase();
      // Only Regular and Membership count towards balance
      if (!payFor || payFor.includes('membership') || payFor.includes('regular')) {
        totalPaid += num(c.payment);
      }
    }

    // Get fresh member data for contracted price
    const { data: mem, error: memErr } = await supabase
      .from('members')
      .select('contracted_price, balance')
      .eq('id', memberId)
      .single();

    if (memErr) throw memErr;

    const contracted = num(mem.contracted_price);
    // Fallback if contracted is missing (legacy)
    const basePrice = contracted > 0 ? contracted : (num(mem.balance) + totalPaid);

    const newBalance = Math.max(0, basePrice - totalPaid);
    const safeBalance = Number(newBalance.toFixed(2));

    const { error: updErr } = await supabase
      .from('members')
      .update({ balance: safeBalance })
      .eq('id', memberId);

    if (updErr) console.error('[Balance Update Failed]', updErr);
    else console.log(`Balance updated to ${peso(safeBalance)}`);

  } catch (err) {
    console.warn('[recomputeMemberBalance] failed:', err);
  }
}

/* ==========================================================================
   6. BOOT
   ========================================================================== */
window.addEventListener('DOMContentLoaded', boot);
