// soa.js — Supabase-powered Statement of Account
// Assumes window.SB (supabase client) is globally available (same as your other pages).

const SB = window.SB;

// DOM
const sheet = document.getElementById("sheet");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const exportBtn = document.getElementById("exportBtn");
const printBtn = document.getElementById("printBtn");

// Splash (center alert)
let splashEl;
function showSplash(message, type = "success", title = type === "success" ? "Success" : "Oops") {
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

// Helpers
const peso = n => `₱${(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`;
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

// Search
searchBtn.addEventListener("click", onSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") onSearch(); });
printBtn.addEventListener("click", () => window.print());
exportBtn.addEventListener("click", onExportPDF);

let currentData = null; // cache for pdf export

async function onSearch() {
  const q = searchInput.value.trim();
  if (!q) return showSplash("Please enter AF/MAF No or name.", "error");

  sheet.innerHTML = `<div class="muted">Loading…</div>`;

  try {
    // 1) Find member by maf_no OR name (first/last)
    const { data: members, error: mErr } = await SB
      .from("members")
      .select("*")
      .or(`maf_no.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .limit(1);

    if (mErr) throw mErr;
    if (!members || members.length === 0) {
      sheet.innerHTML = `<div class="muted">No member found for “${esc(q)}”.</div>`;
      return;
    }

    const member = members[0];

    // 2) Fetch agent (if agent_id exists)
    let agentName = "";
    if (member.agent_id) {
      const { data: agent, error: aErr } = await SB
        .from("agents")
        .select("firstname, lastname")
        .eq("id", member.agent_id)
        .single();
      if (!aErr && agent) agentName = `${agent.lastname || ""}, ${agent.firstname || ""}`.trim();
    }

    // 3) Fetch collections/payments by member id (or maf_no fallback)
    let payments = [];
    const { data: c1, error: cErr1 } = await SB
      .from("collections")
      .select("date_paid, payment, plan_type")
      .eq("member_id", member.id)
      .order("date_paid", { ascending: false });

    if (!cErr1 && Array.isArray(c1) && c1.length) {
      payments = c1;
    } else {
      // fallback by maf_no if older data used that path
      const { data: c2, error: cErr2 } = await SB
        .from("collections")
        .select("date_paid, payment, plan_type")
        .eq("maf_no", member.maf_no)
        .order("date_paid", { ascending: false });
      if (cErr2) throw cErr2;
      payments = Array.isArray(c2) ? c2 : [];
    }

    // 4) Totals
    const totalPaid = payments.reduce((sum, p) => sum + (Number(p.payment) || 0), 0);
    const balance = Number(member.balance) || Math.max(0, (Number(member.contracted_price)||0) - totalPaid);

    // 5) Render
    currentData = { member, agentName, payments, totalPaid, balance };
    renderSOA(currentData);

  } catch (e) {
    console.error(e);
    sheet.innerHTML = `<div class="muted">Error loading SOA. Check console.</div>`;
    showSplash("Failed to load Statement of Account.", "error");
  }
}

function renderSOA({ member, agentName, payments, totalPaid, balance }) {
  const fullName = `${member.first_name||""} ${member.last_name||""}`.trim();
  const addr = member.address || "";
  const bdate = member.birth_date || "";
  const plan = member.plan_type || "";
  const price = Number(member.contracted_price)||0;

  sheet.innerHTML = `
    <div class="sheet-grid">
      <div>
        <h2 style="margin:4px 0 8px; color:#1e293b;">Maharlikan Mortuary Care Services</h2>
        <div class="muted">Statement of Account</div>
      </div>
      <aside class="details">
        <p><strong>Customer No:</strong> ${esc(member.maf_no)}</p>
        <p><strong>Name:</strong> ${esc(fullName)}</p>
        <p><strong>Address:</strong> ${esc(addr)}</p>
        <p><strong>Birth Date:</strong> ${esc(bdate)}</p>
        <p><strong>Agent:</strong> ${esc(agentName)}</p>
      </aside>

      <div class="full">
        <table class="summary-table">
          <thead>
            <tr>
              <th>Plan Type</th>
              <th>Contracted Price</th>
              <th>Total Paid</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${esc(plan)}</td>
              <td>${peso(price)}</td>
              <td>${peso(totalPaid)}</td>
              <td>${peso(balance)}</td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:12px 0 6px; color:#1e293b;">Transaction Details</h3>
        ${payments.length ? `
          <table class="tx-table" id="txTable">
            <thead>
              <tr>
                <th style="width: 30%;">Date</th>
                <th style="width: 35%;">Payment</th>
                <th>Plan Type</th>
              </tr>
            </thead>
            <tbody>
              ${payments.map(p => `
                <tr>
                  <td>${esc(p.date_paid)}</td>
                  <td>${peso(p.payment)}</td>
                  <td>${esc(p.plan_type)}</td>
                </tr>`).join("")}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <th>${peso(totalPaid)}</th>
                <th></th>
              </tr>
            </tfoot>
          </table>
        ` : `<div class="muted">No payments found for this member.</div>`}
      </div>
    </div>
  `;
}

// Export to PDF (jsPDF + AutoTable)
async function onExportPDF() {
  if (!currentData) return showSplash("Load a member first.", "error");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "pt", "a4");

  const title = `Statement of Account — ${currentData.member.maf_no}`;
  doc.setFontSize(14);
  doc.text(title, 40, 40);

  // Summary block
  doc.setFontSize(10);
  const lines = [
    `Name: ${currentData.member.first_name||""} ${currentData.member.last_name||""}`,
    `Plan: ${currentData.member.plan_type||"-"}`,
    `Contracted Price: ${peso(currentData.member.contracted_price||0)}`,
    `Total Paid: ${peso(currentData.totalPaid||0)}`,
    `Balance: ${peso(currentData.balance||0)}`
  ];
  lines.forEach((t, i) => doc.text(t, 40, 60 + i*14));

  // Transactions
  const body = (currentData.payments||[]).map(p => [
    p.date_paid || "",
    (Number(p.payment)||0).toFixed(2),
    p.plan_type || ""
  ]);

  doc.autoTable({
    head: [["Date", "Payment", "Plan Type"]],
    body,
    startY: 140,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [11, 77, 135], textColor: 255 },
    foot: [["Total", (Number(currentData.totalPaid)||0).toFixed(2), ""]],
    footStyles: { fillColor: [241, 245, 249] }
  });

  doc.save(`SOA_${currentData.member.maf_no}.pdf`);
}
