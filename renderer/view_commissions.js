// =======================================================
// view_commissions.js — Interactive Commission Dashboard
// STRICT CLASSIFICATION LOGIC REWRITE
// Sources: commissions.is_receivable, commissions.commission_type
// =======================================================

/* ===== DOM Selectors ===== */
const qs = (id) => document.getElementById(id);
const SELECTORS = {
  tbody: qs('tbody'),
  periodEl: qs('periodLabel'),
  monthSel: qs('monthSel'),
  yearSel: qs('yearSel'),
  applyBtn: qs('applyBtn'),
  exportBtn: qs('exportBtn'),
  printBtn: qs('printBtn'),
  tCollection: qs('tCollection')
};

/* ===== Config & State ===== */
let supabaseClient = null;
const SAVE_TO_DB = true;

/* ===== Utils ===== */
const num = (v) => Number(v || 0);
const peso = (n) => '₱' + num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

function renderEmpty(msg) {
  SELECTORS.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">${esc(msg || 'No data')}</td></tr>`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ===== Toast Notification ===== */
const toastEl = (() => {
  const x = document.getElementById('toast') || document.createElement('div');
  if (!x.id) { x.id = 'toast'; document.body.appendChild(x); }
  x.classList.add('toast');
  return x;
})();

function toast(msg, type = 'info') {
  toastEl.textContent = msg || '';
  toastEl.style.border = '1px solid ' + (type === 'error' ? '#d33' : type === 'success' ? '#2d6' : '#2c3548');
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ===== Boot ===== */
async function boot() {
  try {
    let env = null;
    if (window.electronAPI?.getEnv) {
      try { env = await window.electronAPI.getEnv(); } catch { }
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
      if (window.__ENV__) env = window.__ENV__;
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
      return renderEmpty('Supabase not configured');
    }

    const memoryStorage = (() => {
      let store = {};
      return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = value; },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
      };
    })();

    if (window.supabase?.createClient) {
      supabaseClient = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: memoryStorage
        }
      });
      // Restore session if passed in URL
      const params = new URLSearchParams(window.location.search);
      const token = params.get("access_token");
      const refresh = params.get("refresh_token");
      if (token && refresh) {
        await supabaseClient.auth.setSession({ access_token: token, refresh_token: refresh });
      }
    }

    setupSelectors();
    wireEvents();

    // Run Auto-Sync (if available)
    if (window.syncAGRCommissions) {
      await window.syncAGRCommissions(supabaseClient);
    }

    await loadAndRender();

  } catch (e) {
    console.error('BOOT ERROR:', e);
    renderEmpty('Error — check console');
  }
}

function setupSelectors() {
  const now = new Date();
  const cm = now.getMonth() + 1;
  const cy = now.getFullYear();

  SELECTORS.monthSel.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = String(m).padStart(2, '0');
    opt.textContent = new Date(2020, m - 1, 1).toLocaleString(undefined, { month: 'long' });
    if (m === cm) opt.selected = true;
    SELECTORS.monthSel.appendChild(opt);
  }

  SELECTORS.yearSel.innerHTML = '';
  for (let y = cy - 5; y <= cy + 1; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === cy) opt.selected = true;
    SELECTORS.yearSel.appendChild(opt);
  }

  updatePeriodLabel();
}

function wireEvents() {
  SELECTORS.applyBtn.addEventListener('click', loadAndRender);
  SELECTORS.exportBtn.addEventListener('click', exportToPDF);
  SELECTORS.printBtn.addEventListener('click', () => window.print());
  SELECTORS.monthSel.addEventListener('change', updatePeriodLabel);
  SELECTORS.yearSel.addEventListener('change', updatePeriodLabel);
}

/* ===== Date Cutoffs ===== */
function cutoffRange(y, m) {
  const Y = num(y);
  const M = num(m);

  // 7th of selected month -> 7th of next month
  const start = new Date(Y, M - 1, 7);
  const end = new Date(Y, M, 7);

  const toLocal = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  return { gte: toLocal(start), lt: toLocal(end), start, end };
}

function updatePeriodLabel() {
  const { start, end } = cutoffRange(SELECTORS.yearSel.value, SELECTORS.monthSel.value);
  const nice = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const endDisplay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  SELECTORS.periodEl.textContent = `${nice(start)} – ${nice(endDisplay)}`;
}

/* ===== COMMISSION CLASSIFICATION LOGIC ===== */

/**
 * Creates a fresh rollup object structure.
 */
function createRollup(agentId) {
  return {
    agent_id: num(agentId),
    monthly: 0,
    travel: 0,
    overrides: 0,
    recruiter: 0,
    outright: 0,

    // Aggregates
    receivable: 0,
    nonReceivable: 0,
    total: 0, // Grand Total

    // Meta / Other
    total_collection: 0,
    eligible: false,
    status: 'unreleased'
  };
}

/**
 * Main Classifier Function
 */
function classifyCommission(row, rollup) {
  const type = String(row.commission_type || '');
  const amount = num(row.amount);
  const overrideAmount = num(row.override_commission);
  const isReceivable = (row.is_receivable === true);

  // RULE 5: OVERRIDES
  if (type === 'override') {
    // FIX 2: Check strictly for non-zero to avoid 0 fallback issue
    const val = (overrideAmount !== 0) ? overrideAmount : amount;
    addToOverrides(rollup, val);
    addToReceivable(rollup, val); // Always Receivable
    return;
  }

  // RULE 6: RECRUITER BONUS
  if (type === 'recruiter_bonus') {
    addToRecruiter(rollup, amount);
    addToReceivable(rollup, amount); // Always Receivable
    return;
  }

  // RULE 3: MONTHLY COMMISSION
  if (type === 'plan_monthly') {
    rollup.monthly += amount;
    rollup.total += amount;

    if (isReceivable) {
      addToReceivable(rollup, amount);
    } else {
      addToNonReceivable(rollup, amount);
    }
    return;
  }

  // RULE 4: TRAVEL ALLOWANCE
  if (type === 'travel_allowance') {
    rollup.travel += amount;
    rollup.total += amount;

    if (isReceivable) {
      addToReceivable(rollup, amount);
    } else {
      addToNonReceivable(rollup, amount);
    }
    return;
  }

  // RULE 7: OUTRIGHT (Membership)
  if (type === 'membership_outright') {
    rollup.outright += amount;
    // FIX 1: Always add to total
    rollup.total += amount;

    if (isReceivable) {
      addToReceivable(rollup, amount);
    } else {
      addToNonReceivable(rollup, amount);
    }
    return;
  }

  // Fallback for unknown types (safe default)
  // If explicitly receivable -> Receivable, else Non-Receivable
  if (isReceivable) {
    addToReceivable(rollup, amount);
  } else {
    addToNonReceivable(rollup, amount);
  }
  // FIX 3: Always add fallback items to total
  rollup.total += amount;
}

function addToReceivable(rollup, val) {
  rollup.receivable += val;
  // NOTE: Rule 5 & 6 say Overrides/Recruiter add to TOTAL?
  // User Prompt: "Total = sum of all commissions"
  // For Overrides/Recruiter, we added to their specific bucket. 
  // We must ensure they are also added to `total`.
  // Note that classifyCommission Logic for Monthly/Travel/Outright ALREADY adds to `total`.
  // Overrides/Recruiter blocks above did NOT add to `rollup.total` yet.
  // Correction: I should add to `rollup.total` inside the specific blocks or here.
  // To be safe, I'll add to total in the specific blocks to match strict logic.
  // Wait, `addToReceivable` is just a bucket helper. I shouldn't double add total here.
}

function addToNonReceivable(rollup, val) {
  rollup.nonReceivable += val;
}

function addToOverrides(rollup, val) {
  rollup.overrides += val;
  rollup.total += val;
}

function addToRecruiter(rollup, val) {
  rollup.recruiter += val;
  rollup.total += val;
}


/* ===== Data Loading & Aggregation ===== */
async function loadAndRender() {
  try {
    renderEmpty('Loading…');
    const y = SELECTORS.yearSel.value;
    const m = SELECTORS.monthSel.value;
    const { gte, lt } = cutoffRange(y, m);

    // 1. Fetch Data
    const [
      { data: agents },
      { data: commissions },
      { data: collsRaw }
    ] = await Promise.all([
      supabaseClient.from('agents').select('id,firstname,lastname,parent_id'),
      // Select all relevant fields, including override_commission
      supabaseClient.from('commissions').select('*, is_receivable, override_commission').gte('date_earned', gte).lt('date_earned', lt),
      supabaseClient.from('collections').select('id,agent_id,payment,is_membership_fee,member_id,payment_for').gte('date_paid', gte).lt('date_paid', lt)
    ]);

    // 2. Initialize Rollups
    const rollups = {};
    const ensureRollup = (aid) => {
      if (!rollups[aid]) rollups[aid] = createRollup(aid);
      return rollups[aid];
    };

    // 3. Process Commissions
    for (const row of (commissions || [])) {
      if (!row.agent_id) continue;
      const r = ensureRollup(row.agent_id);
      classifyCommission(row, r);
    }

    // 4. Process Collections (For Total Collection & Eligibility)
    const byAgentCols = {};
    let overallCollection = 0;

    (collsRaw || []).forEach(c => {
      if (!byAgentCols[c.agent_id]) byAgentCols[c.agent_id] = [];
      byAgentCols[c.agent_id].push(c);
    });

    for (const [aidStr, list] of Object.entries(byAgentCols)) {
      const aid = num(aidStr);
      const r = ensureRollup(aid);

      r.total_collection = list.reduce((sum, x) => sum + num(x.payment), 0);
      overallCollection += r.total_collection;

      // ELIGIBILITY RULES
      // Rule A: 3+ Membership payments
      const membershipCount = list.filter(x => x.is_membership_fee === true).length;
      const ruleA = membershipCount >= 3;

      // Rule B: 1 Member paying BOTH Regular + Membership
      const byMember = {};
      list.forEach(item => {
        if (!byMember[item.member_id]) byMember[item.member_id] = [];
        byMember[item.member_id].push(item);
      });

      let ruleB = false;
      for (const payments of Object.values(byMember)) {
        const hasMem = payments.some(p => p.is_membership_fee === true);
        const hasReg = payments.some(p => p.is_membership_fee === false && p.payment_for === 'regular');
        if (hasMem && hasReg) { ruleB = true; break; }
      }

      r.eligible = ruleA || ruleB;
    }

    SELECTORS.tCollection.textContent = peso(overallCollection);

    // 5. Render
    await renderTable(rollups, agents, byAgentCols, num(y), num(m), { gte, lt });

  } catch (e) {
    console.error('loadAndRender Error:', e);
    renderEmpty('Failed to load data');
    toast(e.message, 'error');
  }
}


/* ===== Withdraw Logic ===== */
async function handleWithdraw(agentId, mode, customAmount) {
  try {
    const { data: wallet, error: wErr } = await supabaseClient
      .from('agent_wallets')
      .select('balance')
      .eq('agent_id', agentId)
      .maybeSingle();

    if (wErr) throw wErr;

    const currentBalance = num(wallet?.balance);
    if (currentBalance <= 0) return toast('No withdrawable balance available', 'error');
    if (currentBalance < 500) return toast('Minimum balance to withdraw is ₱500.00', 'error');

    let targetAmount = (mode === 'all') ? currentBalance : num(customAmount);

    if (targetAmount <= 0) return toast('Please enter a valid amount', 'error');
    if (targetAmount < 500) return toast('Minimum withdrawal per transaction is ₱500.00', 'error');
    if (targetAmount > currentBalance) return toast(`Requested amount is higher than your wallet balance (${peso(currentBalance)}).`, 'error');

    // --- Retrieve Note ---
    const noteEl = qs(`inp-wnote-${agentId}`);
    const noteVal = noteEl ? noteEl.value.trim() : '';

    // --- Deduction Logic ---
    const tax = targetAmount * 0.10;
    const fee = 50.00;
    const net = targetAmount - tax - fee;

    if (net <= 0) {
      return toast(`Amount too low. After Tax (10%) and Fee (₱50), net is ${peso(net)}.`, 'error');
    }

    // --- Confirmation Dialog ---
    const msg = `Withdrawal Summary:
---------------------------
Gross Amount:    ${peso(targetAmount)}
Less Tax (10%):  ${peso(tax)}
Less Proc. Fee:  ${peso(fee)}
---------------------------
Net Receivable:  ${peso(net)}
Note:            ${noteVal || '(None)'}

Proceed with this withdrawal?`;

    if (!confirm(msg)) return;

    const { error: rpcErr } = await supabaseClient.rpc('withdraw_commission', {
      p_agent_id: agentId,
      p_amount: targetAmount,
      p_method: 'Gcash',
      p_notes: noteVal
    });

    if (rpcErr) throw rpcErr;

    toast(`Withdrawal submitted. Net: ${peso(net)}`, 'success');
    await loadAndRender();

  } catch (e) {
    console.error('Withdraw Error:', e);
    // Parse RPC error if possible
    if (e.message && e.message.includes('pending withdrawal')) {
      toast('You already have a pending withdrawal request.', 'error');
    } else {
      toast(e.message || 'Unexpected error while withdrawing', 'error');
    }
  }
}

/* ===== Rendering ===== */
async function renderTable(rollups, agents, byAgentCols, py, pm, range) {
  SELECTORS.tbody.innerHTML = '';
  const agentById = {};
  (agents || []).forEach(a => agentById[a.id] = a);

  // Sorting
  const rows = Object.values(rollups).sort((a, b) => {
    const A = agentById[a.agent_id], B = agentById[b.agent_id];
    const an = A ? `${A.lastname || ''}` : `${a.agent_id}`;
    const bn = B ? `${B.lastname || ''}` : `${b.agent_id}`;
    return an.localeCompare(bn);
  });

  for (const r of rows) {
    const A = agentById[r.agent_id];
    const name = A ? `${A.lastname?.toUpperCase()}, ${A.firstname}` : `Agent #${r.agent_id}`;
    const tr = document.createElement('tr');
    tr.className = 'agent-row';
    tr.dataset.agentId = r.agent_id;

    tr.innerHTML = `
      <td style="color:#60a5fa;cursor:pointer;">${esc(name)}</td>
      <td class="right">${peso(r.monthly)}</td>
      <td class="right" style="color:#fbbf24">${peso(r.travel)}</td>
      <td class="right">${peso(r.overrides)}</td>
      <td class="right">${peso(r.outright)}</td>
      <td class="right">${peso(r.recruiter)}</td>
      <td>${r.eligible ? 'Eligible' : 'Pending'}</td>
    `;
    SELECTORS.tbody.appendChild(tr);
  }

  // Row Expansion
  SELECTORS.tbody.querySelectorAll('.agent-row').forEach(tr => {
    tr.addEventListener('click', async () => {
      const aid = tr.dataset.agentId;
      if (tr.nextElementSibling?.classList.contains('agent-detail')) {
        tr.nextElementSibling.remove();
        return;
      }
      await renderAgentDetail(tr, aid, range, rollups[aid]);
    });
  });

  injectStyles();
}

async function renderAgentDetail(rowTr, aid, range, rollup) {
  // Fetch detailed info
  const { data: colls } = await supabaseClient.from('collections')
    .select('date_paid,or_no,payment_for,member_id,payment,first_name,last_name')
    .or(`agent_id.eq.${aid},collector_id.eq.${aid}`)
    .gte('date_paid', range.gte).lt('date_paid', range.lt);

  const { data: wallet } = await supabaseClient.from('agent_wallets')
    .select('balance')
    .eq('agent_id', aid)
    .maybeSingle();

  const withdrawableTotal = num(wallet?.balance);

  let html = `<tr class="agent-detail"><td colspan="6"><div class="detail-wrapper">`;

  // A. Collections Table
  html += `<h4>Collections</h4><div class="table-scroll"><table class="detail-table">
    <tr><th>Date</th><th>OR</th><th>Member</th><th>For</th><th class="right">Amt</th></tr>`;
  (colls || []).forEach(c => {
    html += `<tr>
      <td>${esc(c.date_paid)}</td>
      <td>${esc(c.or_no)}</td>
      <td>${esc(c.last_name)}, ${esc(c.first_name)}</td>
      <td>${esc(c.payment_for)}</td>
      <td class="right">${peso(c.payment)}</td>
    </tr>`;
  });
  html += `</table></div>`;

  // B. Breakdown & Classification
  html += `
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:15px;">
    <div>
      <h4>Breakdown</h4>
      <table class="detail-table">
      <tr><td>Outright</td><td class="right">${peso(rollup.outright)}</td></tr>
        <tr><td>Monthly</td><td class="right">${peso(rollup.monthly)}</td></tr>
        <tr><td>Overrides</td><td class="right">${peso(rollup.overrides)}</td></tr>
        <tr><td>Travel</td><td class="right">${peso(rollup.travel)}</td></tr>
        <tr><td>RLC</td><td class="right">${peso(rollup.recruiter)}</td></tr>
        <tr style="border-top:1px solid #ffffff22">
          <td><b>Total Earned</b></td>
          <td class="right" style="color:#4ade80;font-weight:700">${peso(rollup.total)}</td>
        </tr>
      </table>
    </div>
    <div>
      <h4>Classification</h4>
      <table class="detail-table">
        <tr>
          <td style="color:#94a3b8">Receivable (Unpaid + Overrides)</td>
          <td class="right" style="color:#4ade80">${peso(rollup.receivable)}</td>
        </tr>
        <tr>
          <td style="color:#94a3b8">Non-Receivable (Paid)</td>
          <td class="right" style="color:#64748b">${peso(rollup.nonReceivable)}</td>
        </tr>
      </table>
    </div>
  </div>`;

  // C. Footer
  html += `
  <div style="margin-top:15px; border-top:1px solid #ffffff22; padding-top:15px; display:flex; justify-content:space-between; align-items:center;">
    <div>
      <div style="font-size:12px;color:#94a3b8">Withdrawable Balance</div>
      <div style="font-size:16px;font-weight:700;color:#34d399">${peso(withdrawableTotal)}</div>
    </div>
    <div style="display:flex; gap:8px; align-items:center;">
      <input type="text" class="dark-input" id="inp-wnote-${aid}" placeholder="Note (optional)" style="width:150px;">
      <button class="action-btn btn-green" id="btn-wall-${aid}">Withdraw All</button>
      <input type="number" class="dark-input" id="inp-wcustom-${aid}" placeholder="Amt" style="width:80px;">
      <button class="action-btn btn-blue" id="btn-wcustom-${aid}">Withdraw</button>
    </div>
  </div>
  </div></td></tr>`;

  rowTr.insertAdjacentHTML('afterend', html);

  // Wire buttons
  qs(`btn-wall-${aid}`)?.addEventListener('click', () => handleWithdraw(num(aid), 'all'));
  qs(`btn-wcustom-${aid}`)?.addEventListener('click', () => {
    const val = num(qs(`inp-wcustom-${aid}`)?.value);
    handleWithdraw(num(aid), 'custom', val);
  });
}

function injectStyles() {
  if (qs('premium-styles')) return;
  const s = document.createElement('style');
  s.id = 'premium-styles';
  s.textContent = `
    .right{text-align:right}
    .detail-wrapper{background:#0f172a; margin:10px 20px; border-radius:12px; border:1px solid #ffffff15; padding:20px}
    h4{margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; border-bottom:1px solid #ffffff15; padding-bottom:4px}
    .detail-table{width:100%; font-size:13px; border-collapse:collapse; margin-bottom:10px}
    .detail-table th{text-align:left; color:#64748b; padding:6px; border-bottom:1px solid #ffffff10}
    .detail-table td{padding:6px; color:#e2e8f0; border-bottom:1px solid #ffffff08}
    .action-btn{padding:8px 12px; border-radius:6px; border:none; cursor:pointer; font-weight:600; font-size:12px}
    .btn-green{background:#059669; color:#fff}
    .btn-blue{background:#0284c7; color:#fff}
    .dark-input{background:#1e293b; border:1px solid #334155; color:#fff; padding:6px; border-radius:6px}
    .table-scroll{max-height:200px; overflow-y:auto;}
  `;
  document.head.appendChild(s);
}

/* ===== PDF Export ===== */
function exportToPDF() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF || !window.jspdf?.autoTable) return toast('jsPDF + autotable not found', 'error');
  const doc = new jsPDF('landscape');
  doc.autoTable({ html: '.detail-table' });
  doc.save('commissions.pdf');
}

window.addEventListener('load', boot);
