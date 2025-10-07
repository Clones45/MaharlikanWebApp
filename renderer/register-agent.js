/* ============================
   Helpers (toast / splash / hash)
   ============================ */

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

/** Safe, universal password hasher.
 *  1) If bcryptjs is available (window.bcrypt), use bcrypt.hashSync with saltRounds=10
 *  2) Otherwise fallback to SHA-256 (not ideal, but prevents runtime errors)
 */
async function hashPassword(plain) {
  if (!plain || typeof plain !== "string") {
    throw new Error("Invalid password");
  }
  try {
    if (window.bcrypt && typeof window.bcrypt.hashSync === "function") {
      return window.bcrypt.hashSync(plain, 10);
    }
  } catch (e) {
    // fall through to SHA-256
  }
  // Fallback: SHA-256 (avoid runtime failure if bcrypt isn't loaded)
  const enc = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ============================
   DOM elements
   ============================ */

// New Agent & Account
const na = {
  lastname: document.getElementById("na-lastname"),
  firstname: document.getElementById("na-firstname"),
  middlename: document.getElementById("na-middlename"),
  address: document.getElementById("na-address"),
  birthdate: document.getElementById("na-birthdate"),
  position: document.getElementById("na-position"),
  username: document.getElementById("na-username"),
  role: document.getElementById("na-role"),
  password: document.getElementById("na-password"),
  confirm: document.getElementById("na-confirm"),
  createBtn: document.getElementById("btnCreateNew"),
};

// Attach to Existing Agent
const ex = {
  agent: document.getElementById("ex-agent"),
  username: document.getElementById("ex-username"),
  role: document.getElementById("ex-role"),
  password: document.getElementById("ex-password"),
  confirm: document.getElementById("ex-confirm"),
  attachBtn: document.getElementById("btnAttachAccount"),
};

// Reset Password
const rp = {
  account: document.getElementById("rp-account"),
  password: document.getElementById("rp-password"),
  confirm: document.getElementById("rp-confirm"),
  resetBtn: document.getElementById("btnResetPassword"),
};

// Password eye toggles (any element with data-toggle="pw")
document.querySelectorAll('[data-toggle="pw"]').forEach(btn => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-target");
    const input = document.getElementById(targetId);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  });
});

/* ============================
   Load dropdowns
   ============================ */

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
    data.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.lastname || ""}, ${a.firstname || ""}`.trim();
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("[loadAgents] ", err);
    sel.innerHTML = '<option value="">Cannot load agents</option>';
  }
}

async function loadAccounts() {
  const sel = rp.account;
  if (!sel) return;

  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    // We list accounts by username + (optionally) agent_id
    const { data, error } = await SB.from("users_profile")
      .select("user_id, username, agent_id")
      .order("username", { ascending: true });

    if (error) throw error;

    if (!data || !data.length) {
      sel.innerHTML = '<option value="">No accounts found</option>';
      return;
    }
    sel.innerHTML = "";
    data.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.user_id; // for update
      opt.textContent = u.username || `(no username)`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("[loadAccounts] ", err);
    sel.innerHTML = '<option value="">Cannot load accounts</option>';
  }
}

/* ============================
   Actions
   ============================ */

/** Create brand new AGENT row and a linked users_profile account.
 *  IMPORTANT: we DO NOT send user_id -> DB default generates it.
 */
async function onCreateNew() {
  if (!na.createBtn) return;
  setBtnBusy(na.createBtn, true);

  try {
    // Basic validation
    if (!na.lastname.value.trim() || !na.firstname.value.trim()) {
      throw new Error("Last name and First name are required.");
    }
    if (!na.username.value.trim()) {
      throw new Error("Username is required.");
    }
    if (na.password.value !== na.confirm.value) {
      throw new Error("Passwords do not match.");
    }
    if (!na.password.value || na.password.value.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    // 1) Insert into AGENTS
    const agentPayload = {
      lastname: na.lastname.value.trim(),
      firstname: na.firstname.value.trim(),
      middlename: na.middlename.value.trim() || null,
      address: na.address.value.trim() || null,
      birthdate: na.birthdate.value || null,
      position: na.position.value.trim() || null,
    };

    const { data: agentIns, error: agentErr } = await SB
      .from("agents")
      .insert(agentPayload)
      .select("id, firstname, lastname")
      .single();

    if (agentErr) throw agentErr;
    const agentId = agentIns?.id;
    if (!agentId) throw new Error("Failed to create agent (no id returned).");

    // 2) Create users_profile (omit user_id -> DB default)
    const password_hash = await hashPassword(na.password.value);
    const { error: profErr } = await SB
      .from("users_profile")
      .insert({
        // user_id omitted on purpose -> DB default gen_random_uuid()
        username: na.username.value.trim(),
        role: na.role.value || "agent",
        agent_id: agentId,
        display_name: `${agentIns.firstname || ""} ${agentIns.lastname || ""}`.trim(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // your schema may not have password_hash column,
        // store into a column you chose for credential (if any).
        // If you don't have one (only demo), comment this out or add a column.
        password_hash,
      });

    if (profErr) throw profErr;

    showSplash("Created", "Agent & account created successfully.", "success");

    // refresh accounts dropdown so it appears in reset list
    await loadAccounts();

    // optional: clear minimal fields
    na.username.value = "";
    na.password.value = "";
    na.confirm.value = "";
  } catch (err) {
    console.error("[onCreateNew] ", err);
    showSplash("Create Failed", err.message || "Unable to create account.", "error");
  } finally {
    setBtnBusy(na.createBtn, false);
  }
}

/** Attach a new users_profile account to an EXISTING agent.
 *  We still omit user_id to rely on DB default.
 */
async function onAttachAccount() {
  if (!ex.attachBtn) return;
  setBtnBusy(ex.attachBtn, true);

  try {
    if (!ex.agent.value) throw new Error("Choose an agent first.");
    if (!ex.username.value.trim()) throw new Error("Username is required.");
    if (ex.password.value !== ex.confirm.value) {
      throw new Error("Passwords do not match.");
    }
    if (!ex.password.value || ex.password.value.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    const password_hash = await hashPassword(ex.password.value);
    const payload = {
      // user_id omitted (DB default)
      username: ex.username.value.trim(),
      role: ex.role.value || "agent",
      agent_id: Number(ex.agent.value),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      password_hash,
    };

    const { error } = await SB.from("users_profile").insert(payload);
    if (error) throw error;

    showSplash("Created", "Account attached to agent.", "success");

    // Refresh accounts dropdown for reset section
    await loadAccounts();

    ex.username.value = "";
    ex.password.value = "";
    ex.confirm.value = "";
  } catch (err) {
    console.error("[onAttachAccount] ", err);
    showSplash("Create Failed", err.message || "Unable to attach account.", "error");
  } finally {
    setBtnBusy(ex.attachBtn, false);
  }
}

/** Reset password for an existing users_profile row */
async function onResetPassword() {
  if (!rp.resetBtn) return;
  setBtnBusy(rp.resetBtn, true);

  try {
    if (!rp.account.value) throw new Error("Choose an account.");
    if (rp.password.value !== rp.confirm.value) {
      throw new Error("Passwords do not match.");
    }
    if (!rp.password.value || rp.password.value.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    const password_hash = await hashPassword(rp.password.value);

    const { error } = await SB
      .from("users_profile")
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq("user_id", rp.account.value);

    if (error) throw error;

    showSplash("Password Reset", "Password updated successfully.", "success");

    rp.password.value = "";
    rp.confirm.value = "";
  } catch (err) {
    console.error("[onResetPassword] ", err);
    showSplash("Reset Failed", err.message || "Unable to reset password.", "error");
  } finally {
    setBtnBusy(rp.resetBtn, false);
  }
}

/* ============================
   Wire events + init
   ============================ */

window.addEventListener("DOMContentLoaded", async () => {
  if (!window.SB) {
    console.warn("Supabase client (SB) not found on window. Check init in HTML.");
    showSplash("Error", "Supabase not initialized on this page.", "error");
    return;
  }

  // load dropdown data
  await Promise.all([loadAgents(), loadAccounts()]);

  // hook up buttons
  na.createBtn?.addEventListener("click", onCreateNew);
  ex.attachBtn?.addEventListener("click", onAttachAccount);
  rp.resetBtn?.addEventListener("click", onResetPassword);

  console.log("Register Agent page ready.");
});
