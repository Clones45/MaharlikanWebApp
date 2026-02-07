/************************************
 * MAHARLIKAN ACCESS CODES SYSTEM
 ************************************/

let supabaseClient = null;

// DOM elements
const codePrefixEl = document.getElementById("codePrefix");
const codeTable = document.getElementById("codeTable");

const bigBox = document.getElementById("newCodeDisplay");
const codeText = document.getElementById("bigCodeText");
const expireText = document.getElementById("expireText");
const copyBtn = document.getElementById("copyBtn");

// ===========================
// CUT-OFF DATE (7th RULE)
// ===========================
function getNextCutoffDate() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  if (d <= 7) {
    return new Date(y, m, 7, 23, 59, 59);
  } else {
    return new Date(y, m + 1, 7, 23, 59, 59);
  }
}

// ===========================
// RANDOM CODE GENERATOR
// ===========================
function generateAccessCode(prefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ123456789";
  let rnd = "";
  for (let i = 0; i < 5; i++) {
    rnd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${rnd}`;
}

// ===========================
// GENERATE CODE
// ===========================
// ===========================
// MODAL LOGIC (CUSTOM)
// ===========================
const modal = document.getElementById("customModal");

window.generateCode = function () {
  // Show Modal
  modal.classList.remove("hidden");
};

window.closeModal = function () {
  modal.classList.add("hidden");
};

// ===========================
// ACTUAL GENERATION (After Confirm)
// ===========================
window.confirmGeneration = async function () {
  closeModal(); // Hide modal immediately

  const prefix = codePrefixEl.value;
  const code = generateAccessCode(prefix);
  const expiresAt = getNextCutoffDate().toISOString();

  const { data, error } = await supabaseClient
    .from("access_codes")
    .insert({
      code,
      prefix,
      expires_at: expiresAt,
      used: false
    })
    .select()
    .single();

  if (error) {
    alert("Error: " + error.message);
    return;
  }

  bigBox.classList.remove("hidden");
  codeText.textContent = data.code;
  expireText.textContent = "Expires: " + new Date(data.expires_at).toLocaleDateString();

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(data.code);
    alert("✅ Code copied. It will now disappear.");

    bigBox.classList.add("hidden");
  };

  loadAccessCodes();
};

// ===========================
// LOAD CODES
// ===========================
window.loadAccessCodes = async function () {

  const { data, error } = await supabaseClient
    .from("access_codes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) {
    codeTable.innerHTML = "<tr><td colspan='5'>Error loading data</td></tr>";
    return;
  }

  if (data.length === 0) {
    codeTable.innerHTML = "<tr><td colspan='5'>No codes generated yet</td></tr>";
    return;
  }

  const now = new Date();
  let rows = "";

  data.forEach((item, index) => {
    let status = "AVAILABLE";
    let statusClass = "status-available";

    const expiry = new Date(item.expires_at);

    if (item.used === true) {
      status = "USED";
      statusClass = "status-used";
    } else if (expiry < now) {
      status = "EXPIRED";
      statusClass = "status-expired";
    }

    rows += `
      <tr>
        <td>${index + 1}</td>
        <td>
          <span class="code-box">${item.code}</span><br>
          <button onclick="copyCode('${item.code}')">Copy</button>
        </td>
        <td><b>${item.prefix}</b></td>
        <td>${expiry.toLocaleDateString()}</td>
        <td class="${statusClass}">${status}</td>
      </tr>
    `;
  });

  codeTable.innerHTML = rows;
};

// ===========================
// COPY FROM TABLE
// ===========================
window.copyCode = function (code) {
  navigator.clipboard.writeText(code);
  alert("✅ Code copied: " + code);
};


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
    // 🛑 CRITICAL: Use memory storage to prevent clearing main window's localStorage
    // while still allowing auto-refresh to work within this window's lifecycle.
    const memoryStorage = (() => {
      let store = {};
      return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = value; },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
      };
    })();

    supabaseClient = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,  // ✅ ENABLE: Auto-refresh tokens
        detectSessionInUrl: false,
        storage: memoryStorage    // ✅ ISOLATE from localStorage but allow internal refresh
      },
    });

    supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') console.log('[access_codes] ✅ Token refreshed');
    });

    // Session fix
    const params = new URLSearchParams(window.location.search);
    const token = params.get("access_token");
    const refresh = params.get("refresh_token");
    if (token && refresh) {
      await supabaseClient.auth.setSession({ access_token: token, refresh_token: refresh });
    }

    window.SB = supabaseClient;
    loadAccessCodes();
  }
})();
