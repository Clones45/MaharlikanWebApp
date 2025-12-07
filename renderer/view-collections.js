// =======================================
// View Collections — Maharlikan (Collection-Month Accurate Version)
// =======================================

const tbody = document.getElementById('tbody');
const totalEl = document.getElementById('totalCell');
const periodEl = document.getElementById('periodLabel');
const monthSel = document.getElementById('monthSel');
const yearSel = document.getElementById('yearSel');
const applyBtn = document.getElementById('applyBtn');
const exportBtn = document.getElementById('exportBtn');
const printBtn = document.getElementById('printBtn');

const SB = window.SB;

/* ---------- Helpers ---------- */
function showRowMessage(msg, kind = 'muted') {
  tbody.innerHTML = `<tr><td colspan="9" class="${kind}">${msg}</td></tr>`;
}

/* ---------- Init ---------- */
const now = new Date();

init().catch(e => {
  console.error('INIT ERROR:', e);
  showRowMessage('Unexpected error during initialization. Check console.', 'empty');
});

async function init() {
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
  for (let y = cy - 5; y <= cy + 1; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === cy) opt.selected = true;
    yearSel.appendChild(opt);
  }

  updatePeriodLabel();
  wireEvents();
  await loadAndRender();
}

function wireEvents() {
  applyBtn.addEventListener('click', loadAndRender);
  exportBtn.addEventListener('click', exportToPDF);
  printBtn.addEventListener('click', () => window.print());
  monthSel.addEventListener('change', updatePeriodLabel);
  yearSel.addEventListener('change', updatePeriodLabel);
}

function updatePeriodLabel() {
  const m = parseInt(monthSel.value, 10);
  const y = parseInt(yearSel.value, 10);
  const monthName = new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long' });
  periodEl.textContent = `Collections Reflected for ${monthName} ${y} (Cutoff: 7th - 6th)`;
}

/* ---------- Data Load & Render (collection_month accurate) ---------- */
async function loadAndRender() {
  try {
    console.log("🔄 loadAndRender() triggered");
    showRowMessage('Loading…', 'muted');
    totalEl.textContent = '0.00';

    const y = yearSel.value;
    const m = monthSel.value;
    const targetMonth = `${y}-${m}`; // e.g. "2025-11"

    console.log("📅 Selected Month-Year:", targetMonth);

    // Ensure SB is valid
    if (!SB || !SB.from) {
      console.error("❌ Supabase client not found:", SB);
      showRowMessage('Supabase client missing.', 'empty');
      return;
    }

    // 📅 Cutoff Logic: 7th of selected month -> 6th of NEXT month
    // Example: "November Collection" = Nov 7 - Dec 6
    // NOTE: User said "from november 7 - december 6 it should be store in my november collection"

    const [yNum, mNum] = targetMonth.split('-').map(Number);

    // JS Months are 0-indexed (0=Jan, 10=Nov, 11=Dec)
    // mNum is 1-indexed (11 for Nov)
    // So "November" in Date obj is (yNum, mNum - 1)

    // Start Date: 7th of current month
    const startObj = new Date(yNum, mNum - 1, 7);

    // End Date: 6th of NEXT month
    const endObj = new Date(yNum, mNum, 6); // mNum is "next month" index because 0-based index matches 1-based next month

    // Format YYYY-MM-DD
    const toISODate = (d) => {
      const year = d.getFullYear();
      const mon = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${mon}-${day}`;
    };

    const startDate = toISODate(startObj);
    const endDate = toISODate(endObj);

    console.log(`📅 Cutoff Range for ${targetMonth}: ${startDate} to ${endDate}`);

    // 🔍 Query: Strictly match date_paid within the cutoff range
    const { data, error } = await SB
      .from('collections')
      .select('maf_no, last_name, first_name, address, plan_type, payment, or_no, payment_for, date_paid, collection_month')
      .gte('date_paid', startDate)
      .lte('date_paid', endDate)
      .order('date_paid', { ascending: false });

    console.log("✅ Supabase returned:", data);

    if (error) {
      console.error('❌ Query error:', error);
      showRowMessage('Error loading collections. Check console.', 'empty');
      return;
    }

    if (!data || data.length === 0) {
      console.warn(`⚠️ No collections found for ${targetMonth}.`);
      showRowMessage(`No collections found for ${targetMonth}.`, 'empty');
      return;
    }

    // 🧮 Build rows + total
    let total = 0;
    tbody.innerHTML = data.map(row => {
      const amt = Number(row.payment ?? 0);
      total += isFinite(amt) ? amt : 0;
      return `
        <tr>
          <td>${esc(row.maf_no ?? '')}</td>
          <td>${esc(row.last_name ?? '')}</td>
          <td>${esc(row.first_name ?? '')}</td>
          <td>${esc(row.address ?? '')}</td>
          <td>${esc(row.plan_type ?? '')}</td>
          <td>${esc(row.or_no ?? '')}</td>
          <td class="right">${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td>${esc(row.payment_for ?? '')}</td>
          <td>${fmtDate(row.date_paid)}</td>
        </tr>
      `;
    }).join('');

    totalEl.textContent = total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    console.log("✅ Render complete. Total:", total);

  } catch (e) {
    console.error('💥 loadAndRender failed:', e);
    showRowMessage('Something went wrong. See console for details.', 'empty');
  }
}



/* ---------- Export ---------- */
function exportToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  const m = parseInt(monthSel.value, 10);
  const y = parseInt(yearSel.value, 10);
  const title = `Collections Reflected for ${new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long' })} ${y}`;

  doc.setFontSize(14);
  doc.text(title, 14, 18);

  const head = [[
    'AF No', 'Last Name', 'First Name', 'Address',
    'Plan Type', 'OR No', 'Amount', 'Payment Type', 'Date Collected'
  ]];
  const body = [];
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent || '');
    if (tds.length >= 9) body.push(tds);
  });

  const total = document.getElementById('totalCell')?.textContent ?? '0.00';

  doc.autoTable({
    head,
    body,
    startY: 26,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [11, 77, 135] },
    columnStyles: { 6: { halign: 'right' } },
    margin: { left: 10, right: 10 }
  });

  const yAfter = (doc.lastAutoTable?.finalY || 26) + 6;
  doc.setFontSize(11);
  doc.text(`Total: ${total}`, 10, yAfter);

  doc.save(`collections_${title.replace(/\s+/g, '_')}.pdf`);
}

/* ---------- Utils ---------- */
function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d ?? '');
    return dt.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  } catch {
    return String(d ?? '');
  }
}
