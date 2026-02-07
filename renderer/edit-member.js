// edit-member.js — Supabase CRUD for members + beneficiaries + Agent dropdown (agent_id)
// Includes splash alerts and a toggle to clear/keep the form after update.

const SB = window.SB;
console.log("EDIT-MEMBER VERSION CHECK — BUILD #9");


/** =========================
 *  Behavior toggle
 *  true  -> after a successful update, CLEAR the form and go back to search state
 *  false -> keep fields filled (reloads saved member)
 * ========================= */
const CLEAR_AFTER_UPDATE = true;

// ---------- DOM ----------
const searchBox = document.getElementById("searchBox");
const searchBtn = document.getElementById("searchBtn");
const searchMsg = document.getElementById("searchMsg");
const form = document.getElementById("memberForm");
const placeholder = document.getElementById("placeholder");

const addBeneficiaryBtn = document.getElementById("addBeneficiaryBtn");
const beneContainer = document.getElementById("beneficiaries-container");

const updateBtn = document.getElementById("updateBtn");
const transferBtn = document.getElementById("transferBtn");
const deleteBtn = document.getElementById("deleteBtn");
const agentSelect = document.getElementById("agentSelect");

// Hide the form until we have a result
form.classList.add("hidden");

/* =========================
   Splash (animated box alert)
   ========================= */
let splashEl = null;
function ensureSplashStyles() {
  if (document.getElementById("splash-css")) return;
  const s = document.createElement("style");
  s.id = "splash-css";
  s.textContent = `
    .splash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.15);z-index:99999;opacity:0;pointer-events:none;transition:opacity .25s ease}
    .splash.show{opacity:1;pointer-events:auto}
    .splash-box{min-width:320px;max-width:560px;padding:18px 20px;border-radius:14px;color:#fff;background:#28a745;box-shadow:0 20px 60px rgba(0,0,0,.25);transform:scale(.96);transition:transform .25s ease}
    .splash.show .splash-box{transform:scale(1)}
    .splash.error .splash-box{background:#e53935}
    .splash h4{margin:0 0 6px;font-size:18px}
    .splash p{margin:0;opacity:.95}
  `;
  document.head.appendChild(s);
}
function showSplash(message, type = "success", title = type === "success" ? "Success" : "Oops") {
  ensureSplashStyles();
  if (!splashEl) {
    splashEl = document.createElement("div");
    splashEl.className = "splash";
    splashEl.innerHTML = `<div class="splash-box"><h4></h4><p></p></div>`;
    document.body.appendChild(splashEl);
  }
  const box = splashEl.querySelector(".splash-box");
  splashEl.classList.toggle("error", type === "error");
  box.querySelector("h4").textContent = title;
  box.querySelector("p").textContent = message;

  splashEl.classList.add("show");
  setTimeout(() => splashEl.classList.remove("show"), 5000);
}

/* =========================
   Utilities
   ========================= */
function esc(s) {
  return String(s ?? "").replace(/[<>&"']/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* =========================
   Agents dropdown (agent_id)
   ========================= */
let agentsCache = [];
const agentDisplayName = a => `${a?.lastname || ""}, ${a?.firstname || ""}`.trim();

async function loadAgents() {
  if (!agentSelect) return;

  agentSelect.innerHTML = '<option value="">Loading…</option>';

  try {
    const { data, error } = await SB
      .from("agents")
      .select("id, firstname, lastname")
      .order("lastname", { ascending: true });

    if (error) {
      console.error("[loadAgents] error:", error);
      agentSelect.innerHTML = '<option value="">Cannot load agents</option>';
      showSplash("Failed to load agents. Check RLS.", "error");
      return;
    }

    agentsCache = Array.isArray(data) ? data : [];
    if (!agentsCache.length) {
      agentSelect.innerHTML = '<option value="">No agents found</option>';
      return;
    }

    agentSelect.innerHTML = '<option value="">— Select —</option>';
    for (const a of agentsCache) {
      const opt = document.createElement("option");
      opt.value = String(a.id);
      opt.textContent = agentDisplayName(a) || `Agent #${a.id}`;
      agentSelect.appendChild(opt);
    }
  } catch (e) {
    console.error("[loadAgents] exception:", e);
    agentSelect.innerHTML = '<option value="">Cannot load agents</option>';
    showSplash("Failed to load agents (runtime error).", "error");
  }
}
function selectAgentForMember(agentId) {
  if (!agentSelect) return;
  agentSelect.value = agentId != null ? String(agentId) : "";
}

/* =========================
   Search
   ========================= */
searchBtn.addEventListener("click", onSearch);
searchBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSearch();
});

async function onSearch() {
  const q = searchBox.value.trim();
  if (!q) {
    searchMsg.textContent = "Please enter a search term.";
    return;
  }
  searchMsg.textContent = "Searching...";
  form.classList.add("hidden");
  placeholder.classList.remove("hidden");
  beneContainer.innerHTML = "";

  try {
    const { data: rows, error } = await SB
      .from("members")
      .select("*")
      .or(`maf_no.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .limit(1);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      searchMsg.textContent = `No member found for “${q}”.`;
      return;
    }

    const member = rows[0];
    await renderMember(member);

    searchMsg.textContent = "";
    placeholder.classList.add("hidden");
    form.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    searchMsg.textContent = "Error fetching member.";
  }
}

/* =========================
   Populate / Render
   ========================= */
function populateForm(m) {
  Object.keys(m).forEach(key => {
    const el = document.getElementById(key);
    if (el) {
      if (el.type === "date" && m[key]) {
        // Fix: Use simple string parsing to avoid Timezone shifts (e.g. 2000-01-01 becoming 1999-12-31)
        // If it's an ISO string (YYYY-MM-DD...)
        const val = String(m[key]);
        if (val.match(/^\d{4}-\d{2}-\d{2}/)) {
          el.value = val.substring(0, 10); // Take just the date part
          return;
        }

        // Fallback for non-standard formats
        const d = new Date(m[key]);
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          el.value = `${yyyy}-${mm}-${dd}`;
          return;
        }
      }
      el.value = m[key] ?? "";
    }
  });
  const idEl = document.getElementById("member_id");
  if (idEl) idEl.value = m.id;
  selectAgentForMember(m.agent_id);
}

async function loadBeneficiaries(memberId) {
  beneContainer.innerHTML = `<p class="muted">Loading beneficiaries...</p>`;

  const { data, error } = await SB
    .from("beneficiaries")
    .select("*")
    .eq("member_id", memberId);

  if (error) {
    console.error(error);
    beneContainer.innerHTML = `<p class="muted">Error loading beneficiaries.</p>`;
    return;
  }

  if (!data || data.length === 0) {
    beneContainer.innerHTML = `<p class="muted">No beneficiaries found.</p>`;
    return;
  }

  beneContainer.innerHTML = "";
  data.forEach((b, i) => addBeneficiaryCard(b, i));
}

async function renderMember(member) {
  populateForm(member);
  await loadBeneficiaries(member.id);

  // Show Transfer button only if member is loaded
  if (transferBtn) transferBtn.style.display = 'inline-block';
}

/* =========================
   Beneficiaries UI
   ========================= */
function addBeneficiaryCard(b = {}, index = 0) {
  const card = document.createElement("div");
  card.className = "bene-card";
  card.innerHTML = `
    <div class="bene-head">
      <div class="bene-title">Beneficiary ${index + 1}</div>
      <button type="button" class="remove-bene">Remove</button>
    </div>
    <div class="bene-grid">
      <div><label>Last Name</label><input class="b-last" value="${esc(b.last_name)}"></div>
      <div><label>First Name</label><input class="b-first" value="${esc(b.first_name)}"></div>
      <div><label>Middle Name</label><input class="b-middle" value="${esc(b.middle_name)}"></div>
      <div><label>Relation</label><input class="b-relation" value="${esc(b.relation)}"></div>
      <div><label>Address</label><input class="b-address" value="${esc(b.address)}"></div>
      <div><label>Birth Date</label><input type="date" class="b-birth" value="${esc(b.birth_date)}"></div>
      <div><label>Age</label><input type="number" class="b-age" min="0" value="${esc(b.age)}"></div>
    </div>
  `;
  card.querySelector(".remove-bene").addEventListener("click", () => card.remove());
  beneContainer.appendChild(card);
}

addBeneficiaryBtn.addEventListener("click", () => {
  addBeneficiaryCard({}, beneContainer.children.length);
});

/* =========================
   Update
   ========================= */
updateBtn.addEventListener("click", onUpdate);

async function onUpdate() {
  const memberId = document.getElementById("member_id").value;
  if (!memberId) return showSplash("No member loaded.", "error");

  // 🧩 1. Network check
  if (!navigator.onLine) {
    return showSplash("No internet connection. Please reconnect and retry.", "error");
  }

  // Build payload from form fields (skip hidden id & agentSelect itself)
  // 🧩 Build payload from form fields (skip hidden id & agentSelect)
  const payload = {};
  form.querySelectorAll("input, select, textarea").forEach(inp => {
    if (inp.id && inp.id !== "member_id" && inp.id !== "agentSelect") {
      // 🧹 Trim and normalize the key name and value
      const cleanKey = inp.id.trim().replace(/\s+/g, "_").toLowerCase();
      const cleanValue = typeof inp.value === "string" ? inp.value.trim() : inp.value;
      payload[cleanKey] = cleanValue;
    }
  });


  // ✅ Normalize any edge case key (safety fallback)
  // (Removed destructive phone_number block)

  // Agent: store agent_id (int) on members
  if (agentSelect) {
    payload.agent_id = agentSelect.value ? Number(agentSelect.value) : null;
  }

  // 🧩 3. Validate required fields
  if (!payload.first_name || !payload.last_name) {
    return showSplash("First and last name are required.", "error");
  }

  if (payload.age && isNaN(Number(payload.age))) {
    return showSplash("Age must be a valid number.", "error");
  }

  // 🧩 4. Sanitize types
  ["age", "agent_id"].forEach(k => {
    if (payload[k] === "") payload[k] = null;
    if (payload[k] != null) payload[k] = Number(payload[k]);
  });

  // Basic date validation
  if (payload.birth_date && isNaN(new Date(payload.birth_date).getTime())) {
    delete payload.birth_date;
  }

  try {
    console.log("[onUpdate] Payload:", payload);

    // 🔍 Normalize possible field naming issues 
    if (payload.contact_number) {
      payload.phone_number = payload.contact_number;
      delete payload.contact_number;
    }
    if (payload.contactNumber) {
      payload.phone_number = payload.contactNumber;
      delete payload.contactNumber;
    }
    if (payload["contact number"]) {
      payload.phone_number = payload["contact number"];
      delete payload["contact number"];
    }



    // 🧩 5. Update member
    // 🧩 5. Update member — sanitize payload first
    const validKeys = [
      "maf_no",
      "last_name",
      "first_name",
      "middle_name",
      "address",
      "phone_number",
      "religion",
      "birth_date",
      "age",
      "monthly_due",
      "payment_frequency",
      "plan_type",
      "contracted_price",
      "date_joined",
      "balance",
      "gender",
      "civil_status",
      "zipcode",
      "birthplace",
      "nationality",
      "height",
      "weight",
      "casket_type",
      "membership",
      "occupation",
      "agent_id",
      "status",
      "plan_start_date",
      "membership_paid",
      "membership_paid_date"
    ];

    // Strip any fields not defined in 'members' schema
    Object.keys(payload).forEach((k) => {
      if (!validKeys.includes(k)) delete payload[k];
    });

    console.log("[onUpdate] Cleaned Payload:", payload);

    const { error: upErr } = await SB
      .from("members")
      .update(payload)
      .eq("id", memberId);


    if (upErr) {
      console.error("[Update Member] Error:", upErr);
      throw upErr;
    }
    showSplash("Member record updated successfully!", "success");


    // 🧩 6. Replace beneficiaries safely
    const { error: delErr } = await SB
      .from("beneficiaries")
      .delete()
      .eq("member_id", memberId);
    if (delErr) {
      console.error("[Delete Beneficiaries] Error:", delErr);
      throw delErr;
    }

    const cards = Array.from(beneContainer.querySelectorAll(".bene-card"));
    const beneRows = cards.map(card => {
      const get = (sel) => (card.querySelector(sel)?.value ?? "").trim();
      const ageVal = card.querySelector(".b-age")?.value;

      return {
        member_id: Number(memberId),
        last_name: get(".b-last"),
        first_name: get(".b-first"),
        middle_name: get(".b-middle"),
        relation: get(".b-relation"),
        address: get(".b-address"),
        birth_date: get(".b-birth") || null,
        age: ageVal ? parseInt(ageVal, 10) : null,
      };
    }).filter(r => r.last_name || r.first_name);


    // 🧩 7. Post-save behavior
    if (CLEAR_AFTER_UPDATE) {
      form.reset();
      beneContainer.innerHTML = `<p class="muted">No beneficiaries found.</p>`;
      if (agentSelect) agentSelect.value = "";
      form.classList.add("hidden");
      placeholder.classList.remove("hidden");
      searchMsg.textContent = "Saved. You can search another member.";
      showSplash("Member updated successfully! Form cleared.");
    } else {
      const { data: fresh, error: refErr } = await SB
        .from("members")
        .select("*")
        .eq("id", memberId)
        .single();
      if (!refErr && fresh) {
        await renderMember(fresh);
      }
      showSplash("Member updated successfully!");
    }

  } catch (err) {
    console.error("[onUpdate] Exception:", err);

    // 🧩 8. Friendly error messages for normal users
    let msg = "Something went wrong while saving your changes.";

    // Handle specific PostgreSQL or network codes/messages
    if (err.code === "42501") {
      msg = "You don't have permission to perform this action. Please contact the administrator.";
    }
    else if (err.message?.includes("invalid input syntax for type date")) {
      msg = "Please fill in all date fields correctly (e.g., Birth Date ). Put 01/01/2000 if not applicable";
    }
    else if (err.message?.includes("duplicate key value")) {
      msg = "A record with this Member ID or contact number already exists. Please check and try again.";
    }
    else if (err.message?.includes("violates foreign key constraint")) {
      msg = "This record is linked to other data and can’t be updated right now.";
    }
    else if (err.message?.includes("22007")) {
      // Postgres code for date syntax errors
      msg = "One or more date fields are invalid. Please use the format YYYY-MM-DD (for example: 2024-12-25).";
    }
    else if (err.message?.includes("22P02")) {
      // Postgres invalid_text_representation
      msg = "Some number fields contain invalid characters. Please check that only numbers are entered.";
    }

    showSplash(msg, "error");
  }
}

/* =========================
   Transfer Member Logic
   ========================= */
if (transferBtn) {
  transferBtn.addEventListener("click", onTransfer);
}

async function onTransfer() {
  const memberId = document.getElementById("member_id").value;
  if (!memberId) return showSplash("No member loaded.", "error");

  if (!confirm("⚠️ TRANSFER MEMBER CONFIRMATION ⚠️\n\nThis will:\n1. RESET the contestability period (Plan Start Date = Today)\n2. Record the Transfer Date as Today\n3. Keep the original 'Date Joined' unchanged\n\nAre you sure you want to proceed?")) {
    return;
  }

  // 1. Network check
  if (!navigator.onLine) {
    return showSplash("No internet connection. Please reconnect and retry.", "error");
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    // Prepare payload for Transfer
    // We only need to update specific fields, but we should also capture
    // any edits currently in the form? 
    // Usually a Transfer implies saving current state + resetting dates.
    // So let's reuse the logic of 'onUpdate' but OVERRIDE the dates.

    // Instead of duplicating onUpdate, let's manually do a specific update for transfer
    // OR we can just update the two fields if we assume the user isn't editing other things simultaneously.
    // However, to be safe and consistent with "Save", let's update everything currently in the form
    // PLUS the override dates.

    // BUT, 'onUpdate' is complex. Let's do a targeted update for reliability first.
    // If the user changed the name/address, they should click "Update" first?
    // Let's assume Transfer ONLY handles the transfer aspect to be safe.

    const payload = {
      plan_start_date: todayStr,
      transferred_date: todayStr
    };

    console.log("[onTransfer] Updating dates:", payload);

    const { error: upErr } = await SB
      .from("members")
      .update(payload)
      .eq("id", memberId);

    if (upErr) throw upErr;

    showSplash("✅ Member Transferred Successfully! Contestability reset.", "success");

    // Refresh UI to show new dates
    const { data: fresh, error: refErr } = await SB
      .from("members")
      .select("*")
      .eq("id", memberId)
      .single();

    if (!refErr && fresh) {
      await renderMember(fresh);
    }

  } catch (err) {
    console.error("[onTransfer] Exception:", err);
    showSplash("Transfer failed. See console.", "error");
  }
}
/* =========================
   Delete
   ========================= */
deleteBtn.addEventListener("click", onDelete);

async function onDelete() {
  const memberId = document.getElementById("member_id").value;
  if (!memberId) return showSplash("No member selected.", "error");
  if (!confirm("Are you sure you want to delete this member and all beneficiaries?")) return;

  try {
    await SB.from("beneficiaries").delete().eq("member_id", memberId);
    const { error } = await SB.from("members").delete().eq("id", memberId);
    if (error) throw error;

    // Clear UI
    form.reset();
    beneContainer.innerHTML = `<p class="muted">No beneficiaries found.</p>`;
    form.classList.add("hidden");
    placeholder.classList.remove("hidden");
    searchMsg.textContent = "";

    showSplash("Member deleted successfully.");
  } catch (err) {
    console.error(err);
    showSplash("Delete failed.", "error");
  }
}

/* =========================
   Init
   ========================= */
(async function init() {
  try {
    await loadAgents();

    // Optional: auto-calc age from birth_date
    const birth = document.getElementById("birth_date");
    const age = document.getElementById("age");
    if (birth && age) {
      birth.addEventListener("change", () => {
        if (!birth.value) return;
        const d = new Date(birth.value);
        if (isNaN(d.getTime())) return;
        const today = new Date();
        let a = today.getFullYear() - d.getFullYear();
        const m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) a--;
        age.value = a >= 0 ? a : "";
      });
    }

    // Periodic Due Logic
    const freqEl = document.getElementById("payment_frequency");
    const dueEl = document.getElementById("monthly_due");
    if (freqEl && dueEl) {
      const updatePeriodic = () => {
        const freq = freqEl.value || 'Monthly';
        const monthly = parseFloat(dueEl.value || 0);
        let factor = 1;
        if (freq === 'Quarterly') factor = 3;
        else if (freq === 'Bi-annually') factor = 6;
        else if (freq === 'Annually') factor = 12;
        const total = monthly * factor;
        const label = dueEl.previousElementSibling;
        if (label) {
          label.innerHTML = `Monthly Due <span style="font-size:10px; color:var(--neon-accent)">(${freq}: ${total.toLocaleString()})</span>`;
        }
      };
      freqEl.addEventListener("change", updatePeriodic);
      dueEl.addEventListener("input", updatePeriodic);
    }
  } catch (e) {
    console.error("Init error:", e);
  }
})();
