/*******************************
 * SUPABASE INITIALIZATION FIX *
 *******************************/

/**********************
 * Helpers / UI sugar *
 **********************/
function showSplash(title, msg, type = "success") {
  const splash = document.getElementById("splash");
  const titleEl = document.getElementById("splashTitle");
  const msgEl = document.getElementById("splashMsg");
  if (!splash) return;

  splash.classList.remove("error");
  if (type === "error") splash.classList.add("error");

  titleEl.textContent = title || (type === "success" ? "Success" : "Error");
  msgEl.textContent = msg || "";
  splash.classList.add("show");
  setTimeout(() => splash.classList.remove("show"), 5000);
}

function setBtnBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = !!busy;
  btn.style.opacity = busy ? "0.7" : "1";
}

/********************
 * Password hashing *
 ********************/
async function hashPassword(plain) {
  if (!plain || typeof plain !== "string") {
    throw new Error("Invalid password");
  }
  try {
    if (window.bcrypt && typeof window.bcrypt.hashSync === "function") {
      return window.bcrypt.hashSync(plain, 10);
    }
  } catch (_) {
    // fall through to SHA-256
  }
  const enc = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/***********************
 * DOM elements / refs *
 ***********************/
const na = {
  lastname: document.getElementById("na-lastname"),
  firstname: document.getElementById("na-firstname"),
  middlename: document.getElementById("na-middlename"),
  address: document.getElementById("na-address"),
  birthdate: document.getElementById("na-birthdate"),
  position: document.getElementById("na-position"),
  username: document.getElementById("na-username"),
  email: document.getElementById("na-email"),
  role: document.getElementById("na-role"),
  parent: document.getElementById("na-parent"),
  password: document.getElementById("na-password"),
  confirm: document.getElementById("na-confirm"),
  createBtn: document.getElementById("btnCreateNew"),
};

const ex = {
  agent: document.getElementById("ex-agent"),
  username: document.getElementById("ex-username"),
  email: document.getElementById("ex-email"),
  role: document.getElementById("ex-role"),
  password: document.getElementById("ex-password"),
  confirm: document.getElementById("ex-confirm"),
  attachBtn: document.getElementById("btnAttachAccount"),
};

const rp = {
  account: document.getElementById("rp-account"),
  password: document.getElementById("rp-password"),
  confirm: document.getElementById("rp-confirm"),
  resetBtn: document.getElementById("btnResetPassword"),
};

/****************************
 * Show/Hide password eyes  *
 ****************************/
document.querySelectorAll('[data-toggle="pw"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-target");
    const input = document.getElementById(targetId);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  });
});

/************************************
 * Supabase helpers for edge calls  *
 ************************************/
let ADMIN_SECRET = "LOVE";

async function edgeCreateUser(body) {
  if (!window.SB || !window.SB.functions) {
    throw new Error("Supabase client not ready.");
  }

  try {
    const { data, error } = await SB.functions.invoke("admin-create-user", {
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": ADMIN_SECRET,
      },
      body: JSON.stringify(body),
    });

    console.log("[edgeCreateUser] response:", data, error);

    if (error) throw new Error(error.message || "Edge function error");
    if (data?.error) throw new Error(data.error);
    if (!data?.ok) throw new Error("Edge function did not return ok");

    return data;
  } catch (err) {
    console.error("[edgeCreateUser] failed:", err);
    throw err;
  }
}

async function edgeSetPassword(body) {
  if (!window.SB || !window.SB.functions) {
    throw new Error("Supabase client not ready.");
  }

  try {
    const { data, error } = await SB.functions.invoke("admin-set-password", {
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": ADMIN_SECRET,
      },
      body: JSON.stringify(body),
    });

    console.log("[edgeSetPassword] response:", data, error);

    if (error) throw new Error(error.message || "Edge function error");
    if (data?.error) throw new Error(data.error);
    if (!data?.ok) throw new Error("Password function did not return ok");

    return data;
  } catch (err) {
    console.error("[edgeSetPassword] failed:", err);
    throw err;
  }
}

/********************
 * Load dropdowns   *
 ********************/
async function loadAgents() {
  const sel = ex.agent;
  if (!sel) return;

  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const { data, error } = await SB.from("agents")
      .select("id, firstname, lastname")
      .order("lastname", { ascending: true });

    if (error) throw error;

    if (!data || !data.length) {
      sel.innerHTML = '<option value="">No agents found</option>';
      return;
    }
    sel.innerHTML = "";
    data.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.lastname || ""}, ${a.firstname || ""}`.trim();
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("[loadAgents]", err);
    sel.innerHTML = `<option value="">Error: ${err.message}</option>`;
  }
}

async function loadHeadAgents() {
  const sel = na.parent;
  if (!sel) return;

  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const { data, error } = await SB.from("agents")
      .select("id, firstname, lastname")
      .order("lastname", { ascending: true });

    if (error) throw error;

    sel.innerHTML = '<option value="">None</option>';
    data.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.lastname || ""}, ${a.firstname || ""}`.trim();
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("[loadHeadAgents]", err);
    sel.innerHTML = `<option value="">Error: ${err.message}</option>`;
  }
}

async function loadAccounts() {
  const sel = rp.account;
  if (!sel) return;

  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const { data, error } = await SB.from("users_profile")
      .select("user_id, username, agent_id")
      .order("username", { ascending: true });

    if (error) throw error;

    if (!data || !data.length) {
      sel.innerHTML = '<option value="">No accounts found</option>';
      return;
    }
    sel.innerHTML = "";
    data.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.user_id;
      opt.textContent = u.username || `(no username)`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("[loadAccounts]", err);
    sel.innerHTML = `<option value="">Error: ${err.message}</option>`;
  }
}

/********************************
 * Actions (Create / Attach / Reset)
 ********************************/
async function onCreateNew() {
  if (!na.createBtn) return;
  setBtnBusy(na.createBtn, true);

  try {
    if (!na.lastname.value.trim() || !na.firstname.value.trim())
      throw new Error("Last name and First name are required.");
    if (!na.username.value.trim())
      throw new Error("Username is required.");
    if (na.password.value !== na.confirm.value)
      throw new Error("Passwords do not match.");
    if (!na.password.value || na.password.value.length < 6)
      throw new Error("Password must be at least 6 characters.");

    const agentPayload = {
      lastname: na.lastname.value.trim(),
      firstname: na.firstname.value.trim(),
      middlename: na.middlename.value.trim() || null,
      address: na.address.value.trim() || null,
      birthdate: na.birthdate.value || null,
      position: na.position.value.trim() || null,
      parent_id: na.parent.value ? Number(na.parent.value) : null,
    };

    const { data: agentIns, error: agentErr } = await SB
      .from("agents")
      .insert(agentPayload)
      .select("id, firstname, lastname")
      .single();

    if (agentErr) throw agentErr;
    const agentId = agentIns?.id;
    if (!agentId) throw new Error("Failed to create agent (no id returned).");

    const username = na.username.value.trim();
    const inputEmail = na.email ? na.email.value.trim() : "";
    const email = inputEmail || `${username.toLowerCase()}@maharlikan.local`;
    const role = (na.role.value || "agent").toLowerCase();

    await edgeCreateUser({
      username,
      password: na.password.value,
      role,
      agent_id: agentId,
      email,
    });

    showSplash("Created", "New agent and account created successfully!");
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    console.error("[onCreateNew]", err);
    showSplash("Create Failed", err.message || "Unable to create account.", "error");
  } finally {
    setBtnBusy(na.createBtn, false);
  }
}

async function onAttachAccount() {
  if (!ex.attachBtn) return;
  setBtnBusy(ex.attachBtn, true);

  try {
    if (!ex.agent.value) throw new Error("Choose an agent first.");
    if (!ex.username.value.trim()) throw new Error("Username is required.");
    if (ex.password.value !== ex.confirm.value)
      throw new Error("Passwords do not match.");
    if (!ex.password.value || ex.password.value.length < 6)
      throw new Error("Password must be at least 6 characters.");

    const username = ex.username.value.trim();
    const inputEmail = ex.email ? ex.email.value.trim() : "";
    const email = inputEmail || `${username.toLowerCase()}@maharlikan.local`;
    const role = (ex.role.value || "agent").toLowerCase();

    await edgeCreateUser({
      username,
      password: ex.password.value,
      role,
      agent_id: Number(ex.agent.value),
      email,
    });

    showSplash("Created", "Account successfully attached!");
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    console.error("[onAttachAccount]", err);
    showSplash("Create Failed", err.message || "Unable to attach account.", "error");
  } finally {
    setBtnBusy(ex.attachBtn, false);
  }
}

async function onResetPassword() {
  if (!rp.resetBtn) return;
  setBtnBusy(rp.resetBtn, true);

  try {
    if (!rp.account.value) throw new Error("Choose an account.");
    if (rp.password.value !== rp.confirm.value)
      throw new Error("Passwords do not match.");
    if (!rp.password.value || rp.password.value.length < 6)
      throw new Error("Password must be at least 6 characters.");

    await edgeSetPassword({
      user_id: rp.account.value,
      password: rp.password.value,
    });

    const password_hash = await hashPassword(rp.password.value);
    const { error } = await SB
      .from("users_profile")
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq("user_id", rp.account.value);

    if (error) throw error;

    showSplash("Password Reset", "Password updated successfully.", "success");
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    console.error("[onResetPassword]", err);
    showSplash("Reset Failed", err.message || "Unable to reset password.", "error");
  } finally {
    setBtnBusy(rp.resetBtn, false);
  }
}

/****************
 * Boot / wire  *
 ****************/
window.addEventListener("DOMContentLoaded", async () => {
  // 1. Fetch Environment Variables
  let env = {};
  if (window.electronAPI?.getEnv) {
    try {
      env = await window.electronAPI.getEnv();
    } catch (e) {
      console.error("[register-agent] Failed to get env:", e);
    }
  }

  // 2. Initialize Supabase if not already present
  if (!window.SB) {
    const sbUrl = env.SUPABASE_URL;
    const sbKey = env.SUPABASE_ANON_KEY;

    if (!sbUrl || !sbKey) {
      console.error("Missing Supabase credentials in env.");
      showSplash("Error", "Missing Supabase configuration.", "error");
      return;
    }

    if (!window.supabase || !window.supabase.createClient) {
      console.error("Supabase JS library not loaded.");
      showSplash("Error", "Supabase library not loaded.", "error");
      return;
    }

    if (env.ADMIN_PORTAL_SECRET) {
      ADMIN_SECRET = env.ADMIN_PORTAL_SECRET;
    }

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

    window.SB = window.supabase.createClient(sbUrl, sbKey, {
      auth: {
        persistSession: false,      // Don't duplicate storage
        autoRefreshToken: true,     // ✅ ENABLE: Auto-refresh tokens
        detectSessionInUrl: false,
        storage: memoryStorage       // ✅ ISOLATE from localStorage but allow internal refresh
      },
    });

    // ✅ Listen for token refresh events
    window.SB.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') {
        console.log('[register-agent] ✅ Token auto-refreshed');
      }
    });

    console.log("Supabase initialized in register-agent.js");

    // 2b. Set Session from URL if present
    const params = new URLSearchParams(window.location.search);
    const token = params.get("access_token");
    const refresh = params.get("refresh_token");
    if (token && refresh) {
      console.log("Setting session from URL token...");
      const { error } = await window.SB.auth.setSession({
        access_token: token,
        refresh_token: refresh,
      });
      if (error) console.warn("Failed to set session:", error);
    }
  }

  // 3. Load Data
  await Promise.all([loadAgents(), loadAccounts(), loadHeadAgents()]);
  na.createBtn?.addEventListener("click", onCreateNew);
  ex.attachBtn?.addEventListener("click", onAttachAccount);
  rp.resetBtn?.addEventListener("click", onResetPassword);

  console.log("Register Agent page ready.");
});
