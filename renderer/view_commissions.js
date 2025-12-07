// =======================================================
// view_commissions.js — Interactive Commission Dashboard
// Cutoff: 7th (current month) → 6th (next month)
// STORAGE PERIOD = START MONTH (selected month)
// RELEASE PERIOD = NEXT MONTH (payout month)
// =======================================================

/* ===== DOM ===== */
const tbody = document.getElementById('tbody');
const periodEl = document.getElementById('periodLabel');
const monthSel = document.getElementById('monthSel');
const yearSel = document.getElementById('yearSel');
const applyBtn = document.getElementById('applyBtn');
const exportBtn = document.getElementById('exportBtn');
const printBtn = document.getElementById('printBtn');
const tCollection = document.getElementById('tCollection');

/* ===== Config ===== */
let supabase = null;
const SAVE_TO_DB = true;
const RECRUITER_RATE = 0.10;

/* ===== Toast ===== */
const toastEl = (() => {
  const x = document.getElementById('toast') || document.createElement('div');
  if (!x.id) { x.id = 'toast'; document.body.appendChild(x); }
  x.classList.add('toast');
  return x;
})();
function toast(msg, type = 'info') {
  toastEl.textContent = msg || '';
  toastEl.style.border = '1px solid ' + (type === 'error'
    ? '#d33'
    : type === 'success'
      ? '#2d6'
      : '#2c3548');
  toastEl.style.background = '#0b1220';
  toastEl.style.color = '#e2e8f0';
  toastEl.style.position = 'fixed';
  toastEl.style.bottom = '16px';
  toastEl.style.right = '16px';
  toastEl.style.padding = '10px 14px';
  toastEl.style.borderRadius = '10px';
  toastEl.style.zIndex = '9999';
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ===== Boot ===== */
init().catch(e => {
  console.error('INIT ERROR:', e);
  renderEmpty('Error — check console');
});

async function init() {
  let env = null;
  if (window.electronAPI?.getEnv) {
    try { env = await window.electronAPI.getEnv(); } catch { }
  }
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    if (window.__ENV__) env = window.__ENV__;
  }
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    renderEmpty('Supabase not configured');
    return;
  }
  if (!window.supabase?.createClient) {
    renderEmpty('Supabase SDK not loaded');
    return;
  }

  // 🛑 CRITICAL: Use dummy storage to prevent clearing main window's localStorage
  const dummyStorage = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
  };

  supabase = window.supabase.createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: true,  // ✅ ENABLE: Auto-refresh tokens
        detectSessionInUrl: false,
        storage: dummyStorage    // ✅ ISOLATE from localStorage
      }
    }
  );

  // Session fix
  const params = new URLSearchParams(window.location.search);
  const token = params.get("access_token");
  const refresh = params.get("refresh_token");
  if (token && refresh) {
    await supabase.auth.setSession({ access_token: token, refresh_token: refresh });
  }

  setupSelectors();
  wireEvents();
  await loadAndRender();
}

/* ===== Setup Selectors ===== */
function setupSelectors() {
  const now = new Date();
  const cm = now.getMonth() + 1;
  const cy = now.getFullYear();

  monthSel.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = String(m).padStart(2, '0');
    opt.textContent = new Date(2020, m - 1, 1).toLocaleString(undefined, { month: 'long' });
    if (m === cm) opt.selected = true;
    monthSel.appendChild(opt);
  }

  yearSel.innerHTML = '';
  for (let y = cy - 5; y <= cy + 1; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === cy) opt.selected = true;
    yearSel.appendChild(opt);
  }

  updatePeriodLabel();
}


/* ===== Events ===== */
function wireEvents() {
  applyBtn.addEventListener('click', loadAndRender);
  exportBtn.addEventListener('click', exportToPDF);
  printBtn.addEventListener('click', () => window.print());
  monthSel.addEventListener('change', updatePeriodLabel);
  yearSel.addEventListener('change', updatePeriodLabel);
}

/* ===== Cutoff helpers ===== */
// Selected month => Start = 7th, End = next 7th
function cutoffRange(y, m) {
  const Y = Number(y);
  const M = Number(m); // 1–12

  const fmt = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const start = new Date(Y, M - 1, 7);
  const end = new Date(Y, M, 7);

  return { gte: fmt(start), lt: fmt(end), start, end };
}

// Selected month is eligibility month
function storagePeriod(y, m) {
  return { period_year: Number(y), period_month: Number(m) };
}

function updatePeriodLabel() {
  const y = +yearSel.value;
  const m = +monthSel.value;
  const { start, end } = cutoffRange(y, m);

  const nice = d => d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  const endDisplay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  periodEl.textContent = `${nice(start)} – ${nice(endDisplay)}`;
}

/* ===== Utils ===== */
const peso = n => '₱' + Number(n || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
function esc(s) {
  return (s == null ? '' : String(s))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
function renderEmpty(msg) {
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">${esc(msg || 'No data')}</td></tr>`;
}
function byIdMap(list) {
  const m = {}; (list || []).forEach(x => { m[x.id] = x; }); return m;
}
function groupBy(list, key) {
  const m = new Map();
  for (const x of (list || [])) {
    const k = (typeof key === 'function') ? key(x) : x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
function sum(list, sel) {
  let t = 0; for (const x of (list || [])) t += Number(sel ? sel(x) : x) || 0; return t;
}
function ensureRollup(map, aid) {
  if (!map[aid])
    map[aid] = {
      agent_id: +aid,
      monthly: 0,
      membership: 0,
      overrides: 0,
      recruiter: 0,
      grand_total: 0,
      total_collection: 0,
      eligible: false,
      status: 'unreleased'
    };
  return map[aid];
}

/* ===== Load / Compute / Render ===== */
async function loadAndRender() {
  try {
    renderEmpty('Loading…');
    const y = yearSel.value, m = monthSel.value;
    const { gte, lt } = cutoffRange(y, m);

    const { period_year, period_month } = storagePeriod(y, m);

    // Load agents
    const { data: agents } = await supabase.from('agents')
      .select('id,firstname,lastname,parent_id');

    // Load commissions earned in this eligibility cycle
    const { data: commissions } = await supabase.from('commissions')
      .select('*').gte('date_earned', gte).lt('date_earned', lt);

    // Load collections (this determines eligibility)
    const { data: collsRaw } = await supabase.from('collections')
      .select('id,agent_id,member_id,payment,payment_for,is_membership_fee,date_paid,or_no')
      .gte('date_paid', gte).lt('date_paid', lt);

    const rollups = {};
    // ===== Load SQL rollups for recruiter computation =====
    const { data: rollupsSQL, error: rollErr } = await supabase
      .from('agent_commission_rollups')
      .select('agent_id, grand_total_commission')
      .eq('period_year', period_year)
      .eq('period_month', period_month);

    if (rollErr) console.error("Error loading rollups:", rollErr);

    const rollupsSQLmap = {};
    (rollupsSQL || []).forEach(r => {
      rollupsSQLmap[r.agent_id] = r;
    });

    // 1. Commission totals
    for (const row of (commissions || [])) {
      const aid = row.agent_id; if (!aid) continue;
      const r = ensureRollup(rollups, aid);
      const type = String(row.commission_type || '');
      const val = Number(row.amount || 0) + Number(row.override_commission || 0);

      if ((type.includes('plan_monthly') || type === 'monthly') && !row.monthly_commission_given) r.monthly += val;
      if (type.includes('travel_allowance') && !row.travel_allowance_given) r.monthly += val;
      if (type.includes('membership')) r.membership += val;
      if (type.startsWith('override_') && !row.override_released) r.overrides += val;
    }

    // 2. Group collections by agent
    const byAgentCols = groupBy(collsRaw || [], 'agent_id');
    let overallCollection = 0;

    for (const [aid, list] of byAgentCols.entries()) {
      const r = ensureRollup(rollups, aid);
      r.total_collection = sum(list, x => x.payment);
      overallCollection += r.total_collection;

      // ===== Eligibility Rule A =====
      const membershipCount = list.filter(x => x.is_membership_fee === true).length;
      const ruleA = membershipCount >= 3;

      // ===== Eligibility Rule B (same member must pay both) =====
      const byMember = groupBy(list, 'member_id');
      let ruleB = false;

      for (const [, payments] of byMember.entries()) {
        const hasMembership = payments.some(p => p.is_membership_fee === true);
        const hasRegular = payments.some(
          p => p.is_membership_fee === false && p.payment_for === 'regular'
        );

        if (hasMembership && hasRegular) {
          ruleB = true;
          break;
        }
      }

      // FINAL RULE
      r.eligible = ruleA || ruleB;


    }

    tCollection.textContent = peso(overallCollection);

    // 3. Recruiter override bonuses
    // 3. Recruiter override bonuses (using SQL rollups)
    // recruiter_id must be used (not parent_id)
    // 3. Recruiter Bonus — DIRECT FROM COMMISSIONS TABLE (correct & live)
    for (const row of (commissions || [])) {
      // Only recruiter bonus rows (created by your trigger)
      if (row.commission_type === 'recruiter_bonus') {
        const recruiterId = row.agent_id;
        if (!recruiterId) continue;

        const r = ensureRollup(rollups, recruiterId);
    r.recruiter += Number(row.amount || 0);
  }
}



    // 4. Grand totals
    for (const r of Object.values(rollups))
      r.grand_total = r.monthly + r.membership + r.overrides + r.recruiter;

    await renderTable(
      rollups, agents, byAgentCols,
      period_year, period_month,
      { gte, lt }
    );

  } catch (e) {
    console.error(e);
    renderEmpty('Failed');
    toast(e.message, 'error');
  }
}

/* ===== Withdraw Logic (FIFO by month) ===== */
/* ===== Withdraw Logic (unlimited, from wallet) ===== */
async function handleWithdraw(agentId, mode, customAmount) {
  try {
    // 1. Load current wallet balance
    const { data: wallet, error: wErr } = await supabase
      .from('agent_wallets')
      .select('balance')
      .eq('agent_id', agentId)
      .maybeSingle();

    if (wErr) {
      console.error(wErr);
      toast('Failed to load wallet balance', 'error');
      return;
    }

    const currentBalance = Number(wallet?.balance || 0);

    if (!currentBalance || currentBalance <= 0) {
      toast('No withdrawable balance available', 'error');
      return;
    }

    if (currentBalance < 500) {
      toast('Minimum balance to withdraw is ₱500.00', 'error');
      return;
    }

    // 2. Determine amount
    let targetAmount = 0;

    if (mode === 'all') {
      targetAmount = currentBalance;
    } else {
      targetAmount = Number(customAmount || 0);
      if (!targetAmount || targetAmount <= 0) {
        toast('Please enter a valid amount', 'error');
        return;
      }
    }

    // 3. Validate against rules
    if (targetAmount < 500) {
      toast('Minimum withdrawal per transaction is ₱500.00', 'error');
      return;
    }

    if (targetAmount > currentBalance) {
      toast(
        `Requested amount is higher than your wallet balance (${peso(currentBalance)}).`,
        'error'
      );
      return;
    }

    // 4. Call RPC to perform withdrawal atomically
    const { error: rpcErr } = await supabase
      .rpc('withdraw_commission', {
        p_agent_id: agentId,
        p_amount: targetAmount
      });

    if (rpcErr) {
      console.error(rpcErr);
      toast('Failed to process withdrawal', 'error');
      return;
    }

    toast(`Withdrawal of ${peso(targetAmount)} processed.`, 'success');

    // Reload table / wallet display
    await loadAndRender();
  } catch (e) {
    console.error(e);
    toast('Unexpected error while withdrawing', 'error');
  }
}


/* ===== Render Table ===== */
async function renderTable(rollups, agents, byAgentCols, py, pm, range) {
  tbody.innerHTML = '';

  const agentById = byIdMap(agents);
  const rows = Object.values(rollups).sort((a, b) => {
    const A = agentById[a.agent_id], B = agentById[b.agent_id];
    const an = A ? `${A.lastname || ''}, ${A.firstname || ''}` : `${a.agent_id}`;
    const bn = B ? `${B.lastname || ''}, ${B.firstname || ''}` : `${b.agent_id}`;
    return an.localeCompare(bn);
  });

  for (const r of rows) {
    const A = agentById[r.agent_id];
    const name = A ? `${A.lastname?.toUpperCase()}, ${A.firstname}` : `Agent #${r.agent_id}`;

    const tr = document.createElement('tr');
    tr.classList.add('agent-row');
    tr.dataset.agentId = r.agent_id;

    tr.innerHTML = `
      <td style="color:#60a5fa;cursor:pointer;">${esc(name)}</td>
      <td class="right">${peso(r.monthly)}</td>
      <td class="right">${peso(r.overrides)}</td>
      <td class="right">${peso(r.membership)}</td>
      <td class="right">${peso(r.recruiter)}</td>
      <td>${r.eligible ? 'Eligible' : 'Pending'}</td>
    `;
    tbody.appendChild(tr);
  }

  // Expand row
  tbody.querySelectorAll('.agent-row').forEach(tr => {
    tr.addEventListener('click', async () => {
      const aid = tr.dataset.agentId;

      if (tr.nextElementSibling?.classList.contains('agent-detail')) {
        tr.nextElementSibling.remove();
        return;
      }

      const { data: colls } = await supabase.from('collections')
        .select('date_paid,or_no,payment_for,member_id,payment')
        .eq('agent_id', aid)
        .gte('date_paid', range.gte).lt('date_paid', range.lt);

      const r = rollups[aid];

      let html = `<tr class="agent-detail"><td colspan="6"><div style="padding:10px 15px;background:#1e293b;border-radius:10px;">
      <h4>Collections</h4>
      <table style="width:100%;margin-bottom:10px;border-collapse:collapse;">
      <tr><th>Date</th><th>OR No</th><th>Member</th><th>Payment For</th><th>Amount</th></tr>`;

      for (const c of (colls || []))
        html += `<tr>
          <td>${esc(c.date_paid)}</td>
          <td>${esc(c.or_no || '')}</td>
          <td>${esc(c.member_id || '')}</td>
          <td>${esc(c.payment_for || '')}</td>
          <td class="right">${peso(c.payment)}</td>
        </tr>`;

      html += `</table>

      <h4>Commission Summary</h4>
      <table style="width:100%;margin-bottom:8px;"><tr>
        <td>Monthly: ${peso(r.monthly)}</td>
        <td>Outright: ${peso(r.membership)}</td>
        <td>Overrides: ${peso(r.overrides)}</td>
        <td>Recruiter: ${peso(r.recruiter)}</td>
        <td><b>Total: ${peso(r.grand_total)}</b></td>
      </tr></table>

      <div style="margin-top:8px;">
        Total Collection: <b>${peso(r.total_collection)}</b>
      </div>

      <div id="withdrawable-${aid}"
           style="margin-top:12px;padding:10px;background:#0d1b2a;border-radius:8px;
                  color:#4ade80;font-weight:bold;">
        Withdrawable Balance: Loading…
      </div>

      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <button class="withdraw-all-btn" data-id="${aid}"
          style="background:#16a34a;color:white;padding:6px 12px;border:none;border-radius:8px;cursor:pointer;">
          Withdraw All
        </button>
        <input type="number" min="0" step="0.01" id="withdraw-input-${aid}"
          placeholder="Custom amount"
          style="padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#020617;color:#e2e8f0;">
        <button class="withdraw-custom-btn" data-id="${aid}"
          style="background:#0ea5e9;color:white;padding:6px 12px;border:none;border-radius:8px;cursor:pointer;">
          Withdraw Custom
        </button>
      </div>`;

      // eligibility info
      if (r.eligible) {
        html += `<div style="margin-top:10px;color:#4ade80;">Eligible for next-month commission.</div>`;
      } else {
        html += `<div style="margin-top:10px;color:#eab308">Not eligible for next-month commission</div>`;
      }

      html += `</div></td></tr>`;
      tr.insertAdjacentHTML('afterend', html);

      // ===== LOAD WITHDRAWABLE BALANCE (from wallet) =====
      const withdrawDiv = document.getElementById(`withdrawable-${aid}`);

      let withdrawableTotal = 0;

      const { data: wallet, error: wErr } = await supabase
        .from('agent_wallets')
        .select('balance')
        .eq('agent_id', aid)
        .maybeSingle();

      if (wErr) {
        console.error('Error loading wallet:', wErr);
      } else {
        withdrawableTotal = Number(wallet?.balance || 0);
      }

      if (withdrawDiv) {
        withdrawDiv.textContent =
          'Withdrawable Balance: ' + peso(withdrawableTotal);
      }



      // === Wire withdraw buttons ===
      const withdrawAllBtn = tbody.querySelector(`.withdraw-all-btn[data-id="${aid}"]`);
      if (withdrawAllBtn) {
        withdrawAllBtn.addEventListener('click', () => handleWithdraw(Number(aid), 'all'));
      }

      const withdrawCustomBtn = tbody.querySelector(`.withdraw-custom-btn[data-id="${aid}"]`);
      if (withdrawCustomBtn) {
        withdrawCustomBtn.addEventListener('click', () => {
          const input = document.getElementById(`withdraw-input-${aid}`);
          const amount = Number(input?.value || 0);
          handleWithdraw(Number(aid), 'custom', amount);
        });
      }
    });
  });

  injectStyles();
}

/* ===== Release Commission (single period, kept for admin use) ===== */
async function releaseCommission(agentId, year, month) {
  toast('Releasing commission...');

  const { error } = await supabase.from('agent_commission_rollups')
    .update({
      status: 'released',
      is_finalized: true,
      updated_at: new Date().toISOString()
    })
    .eq('agent_id', agentId)
    .eq('period_year', year)
    .eq('period_month', month);

  if (error) {
    toast('Failed to update rollup', 'error');
    return;
  }

  await supabase.from('withdrawal_request')
    .update({ status: 'released', updated_at: new Date().toISOString() })
    .eq('agent_id', agentId);

  toast('Commission Released!', 'success');
  await loadAndRender();
}

/* ===== Styles ===== */
function injectStyles() {
  if (injectStyles.done) return;
  injectStyles.done = true;
  const css = `
  .right{text-align:right;}
  td,th{color:#e2e8f0;padding:8px;}
  table{width:100%;border-collapse:collapse;}
  tr:nth-child(even){background:#0b1220;}
  tr:nth-child(odd){background:#111827;}
  th{background:#0f1724;color:#fff;}
  .agent-detail table th{background:#1e293b;}
  `;
  const tag = document.createElement('style');
  tag.textContent = css; document.head.appendChild(tag);
}

/* ===== PDF Export ===== */
function exportToPDF() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF || !window.jspdf?.autoTable) {
    toast('jsPDF + autotable not found', 'error'); return;
  }
  const doc = new jsPDF('landscape');
  const title = `Commission Summary — ${periodEl.textContent}`;
  doc.setFontSize(14); doc.text(title, 14, 18);

  const head = [['Agent', 'Monthly', 'Overrides', 'Outright', 'Recruiter', 'Status']];
  const body = [];
  tbody.querySelectorAll('.agent-row').forEach(tr => {
    const tds = Array.from(tr.children).map(td => td.innerText.trim());
    if (tds.length >= 6) body.push(tds.slice(0, 6));
  });

  doc.autoTable({
    head, body, startY: 26,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 23, 36] },
    margin: { left: 10, right: 10 }
  });

  const yAfter = (doc.lastAutoTable?.finalY || 26) + 6;
  doc.setFontSize(11);
  doc.text(`Total Collection (this month): ${tCollection.textContent}`, 10, yAfter);
  doc.save(`commissions_${new Date().toISOString().slice(0, 10)}.pdf`);
}
