/* ==========================================
   VIEW SOA - Statement of Account Generator
   ========================================== */

let supabaseClient = null;
let currentMemberId = null;

/* ==========================================
   GLOBAL HELPERS
   ========================================== */

const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = (value === null || value === undefined || value === '') ? '-' : value;
};

const formatMoney = (value) => {
    if (value === null || value === undefined || value === '' || Number(value) === 0) return '-';
    return '₱' + Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 });
};

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/* ==========================================
   INITIALIZATION
   ========================================== */
window.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        console.log('[SOA] Initializing...');

        // Get environment variables
        let env = null;
        if (window.electronAPI?.getEnv) {
            try {
                env = await window.electronAPI.getEnv();
            } catch (e) {
                console.error('[SOA] Failed to get env from Electron:', e);
            }
        }

        if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
            env = window.__ENV__ || {};
        }

        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
            showError('Missing Supabase configuration');
            return;
        }

        // Initialize Supabase with dummy storage (no session persisted)
        const memoryStorage = (() => {
            let store = {};
            return {
                getItem: (key) => store[key] || null,
                setItem: (key, value) => { store[key] = value; },
                removeItem: (key) => { delete store[key]; },
                clear: () => { store = {}; }
            };
        })();

        supabaseClient = window.supabase.createClient(
            env.SUPABASE_URL,
            env.SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: true,
                    detectSessionInUrl: false,
                    storage: memoryStorage,
                },
            }
        );

        // Get member ID from URL params
        const params = new URLSearchParams(window.location.search);
        currentMemberId = params.get('member_id');

        if (!currentMemberId) {
            showError('No member ID provided. Please select a member first.');
            return;
        }

        // Load SOA data
        await loadSOA(currentMemberId);
    } catch (e) {
        console.error('[SOA] Init error:', e);
        showError('Failed to initialize: ' + e.message);
    }
}

/* ==========================================
   LOAD SOA DATA
   ========================================== */
async function loadSOA(memberId) {
    try {
        console.log('[SOA] Loading data for member:', memberId);

        // 1) Member - Lookup by MAF NO (passed in URL)
        const { data: member, error: memberError } = await supabaseClient
            .from('members')
            .select('*')
            .eq('maf_no', memberId)
            .single();

        if (memberError) throw memberError;
        if (!member) throw new Error('Member not found');

        const realMemberId = member.id;
        console.log('[SOA] Member found:', member.maf_no, 'ID:', realMemberId);

        // 2) Beneficiaries
        const { data: beneficiaries, error: benefError } = await supabaseClient
            .from('beneficiaries')
            .select('*')
            .eq('member_id', realMemberId);

        if (benefError) {
            console.warn('[SOA] Beneficiaries error:', benefError);
        }
        console.log('[SOA] Beneficiaries:', beneficiaries);

        // 3) Collections
        const { data: collections, error: collError } = await supabaseClient
            .from('collections')
            .select('*')
            .eq('member_id', realMemberId)
            .order('date_paid', { ascending: true });

        if (collError) {
            console.warn('[SOA] Collections error:', collError);
        }
        console.log('[SOA] Collections:', collections);

        // 4) Agents (for Sales Executive name)
        const { data: agents, error: agentError } = await supabaseClient
            .from('agents')
            .select('id, firstname, lastname');

        if (agentError) {
            console.warn('[SOA] Agents error:', agentError);
        }

        const agentMap = new Map();
        if (agents) {
            agents.forEach((a) => {
                agentMap.set(a.id, `${a.firstname || ''} ${a.lastname || ''}`.trim());
            });
        }

        // Populate the SOA
        populateSOA(member, beneficiaries || [], collections || [], agentMap);

        // Show content
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('soaContent').style.display = 'block';
    } catch (e) {
        console.error('[SOA] Load error:', e);
        showError('Failed to load SOA: ' + e.message);
    }
}

/* ==========================================
   POPULATE SOA FORM
   ========================================== */
function populateSOA(member, beneficiaries, collections, agentMap) {
    const getAgentName = (id) => {
        if (!id) return '-';
        if (agentMap && agentMap.has(id)) return agentMap.get(id);
        return `Agent #${id}`;
    };

    // --- Personal Information ---
    setText('afNumber', member.maf_no || member.af_number || member.af_no);
    const fullName = `${member.first_name || ''} ${member.middle_name || ''} ${member.last_name || ''}`.replace(/\s+/g, ' ').trim();
    setText('memberName', fullName || member.name);

    setText('address', member.address);
    setText('birthDate', formatDate(member.birth_date));
    setText('age', member.age);

    setText('birthPlace', member.birthplace || member.place_of_birth);
    setText('contactNo', member.phone_number || member.contact_no);
    setText('sex', member.gender || member.sex);

    setText('email', member.email);
    setText('height', member.height);
    setText('weight', member.weight);
    setText('status', member.civil_status || member.status);

    setText('religion', member.religion);
    setText('bloodType', member.blood_type);
    setText('occupation', member.occupation);

    // --- Plan Details ---
    setText('planType', member.plan_type || member.plan);
    setText('casketType', member.casket_type || member.casket);
    setText('packageValue', formatMoney(member.package_value || member.contracted_price));

    const totalPayableRaw =
        member.total_payable || member.package_value || member.contracted_price || 0;
    setText('totalPayable', formatMoney(totalPayableRaw));

    setText('mop', member.payment_frequency || member.mop || member.mode_of_payment || 'Monthly');

    const monthlyDueRaw = member.monthly_due || member.amount;
    setText('amount', formatMoney(monthlyDueRaw));

    setText('dateInception', formatDate(member.date_joined));
    setText('dueDate', member.due_date ? member.due_date : '-'); // due date is usually day-of-month only

    setText('salesExecutive', member.sales_executive || getAgentName(member.agent_id));

    // --- Beneficiaries ---
    // --- Beneficiaries ---
    renderBeneficiaries(beneficiaries);

    // --- Collections Table ---
    const agentName = member.sales_executive || getAgentName(member.agent_id);
    populateCollections(collections, totalPayableRaw, agentName, monthlyDueRaw, agentMap, member.date_joined);

    // --- Contestability Period ---
    const contestabilityMonths = calculateContestability(member.date_joined, collections);
    const contestabilityText = (contestabilityMonths >= 12)
        ? "12 Months (Max)"
        : `${contestabilityMonths} Month${contestabilityMonths === 1 ? '' : 's'}`;
    setText('contestability', contestabilityText);

    // --- Footer Signatures ---
    // User requested blank names for Manager and Collector
    // setText('footerAgent', agentName);
    // setText('footerCollector', agentName);
}

/* ==========================================
   CONTESTABILITY LOGIC
   ========================================== */
function calculateContestability(dateJoined, collections) {
    if (!dateJoined) return 0;

    // Filter valid payments (exclude voided if any, though not in schema here)
    // Sort collections by date
    const sorted = [...(collections || [])].sort((a, b) => new Date(a.date_paid) - new Date(b.date_paid));

    // 1. Initial Reference: Date Joined
    let effectiveStartDate = new Date(dateJoined);
    let lastActivityDate = new Date(dateJoined);

    // 2. Iterate Payments to check for Gaps (Lapses)
    sorted.forEach(col => {
        const paymentDate = new Date(col.date_paid);
        if (isNaN(paymentDate.getTime())) return;

        // Calculate Gap from PREVIOUS activity in MONTHS
        let monthsDiff = (paymentDate.getFullYear() - lastActivityDate.getFullYear()) * 12;
        monthsDiff += paymentDate.getMonth() - lastActivityDate.getMonth();

        // Also check if day is significantly earlier? User said "based on the month".
        // Let's refine: If I pay Jan 1, then April 1. Gap is 3 months (Feb, Mar, Apr).
        // If gap >= 3, Reset.

        if (monthsDiff >= 3) {
            // LAPSE DETECTED -> REINSTATEMENT
            effectiveStartDate = paymentDate;
        }

        lastActivityDate = paymentDate;
    });

    // 3. Calculate Period from Effective Start to NOW
    const now = new Date();
    let currentMonths = (now.getFullYear() - effectiveStartDate.getFullYear()) * 12;
    currentMonths += now.getMonth() - effectiveStartDate.getMonth();

    // If today is day 1 and start was day 30, maybe don't count full month?
    // User said "based on the month... stays on the system".
    // Simple month diff seems safest interpretation of "month based".

    // 4. Cap at 12
    if (currentMonths < 0) currentMonths = 0;
    if (currentMonths > 12) currentMonths = 12;

    return currentMonths;
}

function renderBeneficiaries(beneficiaries) {
    const container = document.getElementById('beneficiariesContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!beneficiaries || beneficiaries.length === 0) {
        container.innerHTML = `
            <tr><td colspan="4" style="text-align:center; color:#999;">No beneficiaries on record</td></tr>
        `;
        return;
    }

    beneficiaries.forEach((b, i) => {
        const name = `${b.first_name || ''} ${b.middle_name || ''} ${b.last_name || ''}`.replace(/\s+/g, ' ').trim();
        const row = document.createElement('tr');
        // Format birthdate
        const bdate = formatDate(b.birth_date);

        row.innerHTML = `
            <td>${i + 1}. ${name || '-'}</td>
            <td>${b.relation || '-'}</td>
            <td>${bdate}</td>
            <td>${b.address || '-'}</td>
        `;
        container.appendChild(row);
    });
}

/* ==========================================
   POPULATE COLLECTIONS TABLE
   ========================================== */
function populateCollections(collections, totalAmount, defaultCollector, monthlyDue, agentMap, dateJoined) {
    const tbody = document.getElementById('collectionsTableBody');
    tbody.innerHTML = '';

    if (!collections || collections.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="6" style="text-align: center; color: #999;">No collections found</td></tr>';
        return;
    }

    let runningBalance = Number(totalAmount) || 0;
    let runningInstallment = 0;
    const monthlyDueVal = Number(monthlyDue) || 0;

    // Track the last payment (or joining) date
    let lastDate = new Date(dateJoined || new Date());

    // Sort: Membership first, then by Date ascending
    collections.sort((a, b) => {
        const isMemA = (a.payment_for || '').toLowerCase().includes('membership') || a.is_membership_fee;
        const isMemB = (b.payment_for || '').toLowerCase().includes('membership') || b.is_membership_fee;

        if (isMemA && !isMemB) return -1;
        if (!isMemA && isMemB) return 1;

        // Secondary sort by date
        const dateA = new Date(a.date_paid || a.created_at || 0);
        const dateB = new Date(b.date_paid || b.created_at || 0);
        return dateA - dateB;
    });

    collections.forEach((col) => {
        const payment = Number(col.payment || col.amount || 0);
        let monthsPaid = 0;

        // --- Check reinstatement (gap >= 3 months) ---
        const paymentDate = new Date(col.date_paid);
        let isReinstated = false;

        if (!isNaN(lastDate.getTime()) && !isNaN(paymentDate.getTime())) {
            // Approx diff in months
            let monthsDiff = (paymentDate.getFullYear() - lastDate.getFullYear()) * 12;
            monthsDiff -= lastDate.getMonth();
            monthsDiff += paymentDate.getMonth();

            // If gap is >= 3 months, mark reinstated
            if (monthsDiff >= 3) {
                isReinstated = true;
            }
        }

        // Update last date for next iteration
        lastDate = paymentDate;
        // ---------------------------------------------

        if (!isNaN(payment)) {
            const payFor = (col.payment_for || '').toLowerCase();
            const isMembership = payFor.includes('membership');

            // Only deduct from balance / add to installment if NOT membership
            if (!isMembership) {
                runningBalance -= payment;
                if (monthlyDueVal > 0) {
                    monthsPaid = payment / monthlyDueVal;
                    runningInstallment += monthsPaid;
                }
            }
        }

        const tr = document.createElement('tr');
        const collectorName = (col.collector_id && agentMap)
            ? agentMap.get(col.collector_id)
            : (defaultCollector || '-');

        // Render Reinstated Note if needed
        // Render Reinstated Note if needed
        const reinstatedHtml = isReinstated
            ? '<span style="color:#059669; font-weight:bold; font-size:11px; margin-right: 5px;">Reinstated</span>'
            : '';

        // Check if membership again for display logic
        const payFor = (col.payment_for || '').toLowerCase();
        const isMem = payFor.includes('membership');

        const installmentDisplay = isMem ? '-' : parseFloat(runningInstallment.toFixed(2));

        tr.innerHTML = `
      <td>${formatDate(col.date_paid)}</td>
      <td style="text-align: right;">
        ${reinstatedHtml}${formatMoney(payment)}
      </td>
      <td>${col.or_no || col.or_number || '-'}</td>
      <td style="text-align: center;">${installmentDisplay}</td>
      <td style="text-align: right;">${formatMoney(Math.max(0, runningBalance))}</td>
      <td>${collectorName}</td>
    `;
        tbody.appendChild(tr);
    });
}

/* ==========================================
   ERROR HANDLING
   ========================================== */
function showError(message) {
    const loading = document.getElementById('loadingState');
    if (loading) {
        loading.innerHTML = `
      <div style="color: #dc2626; font-size: 16px;">
        <strong>Error:</strong> ${message}
        <br><br>
        <button class="btn btn-secondary" onclick="window.location.href='index.html'">← Back to Menu</button>
      </div>
    `;
    }
}

/* ==========================================
   EXPORT TO PDF
   ========================================== */
function exportToPDF() {
    // Using browser print as PDF (A4 Landscape is already set in @page CSS)
    alert('To export this SOA, choose "Print" then select "Save as PDF" with Landscape orientation.');
    window.print();
}
