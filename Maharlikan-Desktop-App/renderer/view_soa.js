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
    setText('height', member.height);
    setText('weight', member.weight);
    // Status set later via calculation
    // setText('status', member.civil_status || member.status);

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

    // Calculate Effective Start Date for Due Date
    const effectiveDate = getEffectiveStartDate(member.date_joined, collections);
    const day = effectiveDate.getDate();

    // Suffix for day (st, nd, rd, th)
    const suffix = (day) => {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1: return "st";
            case 2: return "nd";
            case 3: return "rd";
            default: return "th";
        }
    };

    setText('dateInception', formatDate(member.date_joined));
    setText('dueDate', `Every ${day}${suffix(day)} of the month`);

    // --- Grace Period Status Calculation ---
    // --- Grace Period Status Calculation ---
    // Pass member.date_joined to detect reinstatement vs normal
    const { status, color, daysGrace } = calculateGracePeriodStatus(effectiveDate, collections, monthlyDueRaw, totalPayableRaw, member.date_joined);

    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = status;
        statusEl.style.color = color;
        statusEl.style.fontWeight = 'bold';
    }

    // Display Grace Period
    const gracePeriodEl = document.getElementById('gracePeriod');
    if (gracePeriodEl) {
        gracePeriodEl.textContent = status === 'PENDING' ? 'PENDING' : (daysGrace > 0 ? `${daysGrace} Days` : '0 Days');
        // Optional: Color code it too?
        gracePeriodEl.style.color = color;
        gracePeriodEl.style.fontWeight = 'bold';
    }


    setText('salesExecutive', member.sales_executive || getAgentName(member.agent_id));

    // --- Beneficiaries ---
    // --- Beneficiaries ---
    renderBeneficiaries(beneficiaries);

    // --- Collections Table ---
    const agentName = member.sales_executive || getAgentName(member.agent_id);
    populateCollections(collections, totalPayableRaw, agentName, monthlyDueRaw, agentMap, member.date_joined);

    // --- Contestability Period ---
    // --- Contestability Period ---
    const contestabilityMonths = calculateContestability(member.date_joined, collections, status);
    const contestabilityText = (contestabilityMonths === -1)
        ? "PENDING"
        : (contestabilityMonths >= 12)
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
function calculateContestability(dateJoined, collections, status) {
    if (!dateJoined) return 0;

    // 🔥 NEW: If status is PENDING, contestability is also PENDING (return -1 as indicator)
    if (status === 'PENDING') return -1;

    if (status === 'Lapsed') return 0; // Reset to 0 if Lapsed

    // 1. Get Effective Start Date (handles reinstatement)
    const effectiveStartDate = getEffectiveStartDate(dateJoined, collections);

    // 3. Calculate Period from Effective Start to NOW
    const now = new Date();
    let currentMonths = (now.getFullYear() - effectiveStartDate.getFullYear()) * 12;
    currentMonths += now.getMonth() - effectiveStartDate.getMonth();

    // 4. Cap at 12
    if (currentMonths < 0) currentMonths = 0;
    if (currentMonths > 12) currentMonths = 12;

    return currentMonths;
}

function calculateGracePeriodStatus(effectiveStartDate, collections, monthlyDue, totalPayable, dateJoined) {
    // 1. Calculate Total Valid Payments.
    // Logic update: If NOT reinstated, count ALL valid payments (even before effectiveStartDate).
    // If Reinstated, count only payments >= effectiveStartDate.

    // Check if Reinstated (effectiveStartDate > dateJoined)
    // Note: effectiveStartDate is derived from dateJoined.
    // If no gap >= 3 months, effectiveStartDate == dateJoined.
    // Allow small tolerance or strict inequality.
    const effTime = effectiveStartDate.getTime();
    const joinTime = new Date(dateJoined).getTime();
    const isReinstated = effTime > joinTime;

    // Sort collections
    const sorted = [...(collections || [])].sort((a, b) => new Date(a.date_paid) - new Date(b.date_paid));

    let validPaymentSum = 0;
    let hasRegularPayment = false; // Track if any regular payment exists

    // Filter collections
    sorted.forEach(c => {
        const pDate = new Date(c.date_paid);
        let include = false;

        if (isReinstated) {
            // Strict filter for reinstatement
            if (pDate.getTime() >= effTime) include = true;
        } else {
            // Include ALL payments if not reinstated
            include = true;
        }

        if (include) {
            const payFor = (c.payment_for || '').toLowerCase();
            const isMembership = c.is_membership_fee === true || payFor.includes('membership');
            const isAdapted = payFor.includes('adapted');

            // Only count regular payments (not membership, not adapted)
            if (!isMembership && !isAdapted) {
                validPaymentSum += Number(c.payment || c.amount || 0);
                hasRegularPayment = true;
            }
        }
    });

    // 🔥 NEW: If no regular payments exist, status is PENDING
    if (!hasRegularPayment) {
        return {
            status: 'PENDING',
            color: '#6b7280', // Gray color
            daysGrace: 0
        };
    }

    // 2. Calculate Months Covered
    const mDue = Number(monthlyDue) || 0;
    let monthsCovered = 0;
    if (mDue > 0) {
        monthsCovered = validPaymentSum / mDue;
    }

    // 3. Calculate Paid Through Date
    const paidUntil = new Date(effectiveStartDate);
    const wholeMonths = Math.floor(monthsCovered);
    // Add whole months
    paidUntil.setMonth(paidUntil.getMonth() + wholeMonths);

    // 4. Next Due Date
    // Rule: Next Due is Paid Through + 1 Day.
    const nextDueDate = new Date(paidUntil);
    nextDueDate.setDate(nextDueDate.getDate() + 1);

    // 5. Grace Days (From Next Due Date)
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const ndd = new Date(nextDueDate);
    ndd.setHours(0, 0, 0, 0);

    let graceDays = 0;
    if (now.getTime() > ndd.getTime()) {
        const diffMs = now.getTime() - ndd.getTime();
        graceDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    // Determine Status
    let status = 'Active';
    let color = '#22c55e'; // Green

    // Balance Override
    const totalP = Number(totalPayable) || 0;
    const balance = Math.max(0, totalP - validPaymentSum); // approx

    if (balance <= 0 && totalP > 0) {
        status = 'Completed';
        color = '#22c55e';
    } else {
        if (graceDays <= 0) {
            status = 'Active';
            color = '#22c55e';
        } else if (graceDays >= 1 && graceDays <= 29) {
            status = 'Warning';
            color = '#eab308';
        } else if (graceDays >= 30 && graceDays <= 59) {
            status = 'Lapsable';
            color = '#f97316';
        } else {
            status = 'Lapsed';
            color = '#ef4444';
        }
    }

    return { status, color, daysGrace: Math.max(0, graceDays) };
}

function getEffectiveStartDate(dateJoined, collections) {
    if (!dateJoined) return new Date();

    // Filter valid payments
    const sorted = [...(collections || [])].sort((a, b) => new Date(a.date_paid) - new Date(b.date_paid));

    let effectiveStartDate = new Date(dateJoined);
    let lastActivityDate = new Date(dateJoined);

    sorted.forEach(col => {
        const paymentDate = new Date(col.date_paid);
        if (isNaN(paymentDate.getTime())) return;

        // Calculate Gap from PREVIOUS activity in MONTHS
        let monthsDiff = (paymentDate.getFullYear() - lastActivityDate.getFullYear()) * 12;
        monthsDiff += paymentDate.getMonth() - lastActivityDate.getMonth();

        if (monthsDiff >= 3) {
            // LAPSE DETECTED -> REINSTATEMENT
            effectiveStartDate = paymentDate;
        }

        lastActivityDate = paymentDate;
    });

    return effectiveStartDate;
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

    // Sort collections: Adapted first, then Membership, then by date
    const sortedCollections = [...collections].sort((a, b) => {
        const aPayFor = (a.payment_for || '').toLowerCase();
        const bPayFor = (b.payment_for || '').toLowerCase();

        const aIsAdapted = aPayFor.includes('adapted');
        const bIsAdapted = bPayFor.includes('adapted');
        const aIsMembership = aPayFor.includes('membership');
        const bIsMembership = bPayFor.includes('membership');

        // Adapted payments first
        if (aIsAdapted && !bIsAdapted) return -1;
        if (!aIsAdapted && bIsAdapted) return 1;

        // Then membership payments
        if (aIsMembership && !bIsMembership) return -1;
        if (!aIsMembership && bIsMembership) return 1;

        // Then by date (newest first for regular payments)
        return new Date(b.date_paid) - new Date(a.date_paid);
    });

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
        const isAdapted = payFor.includes('adapted');

        const installmentDisplay = isMem ? '-' : parseFloat(runningInstallment.toFixed(2));

        // Show "ADAPTED" for OR No if payment_for is 'adapted'
        let orNoDisplay = (col.or_no || col.or_number || '-');
        if (isAdapted) {
            // If payment_for has details (e.g., "adapted - 3 months"), show that
            if (payFor.length > 7) { // 'adapted'.length is 7
                orNoDisplay = payFor.toUpperCase();
            } else {
                orNoDisplay = 'ADAPTED';
            }
        }

        tr.innerHTML = `
      <td>${formatDate(col.date_paid)}</td>
      <td style="text-align: right;">
        ${reinstatedHtml}${formatMoney(payment)}
      </td>
      <td>${orNoDisplay}</td>
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
