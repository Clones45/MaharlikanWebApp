let supabaseClient = null, env = null;

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const setMsg = (t) => { const el = qs('#statusText'); if (el) el.textContent = t || ''; };

const agentsMap = new Map();
const beneficiariesMap = new Map();

// Global State
// Global State
let _allMembers = [];
let _cachedAllMembers = []; // store original full list to restore after lapsed filter
let _currentPage = 1;
const ITEMS_PER_PAGE = 10;
const PAGE = 1000; // pull big pages automatically until done

function esc(v) { return (v == null) ? '' : String(v); }
function money(v) { if (v == null || v === '') return ''; const n = Number(v); return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v); }

async function boot() {
  try {
    // env from preload or window.__ENV__
    env = null;
    if (window.electronAPI?.getEnv) { try { env = await window.electronAPI.getEnv(); } catch { } }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) { if (window.__ENV__) env = window.__ENV__; }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) { setMsg('Missing Supabase env.'); return; }
    if (!window.supabase?.createClient) { setMsg('Supabase SDK missing.'); return; }

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
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: memoryStorage
      },
    });

    console.log("[view_members] Supabase client initialized (no session required)");

    wire();
    await loadAgentsMap();
    await loadAllMembers();
    setMsg('');

  } catch (e) {
    console.error(e);
    setMsg('Init failed: ' + (e.message || e));
  }
}

function wire() {
  qs('#printBtn')?.addEventListener('click', () => window.print());
  qs('#refreshBtn')?.addEventListener('click', () => { location.reload(); });

  qs('#toggleBeneficiariesBtn')?.addEventListener('click', () => {
    const rows = qsa('.beneficiaries-row');
    const first = rows[0];
    const show = !first || first.style.display === '' || first.style.display === 'none';
    // Update button text - renderTable will handle visibility
    qs('#toggleBeneficiariesBtn').textContent = show ? 'Hide Beneficiaries' : 'Show Beneficiaries';
    renderTable(); // Re-render to apply visibility to current page
  });

  qs('#searchInput')?.addEventListener('keyup', () => {
    _currentPage = 1; // Reset to page 1 on search
    renderTable();
  });

  qs('#closeBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.close();
  });

  // Filter Buttons
  const fLapsed = qs('#filterLapsedBtn');
  const fCard = qs('#filterCardBtn');
  const fDef = qs('#filterDeferredBtn');
  const fNon = qs('#filterNonDeferredBtn');
  const fActive = qs('#filterActiveBtn');
  const fWarning = qs('#filterWarningBtn');
  const fAtRisk = qs('#filterAtRiskBtn');

  function setActive(btn, name) {
    if (window._currentFilter === name) {
      // toggle off
      window._currentFilter = null;
      btn.style.background = '#2d3748'; // default
      // If we were in LAPSED or AT_RISK mode, restore the full member list
      if (name === 'LAPSED' || name === 'AT_RISK') {
        _allMembers = [..._cachedAllMembers];
        setMsg('Restored full member list.');
      }
    } else {
      // If we are switching FROM Lapsed/AtRisk/Warning/Active TO something else, restore first
      if (window._currentFilter === 'LAPSED' || window._currentFilter === 'AT_RISK' || window._currentFilter === 'WARNING' || window._currentFilter === 'ACTIVE') {
        _allMembers = [..._cachedAllMembers];
      }

      // set new
      window._currentFilter = name;
      // reset others
      [fLapsed, fCard, fDef, fNon, fAtRisk, fWarning, fActive].forEach(b => {
        if (b) {
          b.style.background = '#2d3748';
          b.style.border = '0';
          if (b.id === 'filterLapsedBtn') b.style.border = '1px solid #ef4444'; // keep red border hint
        }
      });

      btn.style.background = '#4f8cff'; // active

      if (name === 'LAPSED') {
        btn.style.border = '1px solid #b91c1c';
        loadLapsedMembers();
        return;
      }

      if (name === 'AT_RISK') {
        btn.style.background = '#fbbf24'; // Yellow active
        btn.style.color = '#1f2937';
        loadAtRiskMembers();
        return;
      }

      if (name === 'WARNING') {
        btn.style.background = '#f59e0b'; // Amber active
        btn.style.color = '#fff';
        loadWarningMembers();
        return;
      }

      if (name === 'ACTIVE') {
        btn.style.background = '#22c55e'; // Green active
        btn.style.color = '#fff';
        loadActiveMembers();
        return;
      }
    }
    _currentPage = 1;
    renderTable();
  }

  fLapsed?.addEventListener('click', () => setActive(fLapsed, 'LAPSED'));
  fCard?.addEventListener('click', () => setActive(fCard, 'MS'));
  fDef?.addEventListener('click', () => setActive(fDef, 'DEFERRED'));
  fNon?.addEventListener('click', () => setActive(fNon, 'NON_DEFERRED'));
  fActive?.addEventListener('click', () => setActive(fActive, 'ACTIVE'));
  fWarning?.addEventListener('click', () => setActive(fWarning, 'WARNING'));
  fAtRisk?.addEventListener('click', () => setActive(fAtRisk, 'AT_RISK'));

  // Pagination
  qs('#prevPageBtn')?.addEventListener('click', () => changePage(-1));
  qs('#nextPageBtn')?.addEventListener('click', () => changePage(1));
}

function changePage(delta) {
  _currentPage += delta;
  renderTable();
}

function renderTable() {
  const term = (qs('#searchInput').value || '').toLowerCase();
  const filter = window._currentFilter; // 'CARD', 'DEFERRED', 'NON_DEFERRED' or null
  const btnText = qs('#toggleBeneficiariesBtn')?.textContent || '';
  const beneVisible = btnText.includes('Hide');

  // 1. Filter Data
  const filtered = _allMembers.filter(m => {
    // Search Term
    // Optimization: construct text once if needed, or check properties directly
    const text = [
      m.maf_no, m.last_name, m.first_name, m.middle_name,
      m.address, m.plan_type, agentName(m.agent_id)
    ].join(' ').toLowerCase();

    if (term && !text.includes(term)) return false;

    // Filter Buttons
    if (!filter) return true;

    // Calculate Installments Paid
    // Formula: (Contracted - Balance) / Monthly Due
    const cPrice = Number(m.contracted_price) || 0;
    const bal = Number(m.balance) || 0;
    const mDue = Number(m.monthly_due) || 0;
    let paid = 0;
    if (mDue > 0) paid = (cPrice - bal) / mDue;

    if (filter === 'MS') {
      if ((m.plan_type || '').toUpperCase() !== 'MS') return false;
    } else if (filter === 'DEFERRED') {
      // Exclude MS, include only if paid <= 12
      if ((m.plan_type || '').toUpperCase() === 'MS') return false;
      if (paid > 12) return false;
    } else if (filter === 'NON_DEFERRED') {
      // Exclude MS, include only if paid >= 13
      if ((m.plan_type || '').toUpperCase() === 'MS') return false;
      if (paid < 13) return false;
    }
    return true;
  });

  // 2. Pagination Logic
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
  if (_currentPage < 1) _currentPage = 1;
  if (_currentPage > totalPages) _currentPage = totalPages;

  const start = (_currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const pageItems = filtered.slice(start, end);

  // 3. Render Rows
  const tbody = qs('#membersTbody');
  tbody.innerHTML = '';

  pageItems.forEach(m => {
    // Ensure months_behind is available
    // Ensure months_behind is available
    let mb = m.months_behind;
    if (mb == undefined || mb == null) {
      mb = 0; // Default to 0 if missing, though RPC guarantees it
    }

    // Determine status badge
    let statusHtml = '';

    // Check for COMPLETED first
    if ((Number(m.balance) || 0) <= 0) {
      statusHtml = '<span class="badge-active" style="background-color: #22c55e; color: white;">COMPLETED</span>';
    } else if (mb > 3) {
      statusHtml = '<span class="badge-lapsed">LAPSED</span>';
    } else if (mb >= 2) {
      statusHtml = '<span class="badge-at-risk">AT RISK</span>';
    } else if (mb >= 1) {
      statusHtml = '<span class="badge-warning">WARNING</span>';
    } else {
      // Logic for Active (< 1 month behind)
      statusHtml = '<span class="badge-active">ACTIVE</span>';
    }

    // Row Highlighting based on status
    // Row Highlighting based on status
    const tr = document.createElement('tr');
    if ((Number(m.balance) || 0) <= 0) tr.className = 'row-active'; // Completed is considered active/good
    else if (mb > 3) tr.className = 'row-lapsed';
    else if (mb >= 2) tr.className = 'row-at-risk';
    else if (mb >= 1) tr.className = 'row-warning';
    else tr.className = 'row-active';

    tr.innerHTML = `
        <td>${esc(m.maf_no)}</td>
        <td>${esc(m.last_name)}</td>
        <td>${esc(m.first_name)}</td>
        <td>${esc(m.middle_name)}</td>
        <td>${esc(m.address)}</td>
        <td>${esc(m.phone_number)}</td>
        <td>${esc(m.religion)}</td>
        <td>${esc(m.birth_date)}</td>
        <td>${esc(m.age)}</td>
        <td>${money(m.monthly_due)}</td>
        <td>${esc(m.plan_type)}</td>
        <td>${money(m.contracted_price)}</td>
        <td>${esc(m.date_joined)}</td>
        <td>${money(m.balance)}</td>
        <td>${esc(m.gender)}</td>
        <td>${esc(m.civil_status)}</td>
        <td>${esc(m.zipcode)}</td>
        <td>${esc(m.birthplace)}</td>
        <td>${esc(m.nationality)}</td>
        <td>${esc(m.height)}</td>
        <td>${esc(m.weight)}</td>
        <td>${esc(m.casket_type)}</td>
        <td>${esc(m.membership)}</td>
        <td>${esc(m.occupation)}</td>
        <td>${esc(agentName(m.agent_id))}</td>
      `;

    tbody.appendChild(tr);

    // Beneficiaries Row
    const beneTr = document.createElement('tr');
    beneTr.className = 'beneficiaries-row';
    beneTr.dataset.memberId = m.id;
    // Visibility
    beneTr.style.display = beneVisible ? 'table-row' : 'none';

    const list = beneficiariesMap.get(m.id) || [];
    const tbdContent = !list.length
      ? `<tr><td colspan="7">No beneficiaries</td></tr>`
      : list.map(b => `
            <tr>
              <td>${esc(b.relation)}</td>
              <td>${esc(b.last_name)}</td>
              <td>${esc(b.first_name)}</td>
              <td>${esc(b.middle_name)}</td>
              <td>${esc(b.birth_date)}</td>
              <td>${esc(b.age)}</td>
              <td>${esc(b.address)}</td>
            </tr>`).join('');

    beneTr.innerHTML = `
      <td colspan="25">
        <table class="inner-beneficiaries-table">
          <thead>
            <tr>
              <th>Relation</th>
              <th>Last Name</th>
              <th>First Name</th>
              <th>Middle Name</th>
              <th>Birth Date</th>
              <th>Age</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>${tbdContent}</tbody>
        </table>
      </td>`;
    tbody.appendChild(beneTr);
  });

  // 4. Update Controls
  const prev = qs('#prevPageBtn');
  const next = qs('#nextPageBtn');
  const ind = qs('#pageIndicator');

  if (prev) prev.disabled = _currentPage === 1;
  if (next) next.disabled = _currentPage === totalPages;
  if (ind) ind.textContent = `Page ${_currentPage} of ${totalPages} (${filtered.length} total)`;

  FLOAT_HSCROLL.sync();
}

/**
 * Calculates months_behind for a member.
 * Logic: (MonthsSinceStart) - (InstallmentsPaid)
 */
function calculateMonthsBehind(m) {
  let startDateStr = m.plan_start_date || m.date_joined;
  let start = startDateStr ? new Date(startDateStr) : new Date();
  if (isNaN(start.getTime())) start = new Date();

  const now = new Date();

  // Calculate Months Since Start
  let monthsSince = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  // Adjust if today is before the start day-of-month
  if (now.getDate() < start.getDate()) {
    monthsSince--;
  }
  if (monthsSince < 0) monthsSince = 0;

  // Calculate Installments Paid
  const cPrice = Number(m.contracted_price) || 0;
  const bal = Number(m.balance) || 0;
  const mDue = Number(m.monthly_due) || 0;

  let paidCount = 0;
  if (mDue > 0 && cPrice > 0) {
    const paidAmount = cPrice - bal;
    paidCount = paidAmount / mDue;
  }

  let behind = monthsSince - paidCount;
  return behind;
}

async function loadAgentsMap() {
  agentsMap.clear();
  try {
    const { data, error } = await supabaseClient
      .from('agents')
      .select('id, lastname, firstname')
      .order('lastname', { ascending: true });
    if (error) throw error;
    (data || []).forEach(a => {
      const name = [a.lastname || '', a.firstname || ''].filter(Boolean).join(', ');
      agentsMap.set(a.id, name || `#${a.id} `);
    });
  } catch (e) {
    console.warn('[agents map]', e.message);
  }
}

function agentName(agent_id) {
  if (agent_id == null) return '';
  const k = Number(agent_id);
  return agentsMap.get(k) || `#${agent_id} `;
}

async function loadAllMembers() {
  setMsg('Loading members…');
  _allMembers = []; // Reset global list

  let from = 0, total = 0, allIds = [];

  while (true) {
    const { data: members, error } = await supabaseClient
      .rpc('get_all_members_expanded', { p_offset: from, p_limit: PAGE });

    if (error) throw error;
    const rows = members || [];
    if (!rows.length) break;

    // Process rows - months_behind is now pre-calculated by the RPC
    const processed = rows;

    // collect member ids for bene fetch
    allIds.push(...processed.map(r => r.id));
    _allMembers.push(...processed);

    total += processed.length;
    from += processed.length;
    setMsg(`Loaded ${total} member(s)…`);
    if (processed.length < PAGE) break;
  }

  await loadAllBeneficiaries(allIds);

  _cachedAllMembers = [..._allMembers]; // Cache the full list for restoration

  // Initial Render
  renderTable();
  setMsg(`Loaded ${total} member(s).`);

  FLOAT_HSCROLL.init();
}

async function loadAllBeneficiaries(ids) {
  setMsg('Loading beneficiaries…');
  beneficiariesMap.clear();
  const pageSize = 2000; // efficient in chunks
  for (let i = 0; i < ids.length; i += pageSize) {
    const slice = ids.slice(i, i + pageSize);
    const { data, error } = await supabaseClient
      .from('beneficiaries')
      .select('member_id, relation, last_name, first_name, middle_name, birth_date, age, address')
      .in('member_id', slice)
      .order('last_name', { ascending: true });
    if (error) throw error;
    (data || []).forEach(b => {
      if (!beneficiariesMap.has(b.member_id)) beneficiariesMap.set(b.member_id, []);
      beneficiariesMap.get(b.member_id).push(b);
    });
  }
}

async function loadLapsedMembers() {
  setMsg('Loading lapsed members...');
  try {
    const { data, error } = await supabaseClient.rpc('get_lapsed_members');
    if (error) throw error;

    _allMembers = data || [];

    // We also need to fetch beneficiaries for these members to prevent errors when expanding
    // Map data to just IDs
    const newIds = _allMembers.map(m => m.id);
    if (newIds.length > 0) {
      await loadAllBeneficiaries(newIds);
    } else {
      setMsg('No lapsed members found.');
    }

    _currentPage = 1;
    renderTable();
    setMsg(`Loaded ${_allMembers.length} lapsed member(s).`);

    // Re-init horizontal scroll just in case
    FLOAT_HSCROLL.sync();

  } catch (e) {
    console.error('Error loading lapsed members:', e);
    setMsg('Error loading lapsed members: ' + e.message);
  }
}

async function loadAtRiskMembers() {
  setMsg('Loading at-risk members...');
  try {
    const { data, error } = await supabaseClient.rpc('get_at_risk_members');
    if (error) throw error;

    _allMembers = data || [];

    const newIds = _allMembers.map(m => m.id);
    if (newIds.length > 0) {
      await loadAllBeneficiaries(newIds);
    }

    _currentPage = 1;
    renderTable();
    setMsg(`Loaded ${_allMembers.length} at-risk member(s).`);
  } catch (e) {
    console.error('Error loading AT RISK:', e);
  }
}

async function loadWarningMembers() {
  setMsg('Loading warning members...');
  try {
    const { data, error } = await supabaseClient.rpc('get_warning_members');
    if (error) throw error;

    _allMembers = data || [];

    const newIds = _allMembers.map(m => m.id);
    if (newIds.length > 0) {
      await loadAllBeneficiaries(newIds);
    }

    _currentPage = 1;
    renderTable();
    setMsg(`Loaded ${_allMembers.length} warning member(s).`);
  } catch (e) {
    console.error('Error loading WARNING:', e);
  }
}

async function loadActiveMembers() {
  setMsg('Loading active members...');
  try {
    const { data, error } = await supabaseClient.rpc('get_active_members');
    if (error) throw error;

    _allMembers = data || [];

    const newIds = _allMembers.map(m => m.id);
    if (newIds.length > 0) {
      await loadAllBeneficiaries(newIds);
    }

    _currentPage = 1;
    renderTable();
    setMsg(`Loaded ${_allMembers.length} active member(s).`);
  } catch (e) {
    console.error('Error loading ACTIVE:', e);
    setMsg('Error loading ACTIVE members: ' + e.message);
  }
}


/* ===== Floating horizontal "slider" (fixed to viewport) ===== */
const FLOAT_HSCROLL = (function () {
  let sliderWrap, slider, wrap, ro, styleEl;
  let suppress = false;

  function ensureStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.textContent = `
    .hs - float{
    position: fixed; z - index: 9999;
    bottom: 70px;   /* Adjusted to 70px to sit above footer */
    left: 24px;     /* default; we compute real left */
    width: 320px;   /* default; we compute real width */
    padding: 6px 10px;
    background: rgba(24, 28, 38, .75);
    border: 1px solid rgba(255, 255, 255, .12);
    border - radius: 10px;
    backdrop - filter: blur(6px);
    box - shadow: 0 10px 24px rgba(0, 0, 0, .35);
  }
      .hs - float input[type = "range"]{
    -webkit - appearance: none; appearance: none;
    width: 100 %; height: 8px; background: transparent; margin: 0;
  }
      .hs - float input[type = "range"]:: -webkit - slider - runnable - track{
    height: 8px; background: #3b4a63; border - radius: 5px;
  }
      .hs - float input[type = "range"]:: -webkit - slider - thumb{
    -webkit - appearance: none; width: 18px; height: 18px;
    background: #8fb0ff; border - radius: 50 %; margin - top: -5px;
    box - shadow: 0 2px 6px rgba(0, 0, 0, .35);
  }
      .hs - float input[type = "range"]:: -moz - range - track{
    height: 8px; background: #3b4a63; border - radius: 5px;
  }
      .hs - float input[type = "range"]:: -moz - range - thumb{
    width: 16px; height: 16px; background: #8fb0ff; border - radius: 50 %;
  }
  `;
    document.head.appendChild(styleEl);
  }

  function findWrap() {
    const viaClass = document.querySelector('.scroll-x');
    if (viaClass) return viaClass;
    const tbody = document.querySelector('#membersTbody');
    if (tbody) {
      const byClosest = tbody.closest('.scroll-x');
      if (byClosest) return byClosest;
      if (tbody.parentElement) return tbody.parentElement;
    }
    return null;
  }

  function layout() {
    if (!wrap || !sliderWrap) return;
    const rect = wrap.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < window.innerHeight;
    sliderWrap.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    const margin = 16;
    const left = Math.max(margin, rect.left);
    const rightLimit = window.innerWidth - margin;
    const width = Math.max(260, Math.min(rect.width, rightLimit - left));

    sliderWrap.style.left = left + 'px';
    sliderWrap.style.width = width + 'px';

    const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    slider.max = String(max);
    if (!suppress) {
      suppress = true;
      slider.value = String(wrap.scrollLeft);
      suppress = false;
    }
  }

  function init() {
    if (!wrap) wrap = findWrap();
    if (!wrap) return;

    ensureStyles();

    if (!sliderWrap) {
      sliderWrap = document.createElement('div');
      sliderWrap.className = 'hs-float';
      slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.value = '0';
      sliderWrap.appendChild(slider);
      document.body.appendChild(sliderWrap);

      slider.addEventListener('input', () => {
        if (suppress) return;
        suppress = true;
        wrap.scrollLeft = Number(slider.value);
        suppress = false;
      });

      wrap.addEventListener('scroll', () => {
        if (suppress) return;
        suppress = true;
        slider.value = String(wrap.scrollLeft);
        suppress = false;
      });

      ro = new ResizeObserver(layout);
      ro.observe(wrap);
      if (wrap.firstElementChild) ro.observe(wrap.firstElementChild);
      window.addEventListener('resize', layout);
      window.addEventListener('scroll', layout, { passive: true });
    }
    layout();
  }

  return { init, sync: layout };
})();

window.addEventListener('DOMContentLoaded', boot);