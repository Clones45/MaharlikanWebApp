// soa.js — Supabase-powered Statement of Account
let SB = null;

/* ---------- Supabase Loader ---------- */
async function ensureSupabase() {
  if (window.SB) return window.SB;
  let env = null;
  if (window.electronAPI?.getEnv) {
    try { env = await window.electronAPI.getEnv(); } catch { }
  }
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    if (window.__ENV__) env = window.__ENV__;
  }
  if (env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
    window.SB = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,  // ✅ ENABLE: Auto-refresh tokens
        detectSessionInUrl: false
      },
    });

    // Session fix
    const params = new URLSearchParams(window.location.search);
    const token = params.get("access_token");
    const refresh = params.get("refresh_token");
    if (token && refresh) {
      await window.SB.auth.setSession({ access_token: token, refresh_token: refresh });
    }

    return window.SB;
  }
  return null;
}
async function getSB() {
  let sb = await ensureSupabase();
  if (sb) return sb;
  for (let i = 0; i < 30 && !sb; i++) {
    await new Promise(r => setTimeout(r, 100));
    sb = await ensureSupabase();
  }
  return sb;
}
/* ---------- DOM Elements ---------- */
const sheet = document.getElementById("sheet");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const exportBtn = document.getElementById("exportBtn");
const printBtn = document.getElementById("printBtn");

/* ---------- Toast ---------- */
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = type === 'error' ? '#d33' : '#2d6';
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2500);
}

/* ---------- Helpers ---------- */
const peso = n => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Event Listeners ---------- */
searchBtn.addEventListener("click", onSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") onSearch(e); });
printBtn.addEventListener("click", () => window.print());
exportBtn.addEventListener("click", onExportPDF);

/* ---------- Search Logic ---------- */
let currentData = null;

async function onSearch(e) {
  if (e) e.preventDefault(); // ⛔ Prevent page reload

  SB = await getSB();
  if (!SB) {
    toast("Supabase not found", "error");
    return;
  }

  const q = searchInput.value.trim();
  if (!q) return toast("Enter AF/MAF No. or Name", "error");

  sheet.innerHTML = `<div class="muted">Loading…</div>`;

  try {
    // 1. Construct flexible query
    // Split by spaces to handle "First Last"
    const terms = q.split(/\s+/).filter(t => t.length > 0);

    // Base query: always check MAF
    let orQuery = `maf_no.ilike.%${q}%`;

    // Add first/last name checks for each term
    terms.forEach(t => {
      orQuery += `,first_name.ilike.%${t}%,last_name.ilike.%${t}%`;
    });

    const { data: members, error: mErr } = await SB
      .from("members")
      .select("id, maf_no, first_name, last_name, plan_type, membership")
      .or(orQuery)
      .limit(50); // Fetch more candidates

    if (mErr) throw mErr;

    if (!members?.length) {
      sheet.innerHTML = `<div class="muted">No member found for “${esc(q)}”.</div>`;
      return;
    }

    // 2. Filter & Rank in JS
    // We want to prioritize members that match ALL terms or the full string
    const qLower = q.toLowerCase();

    const scored = members.map(m => {
      let score = 0;
      const full = `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase();
      const maf = (m.maf_no || '').toLowerCase();

      // Exact MAF match (highest priority)
      if (maf === qLower) score += 1000;
      else if (maf.includes(qLower)) score += 500;

      // Full name exact/partial match
      if (full === qLower) score += 800;
      else if (full.includes(qLower)) score += 400;

      // Check how many terms match
      let termsMatched = 0;
      terms.forEach(t => {
        const tLow = t.toLowerCase();
        if (full.includes(tLow) || maf.includes(tLow)) termsMatched++;
      });

      score += (termsMatched * 50);

      return { m, score };
    });

    // Sort by score desc
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 1) {
      // ✅ Direct match: Redirect to the Landscape SOA
      openSOA(scored[0].m.maf_no);
    } else {
      // If the top result is very strong, auto-redirect
      if (scored[0].score >= 1000 && (scored.length === 1 || scored[1].score < 500)) {
        openSOA(scored[0].m.maf_no);
      } else {
        renderSelectionList(scored.map(s => s.m));
      }
    }

  } catch (err) {
    console.error(err);
    toast("Error loading SOA", "error");
  }
}

function openSOA(mafNo) {
  // Redirect to the full Landscape SOA page using MAF NO
  window.location.href = `view_soa.html?member_id=${mafNo}`;
}

function renderSelectionList(members) {
  sheet.innerHTML = `
    <div class="section-title">Multiple members found. Please select one:</div>
    <table class="member-table" style="margin-top:10px; cursor:pointer;">
      <thead>
        <tr>
          <th>AF No.</th>
          <th>Name</th>
          <th>Plan</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${members.map(m => `
          <tr onclick="window.openSOA('${m.maf_no}')" class="hover-row">
            <td>${esc(m.maf_no)}</td>
            <td>${esc(m.first_name)} ${esc(m.last_name)}</td>
            <td>${esc(m.plan_type)}</td>
            <td>${esc(m.membership)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Expose helper for the inline onclick
  window.loadMemberById = (id) => {
    const mem = members.find(x => x.id == id);
    if (mem) loadMemberSOA(mem);
  };
}

async function loadMemberSOA(member) {
  sheet.innerHTML = `<div class="muted">Loading details for ${esc(member.first_name)}...</div>`;

  try {
    // Agent
    let agentName = "";
    if (member.agent_id) {
      const { data: agent } = await SB
        .from("agents")
        .select("firstname, lastname")
        .eq("id", member.agent_id)
        .maybeSingle();
      if (agent) agentName = `${agent.lastname || ""}, ${agent.firstname || ""}`.trim();
    }

    // Collections
    const { data: cdata } = await SB
      .from("collections")
      .select("date_paid, payment, plan_type, or_no, payment_for")
      .eq("member_id", member.id)
      .order("date_paid", { ascending: false });

    const payments = Array.isArray(cdata) ? cdata : [];
    const totalPaid = payments.reduce((s, p) => s + (Number(p.payment) || 0), 0);
    // Always compute balance dynamically from totalPaid
    const contracted = Number(member.contracted_price) || 0;
    const balance = Math.max(0, contracted - totalPaid);

    // Installment Paid (Total Paid ÷ Monthly Due)
    const monthlyDue = Number(member.monthly_due) || 0;
    const installmentPaid = monthlyDue > 0 ? totalPaid / monthlyDue : 0;

    currentData = { member, agentName, payments, totalPaid, balance, installmentPaid };
    renderSOA(currentData);
  } catch (e) {
    console.error(e);
    toast("Failed to load member details", "error");
  }
}

/* ---------- Render SOA ---------- */
function renderSOA({ member, agentName, payments, totalPaid, balance, installmentPaid }) {
  const fullName = `${member.first_name || ""} ${member.last_name || ""}`;
  const plan = member.plan_type || "";
  const price = Number(member.contracted_price) || 0;

  sheet.innerHTML = `
    <div>
      <table class="member-table">
        <thead>
          <tr>
            <th>Plan Type</th>
            <th>Contracted Price</th>
            <th>Total Paid</th>
            <th>Installment Paid</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${esc(plan)}</td>
            <td>${peso(price)}</td>
            <td>${peso(totalPaid)}</td>
            <td>${installmentPaid.toFixed(2)} mo.</td>
            <td>${peso(Math.max(0, price - totalPaid))}</td>
          </tr>
        </tbody>
      </table>

      <div class="section-title">Transaction Details</div>
      ${payments.length ? `
        <table class="tx-table">
          <thead>
            <tr>
              <th>Date</th><th>OR No.</th><th>Payment</th><th>Payment For</th><th>Plan Type</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${esc(p.date_paid)}</td>
                <td>${esc(p.or_no || "-")}</td>
                <td>${peso(p.payment)}</td>
                <td>${esc(p.payment_for === "membership" ? "Membership Fee" : "Regular / Monthly")}</td>
                <td>${esc(p.plan_type)}</td>
              </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr><th colspan="2">Total</th><th>${peso(totalPaid)}</th><th colspan="2"></th></tr>
          </tfoot>
        </table>
      ` : `<div class="muted">No payments found for this member.</div>`}
    </div>
  `;
}

/* ---------- Export PDF (with Signatures) ---------- */
async function onExportPDF() {
  if (!currentData) return toast("Load a member first.", "error");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "pt", "a4");

  const fmt = n => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const yStart = 50;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Statement of Account", 40, yStart);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`AF No: ${currentData.member.maf_no}`, 40, yStart + 20);
  doc.text(`Generated: ${new Date().toISOString().split("T")[0]}`, 220, yStart + 20);

  doc.autoTable({
    startY: yStart + 45,
    theme: "grid",
    head: [["Name", "Address", "Plan", "Birth Date", "Agent"]],
    body: [[
      `${currentData.member.first_name || ""} ${currentData.member.last_name || ""}`,
      currentData.member.address || "",
      currentData.member.plan_type || "",
      currentData.member.birth_date || "",
      currentData.agentName || ""
    ]],
    styles: { fontSize: 9, halign: "left" }, headStyles: { fillColor: [245, 245, 245] }
  });

  const summaryY = doc.lastAutoTable.finalY + 25;
  doc.text("Summary", 40, summaryY);
  doc.autoTable({
    startY: summaryY + 8,
    theme: "plain",
    head: [["Contracted Price", "Total Paid", "Installment Paid", "Balance"]],
    body: [[
      fmt(currentData.member.contracted_price),
      fmt(currentData.totalPaid),
      `${currentData.installmentPaid.toFixed(2)} mo.`,
      fmt(currentData.balance)
    ]],
    styles: { fontSize: 10, halign: "center" },
    headStyles: { fillColor: [38, 50, 72], textColor: 255 }
  });

  const txY = doc.lastAutoTable.finalY + 25;
  doc.text("Transaction Details", 40, txY);
  const body = currentData.payments.map(p => [
    p.date_paid || "", p.or_no || "-", fmt(p.payment),
    p.payment_for === "membership" ? "Membership Fee" : "Regular / Monthly",
    p.plan_type || ""
  ]);
  doc.autoTable({
    startY: txY + 8,
    theme: "striped",
    head: [["Date", "OR No.", "Payment", "Payment For", "Plan Type"]],
    body,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [38, 50, 72], textColor: 255 },
    foot: [["", "", "Total " + fmt(currentData.totalPaid), "", ""]]
  });

  // Footer + Signature Section
  const footerY = doc.lastAutoTable.finalY + 30;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Maharlikan Mortuary Care Services • Generated automatically by the system", 40, footerY);

  let signY = footerY + 50;
  if (signY > 720) signY = 720;

  doc.setDrawColor(0);
  doc.setLineWidth(0.6);

  const lineWidth = 180;
  const leftX = 60;
  const rightX = 340;

  doc.line(leftX, signY, leftX + lineWidth, signY);
  doc.line(rightX, signY, rightX + lineWidth, signY);

  doc.setFontSize(10);
  doc.setTextColor(50);
  doc.text("Agent Signature", leftX + 40, signY + 15);
  doc.text("Member Signature", rightX + 40, signY + 15);

  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(currentData.agentName || "", leftX + 40, signY + 30);
  doc.text(`${currentData.member.first_name || ""} ${currentData.member.last_name || ""}`, rightX + 40, signY + 30);

  doc.save(`SOA_${currentData.member.maf_no}.pdf`);
}
