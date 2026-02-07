// manage_collections.js

const tbody = document.getElementById('tbody');
const monthSel = document.getElementById('monthSel');
const yearSel = document.getElementById('yearSel');
const loadBtn = document.getElementById('loadBtn');
const statusMsg = document.getElementById('statusMsg');

// Modal Elements
const editModal = document.getElementById('editModal');
const editIdInput = document.getElementById('editId');
const editMemberIdInput = document.getElementById('editMemberId');
const editORInput = document.getElementById('editOR');
const editAmountInput = document.getElementById('editAmount');
const editDateInput = document.getElementById('editDate');
const editReasonInput = document.getElementById('editReason');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const saveEditBtn = document.getElementById('saveEditBtn');

const SB = window.SB || (window.opener && window.opener.SB) || null; // Try to get SB from opener if null, or assume global if setup

// If SB is not directly available, we might need to re-init supabase.
// However, `view-collections.js` assumes `window.SB`. Let's assume preload/main injects it or we init it.
// Checking `view-collections.js`, it uses `window.SB`. 
// If this opens in a new window, we need to ensure `SB` is available.
// The `main.js` opens new windows with `preload.js`.
// `preload.js` exposes `electronAPI`. It does NOT expose `SB`.
// `view-collections.js` likely ran effectively because `renderer/supabase/supabase-js` or similar was included in `layout` or `index.html`.
// Wait, looking at `add_collection.js`, it imports/creates supabase client.
// Let's replicate the safe creation from `add_collection.js` to be sure.

let supabaseClient = null;

/* ---------- Toast ---------- */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, type = 'info') {
    toastEl.textContent = msg;
    toastEl.style.borderLeftColor = type === 'error' ? '#e74c3c' : type === 'success' ? '#2ecc71' : '#66fcf1';
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

/* ---------- Auth Logic ---------- */
const authOverlay = document.getElementById('authOverlay');
const authInput = document.getElementById('authInput');
const authError = document.getElementById('authError');

window.checkAuth = function () {
    const pwd = authInput.value;
    if (pwd === "Maharlikan_2026") {
        authOverlay.style.display = 'none';
        init(); // Start app only after auth
    } else {
        authError.textContent = "Incorrect password.";
        authInput.value = "";
        authInput.focus();
    }
}

authInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') checkAuth();
});

/* ---------- Init ---------- */
async function init() {
    console.log("Auth passed. Initializing...");
    await setupSupabase();
    setupDateSelectors();
    wireEvents();
}

async function setupSupabase() {
    // Try to get env
    let env = null;
    if (window.electronAPI?.getEnv) {
        try { env = await window.electronAPI.getEnv(); } catch { }
    }

    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
        statusMsg.textContent = "Error: Missing Supabase credentials.";
        return;
    }

    if (window.supabase && window.supabase.createClient) {
        supabaseClient = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
            auth: { persistSession: false }
        });
        console.log("Supabase initialized in Manager.");
    } else {
        statusMsg.textContent = "Error: supabase-js not found via window.supabase.";
    }
}

function setupDateSelectors() {
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
    for (let y = cy - 2; y <= cy + 2; y++) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        if (y === cy) opt.selected = true;
        yearSel.appendChild(opt);
    }
}

function wireEvents() {
    loadBtn.addEventListener('click', loadCollections);
    cancelEditBtn.addEventListener('click', () => editModal.classList.remove('show'));
    saveEditBtn.addEventListener('click', saveEdit);

    // Search Listener
    document.getElementById('searchInput').addEventListener('keyup', (e) => {
        const term = e.target.value.toLowerCase();
        if (!window._currentData) return;

        const filtered = window._currentData.filter(row => {
            return (
                (row.last_name || '').toLowerCase().includes(term) ||
                (row.first_name || '').toLowerCase().includes(term) ||
                (row.maf_no || '').toLowerCase().includes(term) ||
                (row.or_no || '').toLowerCase().includes(term)
            );
        });
        renderTable(filtered, true);
    });
}

/* ---------- Load Logic ---------- */
async function loadCollections() {
    if (!supabaseClient) return;

    statusMsg.textContent = "Loading...";
    tbody.innerHTML = '';

    const y = yearSel.value;
    const m = monthSel.value;

    // Same logic as view-collections.js 
    // 7th of selected month to 6th of NEXT month
    const [yNum, mNum] = [parseInt(y), parseInt(m)];

    // Start: 7th of Current Month
    const startObj = new Date(yNum, mNum - 1, 7);
    // End: 6th of Next Month
    const endObj = new Date(yNum, mNum, 6);

    const toISODate = (d) => {
        const year = d.getFullYear();
        const mon = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${mon}-${day}`;
    };

    const startDate = toISODate(startObj);
    const endDate = toISODate(endObj);

    console.log(`Loading range: ${startDate} to ${endDate}`);

    const { data, error } = await supabaseClient
        .from('collections')
        .select('*')
        .gte('date_paid', startDate)
        .lte('date_paid', endDate)
        .order('date_paid', { ascending: false });

    if (error) {
        console.error(error);
        statusMsg.textContent = "Error loading collections.";
        return;
    }

    window._currentData = data; // Store original data
    statusMsg.textContent = `Found ${data.length} records.`;
    renderTable(data);
}

function renderTable(data, isSearch = false) {
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">${isSearch ? 'No matches found.' : 'No records found.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(row => `
    <tr data-id="${row.id}">
      <td>${row.date_paid}</td>
      <td>${row.maf_no || ''}</td>
      <td>${row.last_name}, ${row.first_name}</td>
      <td>${row.or_no || ''}</td>
      <td class="right">₱${Number(row.payment).toFixed(2)}</td>
      <td>${row.payment_for || ''}</td>
      <td>
        <button class="edit" onclick="openEdit('${row.id}')">Edit</button>
        <button class="danger" onclick="confirmDelete('${row.id}')">Del</button>
      </td>
    </tr>
  `).join('');

    // Update count message if searching
    if (isSearch && window._currentData) {
        statusMsg.textContent = `Showing ${data.length} matches (from ${window._currentData.length} records).`;
    } else if (!isSearch) {
        statusMsg.textContent = `Found ${data.length} records.`;
    }

    // Update stash only if NOT searching (searching shouldn't overwrite base data, but loadCollections does)
    // Actually, loadCollections sets window._currentData. renderTable just renders.
    // So we don't need to stash here anymore if we do it in loadCollections.
}

/* ---------- Edit Logic ---------- */
window.openEdit = (id) => {
    const row = window._currentData.find(r => r.id === id);
    if (!row) return;

    editIdInput.value = row.id;
    editMemberIdInput.value = row.member_id; // Crucial for re-balancing
    editORInput.value = row.or_no || '';
    editAmountInput.value = row.payment;
    editDateInput.value = row.date_paid;
    editReasonInput.value = row.payment_for;

    editModal.classList.add('show');
};

async function saveEdit() {
    const id = editIdInput.value;
    const memberId = editMemberIdInput.value;
    const newOr = editORInput.value;
    const newAmt = parseFloat(editAmountInput.value);
    const newDate = editDateInput.value;
    const newReason = editReasonInput.value;

    if (!newAmt || newAmt <= 0) return alert("Invalid Amount");

    saveEditBtn.disabled = true;
    saveEditBtn.textContent = "Saving...";

    try {
        const { error } = await supabaseClient
            .from('collections')
            .update({
                or_no: newOr,
                payment: newAmt,
                date_paid: newDate,
                payment_for: newReason
                // Note: collection_month might ideally be updated if date changes drastically, 
                // but for now we trust the user or keep it simple.
            })
            .eq('id', id);

        if (error) throw error;

        toast("Updated successfully.", "success");
        editModal.classList.remove('show');

        // Recompute balance for member
        if (memberId) {
            await recomputeMemberBalance(memberId);
        }

        loadCollections(); // Refresh list

    } catch (e) {
        console.error(e);
        alert("Update failed: " + e.message);
    } finally {
        saveEditBtn.disabled = false;
        saveEditBtn.textContent = "Save Changes";
    }
}

/* ---------- Delete Logic ---------- */
window.confirmDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this collection? This will reverse the payment from the member's balance.")) return;

    const row = window._currentData.find(r => r.id === id);
    const memberId = row ? row.member_id : null;

    try {
        const { error } = await supabaseClient
            .from('collections')
            .delete()
            .eq('id', id);

        if (error) throw error;

        toast("Deleted successfully.", "success");

        if (memberId) {
            await recomputeMemberBalance(memberId);
        }

        loadCollections();
    } catch (e) {
        console.error(e);
        alert("Delete failed: " + e.message);
    }
};

/* ---------- Re-Balancing Logic (Copied/Adapted from add_collection.js) ---------- */
async function recomputeMemberBalance(memberId) {
    try {
        statusMsg.textContent = "Recomputing member balance...";

        // 1. Get all payments
        const { data: allCollections, error: colErr } = await supabaseClient
            .from('collections')
            .select('payment, payment_for')
            .eq('member_id', memberId);

        if (colErr) throw colErr;

        let totalPaid = 0;
        for (const c of allCollections || []) {
            const payFor = (c.payment_for || '').toLowerCase();
            if (!payFor || payFor.includes('membership') || payFor.includes('regular')) {
                totalPaid += Number(c.payment || 0);
            }
        }

        // 2. Get Member Contract details
        const { data: mem, error: memErr } = await supabaseClient
            .from('members')
            .select('contracted_price, balance')
            .eq('id', memberId)
            .single();

        if (memErr) throw memErr;

        // 3. Compute
        const contracted = Number(mem.contracted_price || 0);
        // If contracted is 0, we can't really compute balance accurately unless we assume previous balance was correct? 
        // Just use what logic add_collection uses:
        const basePrice = contracted > 0 ? contracted : (Number(mem.balance) + totalPaid);

        const newBalance = Math.max(0, basePrice - totalPaid);
        const safeBalance = Number(newBalance.toFixed(2));

        // 4. Update
        const { error: updErr } = await supabaseClient
            .from('members')
            .update({ balance: safeBalance })
            .eq('id', memberId);

        if (updErr) throw updErr;

        console.log(`Balance recomputed for ${memberId}: ${safeBalance}`);
        statusMsg.textContent = "Ready.";

    } catch (err) {
        console.error("Rebalance failed", err);
        statusMsg.textContent = "Warning: Balance update failed.";
    }
}

// Start
// document.addEventListener('DOMContentLoaded', init); 
// Init is now deferred until Auth passes.
authInput.focus();
