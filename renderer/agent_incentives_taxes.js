// =======================================================
// agent_incentives_taxes.js
// Logic for displaying Agent Incentives and Taxes/Deductions
// SOURCE OF TRUTH: Pure Date-Range Aggregation (Ledger Roll-up)
// Any future changes to reporting logic must preserve date-range aggregation as the single source of truth.
// =======================================================

/* ===== DOM Selectors ===== */
const qs = (id) => document.getElementById(id);
const SELECTORS = {
    monthSel: qs('monthSel'),
    yearSel: qs('yearSel'),
    agentSel: qs('agentSel'),
    freqSel: qs('freqSel'),
    applyBtn: qs('applyBtn'),
    printBtn: qs('printBtn'),
    periodLabel: qs('periodLabel'),

    // Summaries
    sumCollections: qs('sumCollections'),
    sumTax: qs('sumTax'),
    sumFees: qs('sumFees'),
    sumRice: qs('sumRice'),
    sumOffice: qs('sumOffice'),
    sumIncentivesSub: qs('sumIncentivesSub'),
    sumCommissionTotal: qs('sumCommissionTotal'),

    // Counters
    cntIncentives: qs('cntIncentives'),
    cntTaxes: qs('cntTaxes'),
    cntRice: qs('cntRice'),
    cntOffice: qs('cntOffice'),

    // Breakdown Selectors
    bdOutright: qs('bdOutright'),
    bdMonthly: qs('bdMonthly'),
    bdOverrides: qs('bdOverrides'),
    bdTravel: qs('bdTravel'),
    bdRecruiter: qs('bdRecruiter'),
    bdNonForfeited: qs('bdNonForfeited'),
    bdForfeited: qs('bdForfeited'),

    // TBodies
    tbodyIncentives: qs('tblIncentives').querySelector('tbody'),
    tbodyTaxes: qs('tblTaxes').querySelector('tbody'),
    tbodyRice: qs('tblRice').querySelector('tbody'),
    tbodyOffice: qs('tblOffice').querySelector('tbody'),
};

/* ===== Config & State ===== */
let supabaseClient = null;
const PESO = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

/* ===== Utils ===== */
const num = (v) => Number(v || 0);
const peso = (n) => PESO.format(num(n));
const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

function renderEmpty(tbody, msg, colSpan = 5) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; color:#94a3b8; padding:20px">${esc(msg || 'No data')}</td></tr>`;
}

/* ===== Toast Notification ===== */
const toastEl = qs('toast');
function toast(msg, type = 'info') {
    toastEl.textContent = msg || '';
    toastEl.style.border = '1px solid ' + (type === 'error' ? '#d33' : type === 'success' ? '#2d6' : '#2c3548');
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 3000);
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

        const memoryStorage = (() => {
            let store = {};
            return {
                getItem: (key) => store[key] || null,
                setItem: (key, value) => { store[key] = value; },
                removeItem: (key) => { delete store[key]; },
                clear: () => { store = {}; }
            };
        })();

        if (env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
            supabaseClient = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
                auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false, storage: memoryStorage }
            });
        } else {
            console.error('Supabase not configured');
            return;
        }

        setupSelectors();

        // Load Agents for Filter
        await loadAgents();

        // Initial Load
        await loadAndRender();

        wireEvents();

    } catch (e) {
        console.error('BOOT ERROR:', e);
        toast('Failed to initialize: ' + e.message, 'error');
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
    for (let y = cy - 2; y <= cy + 1; y++) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        if (y === cy) opt.selected = true;
        SELECTORS.yearSel.appendChild(opt);
    }
}

function wireEvents() {
    SELECTORS.applyBtn.addEventListener('click', loadAndRender);
    SELECTORS.printBtn.addEventListener('click', () => window.print());
    SELECTORS.monthSel.addEventListener('change', loadAndRender);
    SELECTORS.yearSel.addEventListener('change', loadAndRender);
    SELECTORS.agentSel.addEventListener('change', loadAndRender);
    SELECTORS.freqSel.addEventListener('change', loadAndRender);
}

/* ===== Date Logic ===== */
function getAggregationPeriod(y, m, accumulationMonths = 1) {
    // Always starts from the 7th of the selected month
    const start = new Date(num(y), num(m) - 1, 7);
    // End is Start + N months
    const end = new Date(num(y), num(m) - 1 + num(accumulationMonths), 7);

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { gte: fmt(start), lt: fmt(end), start, end };
}

/* ===== Data Loading ===== */
async function loadAgents() {
    const { data, error } = await supabaseClient.from('agents').select('id, firstname, lastname').order('lastname');
    if (!error && data) {
        data.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.lastname}, ${a.firstname}`;
            SELECTORS.agentSel.appendChild(opt);
        });
    }
}

async function loadAndRender() {
    try {
        const y = SELECTORS.yearSel.value;
        const m = SELECTORS.monthSel.value;
        const agentId = SELECTORS.agentSel.value;
        const accMonths = SELECTORS.freqSel.value;

        // Update Label
        const { gte, lt, start, end } = getAggregationPeriod(y, m, accMonths);
        const nice = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const endDisplay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
        SELECTORS.periodLabel.textContent = `${nice(start)} – ${nice(endDisplay)}`;

        // Set Loading State
        SELECTORS.tbodyIncentives.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
        SELECTORS.tbodyTaxes.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
        SELECTORS.tbodyRice.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

        // --- 1. Fetch Incentives (Commissions) ---
        let qInc = supabaseClient
            .from('commissions')
            .select(`
        created_at, date_earned, amount, commission_type, is_receivable, override_commission, status, agent_id,
        agent:agents!commissions_agent_id_fkey(firstname, lastname)
      `)
            .gte('date_earned', gte)
            .lt('date_earned', lt)
            .order('date_earned', { ascending: false });

        if (agentId !== 'all') qInc = qInc.eq('agent_id', agentId);

        // --- 2. Fetch Taxes (Withdrawals) ---
        // Sum everything requested within the gte-lt window
        let qTax = supabaseClient
            .from('withdrawal_requests')
            .select(`
        created_at, period_month, period_year, status,
        gross_amount, tax, fee, amount,
        agent:agents(firstname, lastname)
      `)
            .eq('status', 'approved')
            .gte('created_at', gte)
            .lt('created_at', lt);

        if (agentId !== 'all') qTax = qTax.eq('agent_id', agentId);

        // --- 3. Fetch Rice Incentives (New Memberships) ---
        let qRice = supabaseClient
            .from('collections')
            .select(`
                date_paid, or_no, payment, is_membership_fee, agent_id, member_id,
                first_name, last_name,
                agent:agents!collections_agent_id_fkey(firstname, lastname)
            `)
            .eq('is_membership_fee', true)
            .gte('date_paid', gte)
            .lt('date_paid', lt)
            .order('date_paid', { ascending: false });

        if (agentId !== 'all') qRice = qRice.eq('agent_id', agentId);

        // --- 4. Fetch Office Allocated Expense (First Monthly Payment) ---
        let qOffice = supabaseClient
            .from('collections')
            .select(`
                date_paid, payment, is_membership_fee, plan_type, member_id, 
                first_name, last_name,
                agent:agents!collections_agent_id_fkey(firstname, lastname)
            `)
            .eq('is_membership_fee', false)
            .in('plan_type', ['PACKAGE A1', 'PACKAGE A2', 'PACKAGE B1', 'PACKAGE B2'])
            .gte('date_paid', gte)
            .lt('date_paid', lt);

        if (agentId !== 'all') qOffice = qOffice.eq('agent_id', agentId);

        // --- 5. Fetch Total Collections for Period ---
        let qColTotal = supabaseClient
            .from('collections')
            .select('payment, agent_id, member_id, is_membership_fee, payment_for, first_name, last_name');

        qColTotal = qColTotal.gte('date_paid', gte).lt('date_paid', lt);
        if (agentId !== 'all') qColTotal = qColTotal.eq('agent_id', agentId);

        const [resInc, resTax, resRice, resOffice, resColTotal] = await Promise.all([
            qInc, qTax, qRice, qOffice, qColTotal
        ]);

        if (resInc.error) throw resInc.error;
        if (resTax.error) throw resTax.error;
        if (resRice.error) throw resRice.error;
        if (resOffice.error) throw resOffice.error;
        if (resColTotal.error) throw resColTotal.error;

        // Process Office Expense Candidates
        const officeItems = await processOfficeExpenses(resOffice.data || [], gte);

        // Calculate Collection Total
        const totalCollections = (resColTotal.data || []).reduce((sum, c) => sum + num(c.payment), 0);
        if (SELECTORS.sumCollections) SELECTORS.sumCollections.textContent = peso(totalCollections);

        // Compute Eligibility for Forfeiture Logic (3+ members or Mixed)
        const eligibilityMap = computeAgentEligibility(resColTotal.data || []);

        // Calculate Breakdown Rollup
        const isCutoffPassed = new Date() >= new Date(lt);
        const rollup = calculateRollup(resInc.data || [], isCutoffPassed, eligibilityMap);

        // Combined Incentives (Recruiter + Office)
        const officeVal = officeItems.length * 50.00;
        const totalIncentives = num(rollup.recruiter) + officeVal;
        if (SELECTORS.sumIncentivesSub) SELECTORS.sumIncentivesSub.textContent = peso(totalIncentives);

        // Commission Only
        const commissionOnlyTotal = num(rollup.monthly) + num(rollup.travel) + num(rollup.overrides) + num(rollup.outright);
        if (SELECTORS.sumCommissionTotal) SELECTORS.sumCommissionTotal.textContent = peso(commissionOnlyTotal);

        renderBreakdown(rollup, isCutoffPassed);
        renderIncentives(resInc.data || []);
        renderTaxes(resTax.data || []);
        renderRice(resRice.data || []);
        renderOffice(officeItems);

    } catch (e) {
        console.error('Load Error:', e);
        toast(e.message, 'error');
        SELECTORS.tbodyIncentives.innerHTML = '<tr><td colspan="4">Error loading data</td></tr>';
        SELECTORS.tbodyTaxes.innerHTML = '<tr><td colspan="5">Error loading data</td></tr>';
        SELECTORS.tbodyRice.innerHTML = '<tr><td colspan="5">Error loading data</td></tr>';
        SELECTORS.tbodyOffice.innerHTML = '<tr><td colspan="5">Error loading data</td></tr>';
    }
}

async function processOfficeExpenses(candidates, periodStart) {
    if (!candidates.length) return [];

    // We need to check if these members have any PRIOR monthly payments before periodStart.
    const memberIds = [...new Set(candidates.map(c => c.member_id))];

    // Bulk check history
    const { data: history, error } = await supabaseClient
        .from('collections')
        .select('member_id')
        .in('member_id', memberIds)
        .eq('is_membership_fee', false) // Only count Monthly Dues as history
        .lt('date_paid', periodStart); // Strictly before this month

    if (error) {
        console.error('History check failed', error);
        return [];
    }

    const hasHistorySet = new Set((history || []).map(h => h.member_id));

    // Filter: Keep only those who have NO history
    // Also, if a member paid multiple times IN this month, only the EARLIEST one counts.
    // So we group by member, find earliest date, keeping it if no history.

    const validMap = new Map();

    candidates.forEach(c => {
        if (hasHistorySet.has(c.member_id)) return; // Already paid before

        // If multiple payments in same month, keep earliest
        if (!validMap.has(c.member_id)) {
            validMap.set(c.member_id, c);
        } else {
            const existing = validMap.get(c.member_id);
            if (new Date(c.date_paid) < new Date(existing.date_paid)) {
                validMap.set(c.member_id, c);
            }
        }
    });

    return Array.from(validMap.values());
}

function renderIncentives(list) {
    const tbody = SELECTORS.tbodyIncentives;
    tbody.innerHTML = '';

    let total = 0;

    if (list.length === 0) {
        renderEmpty(tbody, 'No incentives found for this period');
        if (SELECTORS.sumIncentivesSub) SELECTORS.sumIncentivesSub.textContent = peso(0);
        if (SELECTORS.cntIncentives) SELECTORS.cntIncentives.textContent = '0 items';
        return;
    }

    list.forEach(row => {
        total += num(row.amount);
        const tr = document.createElement('tr');

        // Type Formatting
        let typeDisplay = row.commission_type;
        if (typeDisplay === 'travel_allowance') typeDisplay = 'Travel Allowance';
        if (typeDisplay === 'override') typeDisplay = 'Override Commission';
        if (typeDisplay === 'recruiter_bonus') typeDisplay = 'Recruiter Bonus';
        if (typeDisplay === 'plan_monthly') typeDisplay = 'Monthly Commission';
        if (typeDisplay === 'membership_outright') typeDisplay = 'Membership Outright';

        const agentName = row.agent ? `${row.agent.lastname}, ${row.agent.firstname}` : 'Unknown';

        tr.innerHTML = `
      <td>${new Date(row.date_earned).toLocaleDateString()}</td>
      <td style="color:#60a5fa">${esc(agentName)}</td>
      <td>
        <span style="background:#ffffff10; padding:2px 8px; border-radius:4px; font-size:11px; border:1px solid #ffffff10">
          ${esc(typeDisplay)}
        </span>
      </td>
      <td class="right" style="color:#4ade80; font-weight:600">${peso(row.amount)}</td>
    `;
        tbody.appendChild(tr);
    });

    if (SELECTORS.sumCommissionTotal) SELECTORS.sumCommissionTotal.textContent = peso(total);
    if (SELECTORS.cntIncentives) SELECTORS.cntIncentives.textContent = `${list.length} items`;
}

function renderTaxes(list) {
    const tbody = SELECTORS.tbodyTaxes;
    tbody.innerHTML = '';

    let totalTax = 0;
    let totalFee = 0;

    if (list.length === 0) {
        renderEmpty(tbody, 'No approved withdrawals for this period');
        if (SELECTORS.sumTax) SELECTORS.sumTax.textContent = peso(0);
        if (SELECTORS.sumFees) SELECTORS.sumFees.textContent = peso(0);
        if (SELECTORS.cntTaxes) SELECTORS.cntTaxes.textContent = '0 items';
        return;
    }

    list.forEach(row => {
        totalTax += num(row.tax);
        totalFee += num(row.fee);

        const tr = document.createElement('tr');
        const agentName = row.agent ? `${row.agent.lastname}, ${row.agent.firstname}` : 'Unknown';

        tr.innerHTML = `
      <td>${new Date(row.created_at).toLocaleDateString()}</td>
      <td style="color:#60a5fa">${esc(agentName)}</td>
      <td class="right" style="opacity:0.7">${peso(row.gross_amount)}</td>
      <td class="right" style="color:#fbbf24; font-weight:600">${peso(row.tax)}</td>
      <td class="right" style="color:#a855f7">${peso(row.fee)}</td>
    `;
        tbody.appendChild(tr);
    });

    if (SELECTORS.sumTax) SELECTORS.sumTax.textContent = peso(totalTax);
    if (SELECTORS.sumFees) SELECTORS.sumFees.textContent = peso(totalFee);
    if (SELECTORS.cntTaxes) SELECTORS.cntTaxes.textContent = `${list.length} items`;
}

function renderRice(list) {
    const tbody = SELECTORS.tbodyRice;
    tbody.innerHTML = '';

    if (list.length === 0) {
        renderEmpty(tbody, 'No memberships collected in this period');
        if (SELECTORS.sumRice) SELECTORS.sumRice.textContent = '0 kg';
        if (SELECTORS.cntRice) SELECTORS.cntRice.textContent = '0 items';
        return;
    }

    list.forEach(row => {
        const tr = document.createElement('tr');
        const agentName = row.agent ? `${row.agent.lastname}, ${row.agent.firstname}` : 'Unknown';
        const memberName = `${row.last_name}, ${row.first_name}`;

        tr.innerHTML = `
        <td>${new Date(row.date_paid).toLocaleDateString()}</td>
        <td style="color:#60a5fa">${esc(agentName)}</td>
        <td>${esc(memberName)}</td>
        <td style="color:#94a3b8">${esc(row.or_no)}</td>
        <td class="right" style="color:#f472b6; font-weight:600">1 kg</td>
      `;
        tbody.appendChild(tr);
    });

    const totalKilos = list.length; // 1 member = 1 kg
    if (SELECTORS.sumRice) SELECTORS.sumRice.textContent = `${totalKilos} kg`;
    if (SELECTORS.cntRice) SELECTORS.cntRice.textContent = `${list.length} items`;
}

function renderOffice(list) {
    const tbody = SELECTORS.tbodyOffice;
    tbody.innerHTML = '';

    if (list.length === 0) {
        renderEmpty(tbody, 'No first-time monthly payments in period');
        if (SELECTORS.sumOffice) SELECTORS.sumOffice.textContent = peso(0);
        if (SELECTORS.cntOffice) SELECTORS.cntOffice.textContent = '0 items';
        return;
    }

    let totalVal = 0;
    const ALLOCATION = 50.00;

    list.forEach(row => {
        totalVal += ALLOCATION;
        const tr = document.createElement('tr');
        const agentName = row.agent ? `${row.agent.lastname}, ${row.agent.firstname}` : 'Unknown';
        const memberName = `${row.last_name}, ${row.first_name}`;

        tr.innerHTML = `
        <td>${new Date(row.date_paid).toLocaleDateString()}</td>
        <td>${esc(memberName)}</td>
        <td><span style="font-size:11px; opacity:0.8">${esc(row.plan_type)}</span></td> 
        <td style="color:#60a5fa">${esc(agentName)}</td>
        <td class="right" style="color:#60a5fa; font-weight:600">${peso(ALLOCATION)}</td>
      `;
        tbody.appendChild(tr);
    });

    if (SELECTORS.sumOffice) SELECTORS.sumOffice.textContent = peso(totalVal);
    if (SELECTORS.cntOffice) SELECTORS.cntOffice.textContent = `${list.length} items`;
}

/* ===== Breakdown Logic (Synced with view_commissions.js) ===== */
function computeAgentEligibility(collections) {
    const byAgent = {};
    collections.forEach(c => {
        if (!byAgent[c.agent_id]) byAgent[c.agent_id] = [];
        byAgent[c.agent_id].push(c);
    });

    const eligibleAgents = new Set();

    Object.entries(byAgent).forEach(([agentId, list]) => {
        // Rule A: 3+ Memberships
        const memCount = list.filter(c => c.is_membership_fee === true).length;
        const ruleA = memCount >= 3;

        // Rule B: Mixed Member (Group by NAME)
        const byMemberName = {};
        list.forEach(c => {
            const key = (c.last_name && c.first_name)
                ? `${c.last_name.trim().toUpperCase()}|${c.first_name.trim().toUpperCase()}`
                : `ID:${c.member_id}`;
            if (!byMemberName[key]) byMemberName[key] = [];
            byMemberName[key].push(c);
        });

        let ruleB = false;
        for (const payments of Object.values(byMemberName)) {
            const hasMem = payments.some(p => p.is_membership_fee === true);
            const hasReg = payments.some(p => p.is_membership_fee === false && p.payment_for === 'regular');
            if (hasMem && hasReg) { ruleB = true; break; }
        }

        if (ruleA || ruleB) {
            eligibleAgents.add(Number(agentId));
        }
    });

    return eligibleAgents;
}

function calculateRollup(list, isCutoffPassed, eligibilityMap) {
    const rollup = {
        monthly: 0,
        travel: 0,
        overrides: 0,
        recruiter: 0,
        outright: 0,
        forfeited: 0,
        nonForfeited: 0,
        total: 0
    };

    list.forEach(row => {
        const type = String(row.commission_type || '');
        const amount = num(row.amount);
        const overrideAmount = num(row.override_commission);
        const isReceivable = (row.is_receivable === true);
        const agentId = Number(row.agent_id);

        // VAL: Use override if present
        let val = amount;
        if (type === 'override') {
            val = (overrideAmount !== 0) ? overrideAmount : amount;
        }

        // 1. Classification by Type (Category)
        if (type === 'override') rollup.overrides += val;
        else if (type === 'recruiter_bonus') rollup.recruiter += val;
        else if (type === 'plan_monthly') rollup.monthly += val;
        else if (type === 'travel_allowance') rollup.travel += val;
        else if (type === 'membership_outright') rollup.outright += val;

        rollup.total += val;

        // 2. Classification by Status (Forfeited vs Non-forfeited)
        // FORFEITED: Commissions where is_receivable = TRUE but Agent is PENDING (Ineligible)
        // NON-FORFEITED: Eligible Agents OR (is_receivable=FALSE & not forfeited yet?) -- Wait.
        // User Spec: "forfieted is the agents who is still pending... amount should be the Receivable"

        // If commission is NOT receivable (e.g. failed AGR for other reasons?), it's not part of this forfeiture logic.
        // BUT: User said "amount should be the Receivable".

        if (isReceivable) {
            const isEligible = eligibilityMap.has(agentId);

            if (!isEligible) {
                // Pending Agent -> Forfeited
                rollup.forfeited += val;
            } else {
                // Eligible Agent -> Non-Forfeited
                rollup.nonForfeited += val;
            }
        } else {
            // Not Receivable (e.g. invalid?) -> Should not count as forfeited based on user logic "amount should be Receivable"
            // So we ignore it or add to nonForfeited?
            // Since it's not receivable, it's not part of the "pay out" pool anyway.
            // We'll leave it out of both or add to nonForfeited distinct bucket if needed.
            // For now, let's just NOT add to forfeited.
        }
    });

    return rollup;
}

function renderBreakdown(r, isCutoffPassed) {
    const commissionOnlyTotal = num(r.monthly) + num(r.travel) + num(r.overrides) + num(r.outright);

    SELECTORS.bdOutright.textContent = peso(r.outright);
    SELECTORS.bdMonthly.textContent = peso(r.monthly);
    SELECTORS.bdOverrides.textContent = peso(r.overrides);
    SELECTORS.bdTravel.textContent = peso(r.travel);
    SELECTORS.bdRecruiter.textContent = peso(r.recruiter);

    SELECTORS.bdNonForfeited.textContent = peso(r.nonForfeited);
    SELECTORS.bdForfeited.textContent = peso(r.forfeited);

    // Update the Summary Card for Commission (Total of all non-forfeited + forfeited)
    SELECTORS.sumCommissionTotal.textContent = peso(r.total);
}

window.addEventListener('load', boot);
