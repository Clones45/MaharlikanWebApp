// View Collections — tailored to your schema (no joins)

const tbody    = document.getElementById('tbody');
const totalEl  = document.getElementById('totalCell');
const periodEl = document.getElementById('periodLabel');
const monthSel = document.getElementById('monthSel');
const yearSel  = document.getElementById('yearSel');
const applyBtn = document.getElementById('applyBtn');
const exportBtn= document.getElementById('exportBtn');
const printBtn = document.getElementById('printBtn');

const SB = window.SB; // created in HTML before this script

function showRowMessage(msg, kind = 'muted') {
  tbody.innerHTML = `<tr><td colspan="7" class="${kind}">${msg}</td></tr>`;
}

init().catch(e => {
  console.error('INIT ERROR:', e);
  showRowMessage('Unexpected error during initialization. Check console.', 'empty');
});

async function init() {
  if (!SB) {
    showRowMessage('Supabase not initialized on this page. Please check your app.js or keys.', 'empty');
    return;
  }
  await ensureAuth();
  setupMonthYearSelectors();
  wireEvents();
  await loadAndRender();
}

/* ---------- Auth guard ---------- */
async function ensureAuth() {
  const { data: { session }, error } = await SB.auth.getSession();
  if (error) throw error;
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('No session. Redirecting to login.');
  }
}

/* ---------- UI helpers ---------- */
function setupMonthYearSelectors() {
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
  for (let y = cy - 5; y <= cy + 1; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === cy) opt.selected = true;
    yearSel.appendChild(opt);
  }
  updatePeriodLabel();
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
  periodEl.textContent = `Collections for ${monthName} ${y}`;
}

/* Dates are plain DATEs in DB — format as YYYY-MM-DD */
function getMonthRange(year, month2) {
  const m = parseInt(month2, 10) - 1;
  const start = new Date(year, m, 1);
  const next  = new Date(year, m + 1, 1);
  const fmt = d => {
    const y = d.getFullYear();
    const mo = String(d.getMonth()+1).padStart(2,'0');
    const da = String(d.getDate()).padStart(2,'0');
    return `${y}-${mo}-${da}`;
  };
  return { gte: fmt(start), lt: fmt(next) };
}

/* ---------- Data load & render (no joins needed) ---------- */
async function loadAndRender() {
  try {
    showRowMessage('Loading…', 'muted');
    totalEl.textContent = '0.00';

    const y = yearSel.value;
    const m = monthSel.value;
    const { gte, lt } = getMonthRange(y, m);

    // Your actual columns:
    // id, maf_no, last_name, first_name, address, payment (numeric), plan_type, date_paid (date)
    const { data, error, status } = await SB
      .from('collections')
      .select('maf_no, last_name, first_name, address, plan_type, payment, date_paid')
      .gte('date_paid', gte)
      .lt('date_paid', lt)
      .order('date_paid', { ascending: false });

    if (error) {
      console.error('Collections query error:', { error, status });
      showRowMessage('Error loading collections. Check console for details.', 'empty');
      return;
    }

    if (!data || data.length === 0) {
      showRowMessage('No collections found for the selected month and year.', 'empty');
      return;
    }

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
          <td class="right">${(isFinite(amt) ? amt : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td>${fmtDate(row.date_paid)}</td>
        </tr>
      `;
    }).join('');

    totalEl.textContent = total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) {
    console.error('loadAndRender failed:', e);
    showRowMessage('Something went wrong while loading. See console for details.', 'empty');
  }
}

/* ---------- Export ---------- */
function exportToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  const m = parseInt(monthSel.value, 10);
  const y = parseInt(yearSel.value, 10);
  const title = `Collections for ${new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long' })} ${y}`;

  doc.setFontSize(14);
  doc.text(title, 14, 18);

  const head = [[ 'AF No', 'Last Name', 'First Name', 'Address', 'Plan Type', 'Amount', 'Date Collected' ]];
  const body = [];
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent || '');
    if (tds.length === 7) body.push(tds);
  });

  const total = document.getElementById('totalCell')?.textContent ?? '0.00';

  doc.autoTable({
    head,
    body,
    startY: 26,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [11, 77, 135] },
    columnStyles: { 5: { halign: 'right' } },
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
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return String(d ?? ''); }
}
