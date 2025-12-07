let supabase = null;

const container = document.getElementById("requestsTableBody");
const refreshBtn = document.getElementById("refreshBtn");

// ===========================
// INIT SUPABASE
// ===========================
(async function initSupabase() {
  let env = null;
  if (window.electronAPI?.getEnv) {
    try { env = await window.electronAPI.getEnv(); } catch { }
  }
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    if (window.__ENV__) env = window.__ENV__;
  }
  if (env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
    supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,  // ✅ ENABLE: Auto-refresh tokens
        detectSessionInUrl: false
      },
    });

    supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') console.log('[view-withdrawals] ✅ Token refreshed');
    });

    // Session fix
    const params = new URLSearchParams(window.location.search);
    const token = params.get("access_token");
    const refresh = params.get("refresh_token");
    if (token && refresh) {
      await supabase.auth.setSession({ access_token: token, refresh_token: refresh });
    }

    loadWithdrawalRequests();
    subscribeRealtime();
  }
})();

// ========================
// LOAD ALL REQUESTS
// ========================
async function loadWithdrawalRequests() {
  container.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select(`
      id,
      amount,
      period_month,
      period_year,
      status,
      created_at,
      agent:agents (
        firstname,
        lastname
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("❌ Load error:", error);
    container.innerHTML = `<tr><td colspan="7">Error loading withdrawal requests.</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `<tr><td colspan="7">No withdrawal requests yet.</td></tr>`;
    return;
  }

  renderRequests(data);
}

// ========================
// RENDER REQUESTS
// ========================
function renderRequests(list) {
  container.innerHTML = "";

  list.forEach(req => {

    const fullName = req.agent
      ? `${req.agent.firstname} ${req.agent.lastname} `
      : "Unknown Agent";

    const row = document.createElement("tr");

    row.innerHTML = `
  <td>${req.id}</td>
      <td>${fullName}</td>
      <td>₱${Number(req.amount).toLocaleString()}</td>
      <td>${req.period_month}/${req.period_year}</td>
      <td>${new Date(req.created_at).toLocaleString()}</td>
      <td><strong>${req.status}</strong></td>
      <td>
        ${req.status === "pending"
        ? `
            <button class="approve-btn" data-id="${req.id}">Approve</button>
            <button class="reject-btn" data-id="${req.id}">Reject</button>
            `
        : `<em>Processed</em>`
      }
      </td>
`;

    container.appendChild(row);
  });

  activateButtons();
}

// ========================
// BUTTON HANDLERS
// ========================
function activateButtons() {

  document.querySelectorAll(".approve-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      await updateStatus(id, "approved");
    });
  });

  document.querySelectorAll(".reject-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      await updateStatus(id, "rejected");
    });
  });

}

// ========================
// UPDATE STATUS
// ========================
async function updateStatus(id, newStatus) {

  const confirmAction = confirm(`Are you sure you want to ${newStatus.toUpperCase()} this request ? `);
  if (!confirmAction) return;

  const { error } = await supabase
    .from("withdrawal_requests")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    console.error("❌ Update failed:", error);
    alert("Failed to update status.");
    return;
  }

  alert(`✅ Request marked as ${newStatus.toUpperCase()} `);
  loadWithdrawalRequests();
}

// ========================
// REALTIME LISTENER
// ========================
function subscribeRealtime() {
  supabase
    .channel("withdrawal-live")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "withdrawal_requests" },
      (payload) => {

        const req = payload.new;

        alert(`📥 NEW WITHDRAWAL REQUEST

💰 Amount: ₱${req.amount}
📅 Period: ${req.period_month}/${req.period_year}
  `);

        loadWithdrawalRequests();
      }
    )
    .subscribe();
}

// ========================
// REFRESH BUTTON
// ========================
if (refreshBtn) {
  refreshBtn.addEventListener("click", loadWithdrawalRequests);
}
