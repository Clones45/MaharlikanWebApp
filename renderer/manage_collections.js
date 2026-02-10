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

if (authInput) {
    authInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') checkAuth();
    });
}

const togglePassword = document.getElementById('togglePassword');
if (togglePassword && authInput) {
    togglePassword.addEventListener('click', () => {
        const type = authInput.getAttribute('type') === 'password' ? 'text' : 'password';
        authInput.setAttribute('type', type);

        // Toggle Icon
        if (type === 'text') {
            // Show Eye Slash (Hide)
            togglePassword.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                    <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                    <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                </svg>
            `;
        } else {
            // Show Eye (Show)
            togglePassword.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
                    <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
                </svg>
            `;
        }
    });
}

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

    // Global Search Listener with Debounce
    let searchTimer;
    document.getElementById('searchInput').addEventListener('keyup', (e) => {
        const term = e.target.value.trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => performSearch(term), 400);
    });
}



// Ensure search input exists before trying to access it
const searchInput = document.getElementById('searchInput');

function setSearchLoading(isLoading) {
    if (!searchInput) return;

    if (isLoading) {
        searchInput.disabled = true;
        searchInput.style.cursor = 'wait';
        searchInput.dataset.originalPlaceholder = searchInput.placeholder;
        searchInput.placeholder = 'Processing... please wait';
        searchInput.style.opacity = '0.6';
    } else {
        searchInput.disabled = false;
        searchInput.style.cursor = 'text';
        searchInput.placeholder = searchInput.dataset.originalPlaceholder || 'Search Name, AF No, or OR No...';
        searchInput.style.opacity = '1';
        searchInput.focus();
    }
}

// Global Search Function
async function performSearch(term) {
    if (!term) {
        // Restore original loaded data
        if (window._loadedMonthData) {
            window._displayedData = window._loadedMonthData;
            renderTable(window._loadedMonthData);
            statusMsg.textContent = `Found ${window._loadedMonthData.length} records.`;
        } else {
            window._displayedData = [];
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #777;">Select a period and click Load.</td></tr>';
            statusMsg.textContent = '';
        }
        return;
    }

    // Perform Global Search
    statusMsg.textContent = "Searching database...";
    // setSearchLoading(true); // Can optionally lock during search too, but per user request specifically for "updates".

    try {
        // Construct the OR filter - exact match for OR/AF, partial for names
        const filter = `last_name.ilike.%${term}%,first_name.ilike.%${term}%,maf_no.ilike.%${term}%,or_no.ilike.%${term}%`;

        const { data, error } = await supabaseClient
            .from('collections')
            .select('*')
            .or(filter)
            .order('date_paid', { ascending: false })
            .limit(50); // Limit results for performance

        if (error) throw error;

        window._displayedData = data;
        statusMsg.textContent = `Search found ${data.length} matches (Global).`;
        renderTable(data, true);

    } catch (err) {
        console.error("Search error:", err);
        statusMsg.textContent = "Error searching database.";
    }
    // finally { setSearchLoading(false); }
}

/* ---------- Load Logic ---------- */
async function loadCollections() {
    if (!supabaseClient) return;

    statusMsg.textContent = "Loading...";
    tbody.innerHTML = '';
    // setSearchLoading(true);

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

    try {
        const { data, error } = await supabaseClient
            .from('collections')
            .select('*')
            .gte('date_paid', startDate)
            .lte('date_paid', endDate)
            .order('date_paid', { ascending: false });

        if (error) throw error;

        window._loadedMonthData = data; // Store original month data
        window._displayedData = data;   // Store currently displayed data
        statusMsg.textContent = `Found ${data.length} records.`;
        renderTable(data);

    } catch (error) {
        console.error(error);
        statusMsg.textContent = "Error loading collections.";
    }
    // finally { setSearchLoading(false); }
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
    if (isSearch && window._loadedMonthData) {
        statusMsg.textContent = `Showing ${data.length} matches (Global Search).`;
    } else if (!isSearch) {
        statusMsg.textContent = `Found ${data.length} records.`;
    }
}
// Update stash only if NOT searching (searching shouldn't overwrite base data, but loadCollections does)
// Actually, loadCollections sets window._currentData. renderTable just renders.
// So we don't need to stash here anymore if we do it in loadCollections.


/* ---------- Edit Logic ---------- */
function openEdit(id) {
    const row = (window._displayedData || []).find(r => String(r.id) === String(id));
    if (!row) {
        console.error("Row not found for ID:", id, "in", window._displayedData);
        return;
    }

    console.log("Editing row:", row);

    editIdInput.value = row.id;
    editMemberIdInput.value = row.member_id; // Crucial for re-balancing
    editORInput.value = row.or_no || '';
    editAmountInput.value = row.payment;
    editDateInput.value = row.date_paid;
    editReasonInput.value = row.payment_for;

    editModal.classList.add('show');
}
window.openEdit = openEdit;

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

        // Refresh list
        const searchTerm = document.getElementById('searchInput').value.trim();
        if (searchTerm) {
            await performSearch(searchTerm);
        } else {
            await loadCollections();
        }

    } catch (e) {
        console.error(e);
        alert("Update failed: " + e.message);
    } finally {
        saveEditBtn.disabled = false;
        saveEditBtn.textContent = "Save Changes";
    }
}

/* ---------- Delete Logic ---------- */
async function confirmDelete(id) {
    if (!confirm("Are you sure you want to delete this collection? This will reverse the payment from the member's balance.")) return;

    const row = (window._displayedData || []).find(r => String(r.id) === String(id));
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

        const searchTerm = document.getElementById('searchInput').value.trim();
        if (searchTerm) {
            await performSearch(searchTerm);
        } else {
            await loadCollections();
        }
    } catch (e) {
        console.error(e);
        alert("Delete failed: " + e.message);
    }
}
window.confirmDelete = confirmDelete;

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
            // Only Regular payments count towards balance (Membership is excluded)
            if (!payFor || payFor.includes('regular')) {
                // Note: We checking for 'regular' or empty (legacy). 
                // Explicitly excluding 'membership'.
                if (!payFor.includes('membership')) {
                    totalPaid += Number(c.payment || 0);
                }
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
