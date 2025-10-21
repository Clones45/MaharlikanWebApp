// view_commissions.js — Commission dashboard (month/year filters, totals, export)

const SB = window.SB; // (not used; we create client below)
const tbody    = document.getElementById('tbody');
const tM       = document.getElementById('tMonthly');
const tO       = document.getElementById('tOutright');
const tR       = document.getElementById('tRecruiter');
const tG       = document.getElementById('tGrand');
const periodEl = document.getElementById('periodLabel');
const monthSel = document.getElementById('monthSel');
const yearSel  = document.getElementById('yearSel');
const applyBtn = document.getElementById('applyBtn');
const exportBtn= document.getElementById('exportBtn');
const printBtn = document.getElementById('printBtn');

let supabase = null;

const toastEl = (() => {
  const x = document.getElementById('toast') || document.createElement('div');
  if (!x.id) { x.id = 'toast'; document.body.appendChild(x); }
  x.classList.add('toast');
  return x;
})();
function toast(msg){
  toastEl.textContent = msg || '';
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> toastEl.classList.remove('show'), 2400);
}

init().catch(e => {
  console.error('INIT ERROR:', e);
  setRows([['Error', '', '', '', 'Check console']]);
});

async function init(){
  // Create Supabase client from env (Electron preload or inline __ENV__)
  let env = null;
  if (window.electronAPI?.getEnv) {
    try { env = await window.electronAPI.getEnv(); } catch {}
  }
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) { if (window.__ENV__) env = window.__ENV__; }

  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    setRows([['Supabase not configured', '', '', '', '']]);
    return;
  }

  if (!window.supabase?.createClient) {
    setRows([['Supabase SDK not loaded', '', '', '', '']]);
    return;
  }

  supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  // Make sure session exists
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    setRows([['Not signed in', '', '', '', '']]);
    return;
  }

  setupSelectors();
  wireEvents();
  await loadAndRender();
}

function setupSelectors(){
  const now = new Date();
  const cm = now.getMonth() + 1;
  const cy = now.getFullYear();

  monthSel.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = String(m).padStart(2,'0');
    opt.textContent = new Date(2020, m-1, 1).toLocaleString(undefined,{month:'long'});
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

function wireEvents(){
  applyBtn.addEventListener('click', loadAndRender);
  exportBtn.addEventListener('click', exportToPDF);
  printBtn.addEventListener('click', () => window.print());
  monthSel.addEventListener('change', updatePeriodLabel);
  yearSel.addEventListener('change', updatePeriodLabel);
}

function updatePeriodLabel(){
  const m = parseInt(monthSel.value, 10);
  const y = parseInt(yearSel.value, 10);
  periodEl.textContent = `${new Date(y, m-1, 1).toLocaleString(undefined,{month:'long'})} ${y}`;
}

function rangeForMonth(year, month2){
  const m = parseInt(month2, 10) - 1;
  const start = new Date(year, m, 1);
  const next  = new Date(year, m+1, 1);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { gte: fmt(start), lt: fmt(next) };
}

function setRows(rows){
  if (!rows || rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center">No commissions for this period.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${esc(r[0])}</td>
      <td>${esc(r[1])}</td>
      <td>${esc(r[2])}</td>
      <td>${esc(r[3])}</td>
      <td class="right">${Number(r[4]||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    </tr>
  `).join('');
}

function esc(s){
  return (s==null?'':String(s))
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
}

async function loadAndRender(){
  try{
    setRows(null);
    tM.textContent = tO.textContent = tR.textContent = tG.textContent = '₱0.00';

    const y = yearSel.value;
    const m = monthSel.value;
    const { gte, lt } = rangeForMonth(y, m);

    // 1) Fetch commissions for this month (no expensive joins)
    const { data: comms, error, status } = await supabase
      .from('commissions')
      .select('agent_id, commission_type, plan_type, amount, date_earned')
      .gte('date_earned', gte)
      .lt('date_earned', lt)
      .order('date_earned', { ascending: true });

    if (error) {
      console.error('Commissions query error:', { error, status });
      setRows([['Error loading commissions', '', '', '', '']]);
      return;
    }
    if (!comms || comms.length === 0) { setRows([]); return; }

    // 2) Resolve agent names from agents table (single small fetch)
const idSet = Array.from(new Set(comms.map(c => c.agent_id).filter(Boolean)));
let nameMap = {};
if (idSet.length){
  const { data: agents } = await supabase
    .from('agents')
    .select('id, firstname, lastname')
    .in('id', idSet);

  (agents || []).forEach(a => {
    const full = `${a.lastname?.toUpperCase() || ''}, ${a.firstname || ''}`.trim();
    nameMap[a.id] = full || `Agent #${a.id}`;
  });
}

    // 3) Build rows + totals
    let sumMonthly = 0, sumOutright = 0, sumRecruiter = 0, sumGrand = 0;

    const rows = comms.map(c => {
      const dateStr = fmtDate(c.date_earned);
      const agent = nameMap[c.agent_id] || (c.agent_id ? `Agent #${c.agent_id}` : '—');
      const typeLbl = labelType(c.commission_type);
      const plan = (c.plan_type || '').toUpperCase();

      const amt = Number(c.amount||0);
      if (c.commission_type === 'plan_monthly' || c.commission_type === 'membership_monthly') sumMonthly += amt;
      else if (c.commission_type === 'plan_outright' || c.commission_type === 'membership_outright') sumOutright += amt;
      else if (c.commission_type === 'recruiter_monthly' || c.commission_type === 'membership_recruiter') sumRecruiter += amt;

      sumGrand += amt;

      return [dateStr, agent, typeLbl, plan, amt];
    });

    setRows(rows);

    tM.textContent = peso(sumMonthly);
    tO.textContent = peso(sumOutright);
    tR.textContent = peso(sumRecruiter);
    tG.textContent = peso(sumGrand);

  }catch(e){
    console.error('loadAndRender failed:', e);
    setRows([['Something went wrong loading data', '', '', '', '']]);
  }
}

function fmtDate(d){
  try{
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d ?? '');
    return dt.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'});
  }catch{
    return String(d ?? '');
  }
}

function labelType(t){
  switch (t) {
    case 'plan_monthly': return 'Plan Monthly';
    case 'plan_outright': return 'Plan Outright';
    case 'recruiter_monthly': return 'Recruiter (10%)';
    case 'membership_outright': return 'Membership Outright';
    case 'membership_monthly': return 'Membership Monthly';
    case 'membership_recruiter': return 'Membership Recruiter (10%)';
    default: return t || '';
  }
}

function peso(n){ return '₱' + Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

/* ---------- Export ---------- */
function exportToPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  const m = parseInt(monthSel.value, 10);
  const y = parseInt(yearSel.value, 10);
  const title = `Commission Summary — ${new Date(y, m-1, 1).toLocaleString(undefined,{month:'long'})} ${y}`;

  doc.setFontSize(14);
  doc.text(title, 14, 18);

  const head = [[ 'Date Earned', 'Agent', 'Type', 'Plan', 'Amount' ]];
  const body = [];
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent || '');
    if (tds.length === 5) body.push(tds);
  });

  doc.autoTable({
    head, body,
    startY: 26,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [11, 77, 135] },
    columnStyles: { 4: { halign: 'right' } },
    margin: { left: 10, right: 10 }
  });

  const yAfter = (doc.lastAutoTable?.finalY || 26) + 6;
  doc.setFontSize(11);
  doc.text(`Monthly: ${tM.textContent}   Outright: ${tO.textContent}   Recruiter: ${tR.textContent}   Total: ${tG.textContent}`, 10, yAfter);

  doc.save(`commissions_${title.replace(/\s+/g,'_')}.pdf`);
}
