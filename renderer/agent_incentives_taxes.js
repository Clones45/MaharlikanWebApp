// =======================================================
// agent_incentives_taxes.js
// Logic for displaying Agent Incentives and Taxes/Deductions
// =======================================================

/* ===== DOM Selectors ===== */
const qs = (id) => document.getElementById(id);
const SELECTORS = {
    monthSel: qs('monthSel'),
    yearSel: qs('yearSel'),
    agentSel: qs('agentSel'),
    applyBtn: qs('applyBtn'),
    printBtn: qs('printBtn'),
    periodLabel: qs('periodLabel'),

    // Summaries
    sumIncentives: qs('sumIncentives'),
    sumTax: qs('sumTax'),
    sumFees: qs('sumFees'),
    sumRice: qs('sumRice'),
    sumOffice: qs('sumOffice'),

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
    bdTotal: qs('bdTotal'),
    clReceivable: qs('clReceivable'),
    clNonReceivable: qs('clNonReceivable'),

    // TBodies
    tbodyIncentives: qs('tblIncentives').querySelector('tbody'),
    tbodyTaxes: qs('tblTaxes').querySelector('tbody'),
    tbodyRice: qs('tblRice').querySelector('tbody'),
    tbodyOffice: qs('tblOffice').querySelector('tbody'),
};

/* ===== Config & State ===== */
let supabase = null;
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

        const dummyStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };

        if (env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
            supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
                auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false, storage: dummyStorage }
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
}

/* ===== Date Logic ===== */
function getExampleCutoff(y, m) {
    // Using same logic as view_commissions.js (7th to 7th)
    const Y = num(y);
    const M = num(m);

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const start = new Date(Y, M - 1, 7);
    const end = new Date(Y, M, 7);

    return { gte: fmt(start), lt: fmt(end), start, end };
}

/* ===== Data Loading ===== */
async function loadAgents() {
    const { data, error } = await supabase.from('agents').select('id, firstname, lastname').order('lastname');
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

        // Update Label
        const { gte, lt, start, end } = getExampleCutoff(y, m);
        const nice = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const endDisplay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
        SELECTORS.periodLabel.textContent = `${nice(start)} – ${nice(endDisplay)}`;

        // Set Loading State
        SELECTORS.tbodyIncentives.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
        SELECTORS.tbodyTaxes.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
        SELECTORS.tbodyRice.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

        // --- 1. Fetch Incentives (Commissions) ---
        let qInc = supabase
            .from('commissions')
            .select(`
        created_at, date_earned, amount, commission_type, is_receivable, override_commission,
        agent:agents!commissions_agent_id_fkey(firstname, lastname)
      `)
            // Removed filter to fetch ALL types for Grand Total
            .gte('date_earned', gte)
            .lt('date_earned', lt)
            .order('date_earned', { ascending: false });

        if (agentId !== 'all') qInc = qInc.eq('agent_id', agentId);

        // --- 2. Fetch Taxes (Withdrawals) ---
        let qTax = supabase
            .from('withdrawal_requests')
            .select(`
        created_at, period_month, period_year, status,
        gross_amount, tax, fee, amount,
        agent:agents(firstname, lastname)
      `)
            .eq('status', 'approved')
            .eq('period_month', Number(m))
            .eq('period_year', Number(y));

        if (agentId !== 'all') qTax = qTax.eq('agent_id', agentId);

        // --- 3. Fetch Rice Incentives (New Memberships) ---
        // Rule: 1 Membership collected in period = 1kg Rice
        let qRice = supabase
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
        // Rule: Monthly Due Payment for plan A1, A2, B1, B2. 
        // Must be the *very first* monthly payment for that member.
        let qOffice = supabase
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


        const [resInc, resTax, resRice, resOffice] = await Promise.all([qInc, qTax, qRice, qOffice]);

        if (resInc.error) throw resInc.error;
        if (resTax.error) throw resTax.error;
        if (resRice.error) throw resRice.error;
        if (resOffice.error) throw resOffice.error;

        // Process Office Expense Candidates (Verify First Payment)
        const officeItems = await processOfficeExpenses(resOffice.data || [], gte);

        // Calculate Breakdown Rollup
        const rollup = calculateRollup(resInc.data || []);

        renderBreakdown(rollup);
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
    const { data: history, error } = await supabase
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
        SELECTORS.sumIncentives.textContent = peso(0);
        SELECTORS.cntIncentives.textContent = '0 items';
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

    SELECTORS.sumIncentives.textContent = peso(total);
    SELECTORS.cntIncentives.textContent = `${list.length} items`;
}

function renderTaxes(list) {
    const tbody = SELECTORS.tbodyTaxes;
    tbody.innerHTML = '';

    let totalTax = 0;
    let totalFee = 0;

    if (list.length === 0) {
        renderEmpty(tbody, 'No approved withdrawals for this period');
        SELECTORS.sumTax.textContent = peso(0);
        SELECTORS.sumFees.textContent = peso(0);
        SELECTORS.cntTaxes.textContent = '0 items';
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

    SELECTORS.sumTax.textContent = peso(totalTax);
    SELECTORS.sumFees.textContent = peso(totalFee);
    SELECTORS.cntTaxes.textContent = `${list.length} items`;
}

function renderRice(list) {
    const tbody = SELECTORS.tbodyRice;
    tbody.innerHTML = '';

    if (list.length === 0) {
        renderEmpty(tbody, 'No memberships collected in this period');
        SELECTORS.sumRice.textContent = '0 kg';
        SELECTORS.cntRice.textContent = '0 items';
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
    SELECTORS.sumRice.textContent = `${totalKilos} kg`;
    SELECTORS.cntRice.textContent = `${list.length} items`;
}

function renderOffice(list) {
    const tbody = SELECTORS.tbodyOffice;
    tbody.innerHTML = '';

    if (list.length === 0) {
        renderEmpty(tbody, 'No first-time monthly payments in period');
        SELECTORS.sumOffice.textContent = peso(0);
        SELECTORS.cntOffice.textContent = '0 items';
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

    SELECTORS.sumOffice.textContent = peso(totalVal);
    SELECTORS.cntOffice.textContent = `${list.length} items`;
}

/* ===== Breakdown Logic (Synced with view_commissions.js) ===== */
function calculateRollup(list) {
    const rollup = {
        monthly: 0,
        travel: 0,
        overrides: 0,
        recruiter: 0,
        outright: 0,
        receivable: 0,
        nonReceivable: 0,
        total: 0
    };

    list.forEach(row => {
        const type = String(row.commission_type || '');
        const amount = num(row.amount);
        const overrideAmount = num(row.override_commission);
        const isReceivable = (row.is_receivable === true);

        // RULE 5: OVERRIDES
        if (type === 'override') {
            const val = (overrideAmount !== 0) ? overrideAmount : amount;
            rollup.overrides += val;
            rollup.receivable += val; // Always Receivable
            rollup.total += val; // Add to Total!
            return;
        }

        // RULE 6: RECRUITER BONUS
        if (type === 'recruiter_bonus') {
            rollup.recruiter += amount;
            rollup.receivable += amount; // Always Receivable
            rollup.total += amount;
            return;
        }

        // RULE 3: MONTHLY COMMISSION
        if (type === 'plan_monthly') {
            rollup.monthly += amount;
            rollup.total += amount;
            if (isReceivable) rollup.receivable += amount;
            else rollup.nonReceivable += amount;
            return;
        }

        // RULE 4: TRAVEL ALLOWANCE
        if (type === 'travel_allowance') {
            rollup.travel += amount;
            rollup.total += amount;
            if (isReceivable) rollup.receivable += amount;
            else rollup.nonReceivable += amount;
            return;
        }

        // RULE 7: OUTRIGHT (Membership)
        if (type === 'membership_outright') {
            rollup.outright += amount;
            rollup.total += amount;
            if (isReceivable) rollup.receivable += amount;
            else rollup.nonReceivable += amount;
            return;
        }

        // Fallback
        if (isReceivable) rollup.receivable += amount;
        else rollup.nonReceivable += amount;
        rollup.total += amount;
    });

    return rollup;
}

function renderBreakdown(r) {
    SELECTORS.bdOutright.textContent = peso(r.outright);
    SELECTORS.bdMonthly.textContent = peso(r.monthly);
    SELECTORS.bdOverrides.textContent = peso(r.overrides);
    SELECTORS.bdTravel.textContent = peso(r.travel);
    SELECTORS.bdRecruiter.textContent = peso(r.recruiter);
    SELECTORS.bdTotal.textContent = peso(r.total);

    SELECTORS.clReceivable.textContent = peso(r.receivable);
    SELECTORS.clNonReceivable.textContent = peso(r.nonReceivable);

    // Also update the Grand Total Card to match this exact calculation
    SELECTORS.sumIncentives.textContent = peso(r.total);
}

window.addEventListener('load', boot);
