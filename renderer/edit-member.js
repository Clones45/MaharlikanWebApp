// edit-member.js — Supabase CRUD for members + beneficiaries + Agent dropdown (agent_id)
// Includes splash alerts and a toggle to clear/keep the form after update.

const SB = window.SB;

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

  // Build payload from form fields (skip hidden id & agentSelect itself)
  const payload = {};
  form.querySelectorAll("input, select, textarea").forEach(inp => {
    if (inp.id && inp.id !== "member_id" && inp.id !== "agentSelect") {
      payload[inp.id] = inp.value?.trim?.() ?? inp.value;
    }
  });

  // Agent: store agent_id (int) on members
  if (agentSelect) {
    payload.agent_id = agentSelect.value ? Number(agentSelect.value) : null;
  }

  try {
    // Update member
    const { error: upErr } = await SB.from("members")
      .update(payload)
      .eq("id", memberId);
    if (upErr) throw upErr;

    // Replace beneficiaries (delete -> insert)
    const { error: delErr } = await SB
      .from("beneficiaries")
      .delete()
      .eq("member_id", memberId);
    if (delErr) throw delErr;

    // Replace your current beneRows build with this:
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


    if (beneRows.length > 0) {
      const { error: insErr } = await SB.from("beneficiaries").insert(beneRows);
      if (insErr) throw insErr;
    }

    // === Post-save behavior ===
    if (CLEAR_AFTER_UPDATE) {
      // Clear & return to search state
      form.reset();
      beneContainer.innerHTML = `<p class="muted">No beneficiaries found.</p>`;
      if (agentSelect) agentSelect.value = "";
      form.classList.add("hidden");
      placeholder.classList.remove("hidden");
      searchMsg.textContent = "Saved. You can search another member.";
      showSplash("Member updated successfully! Form cleared.");
    } else {
      // Keep fields filled: re-fetch saved row and re-render
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
    console.error(err);
    showSplash("Update failed. See console.", "error");
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
  } catch (e) {
    console.error("Init error:", e);
  }
})();
