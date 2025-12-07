let supabase = null, env = null;

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const setMsg = (t) => { const el = qs('#statusText'); if (el) el.textContent = t || ''; };

const agentsMap = new Map();
const beneficiariesMap = new Map();

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

    // 🛑 CRITICAL: Use dummy storage to prevent clearing main window's localStorage
    const dummyStorage = {
      getItem: () => null,
      setItem: () => { },
      removeItem: () => { },
    };

    supabase = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: dummyStorage
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
    rows.forEach(r => r.style.display = show ? 'table-row' : 'none');
    qs('#toggleBeneficiariesBtn').textContent = show ? 'Hide Beneficiaries' : 'Show Beneficiaries';
  });

  qs('#searchInput')?.addEventListener('keyup', () => {
    const term = (qs('#searchInput').value || '').toLowerCase();
    const btnText = qs('#toggleBeneficiariesBtn')?.textContent || '';
    const beneVisible = btnText.includes('Hide');

    qsa('#membersTable tbody tr').forEach(tr => {
      const isBene = tr.classList.contains('beneficiaries-row');
      if (isBene) {
        tr.style.display = beneVisible ? tr.dataset.parentVisible === '1' ? 'table-row' : 'none' : 'none';
      } else {
        const show = tr.textContent.toLowerCase().includes(term);
        tr.style.display = show ? '' : 'none';
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('beneficiaries-row')) {
          next.dataset.parentVisible = show ? '1' : '0';
          next.style.display = beneVisible && show ? 'table-row' : 'none';
        }
      }
    });

    // keep the floating slider in sync while filtering
    FLOAT_HSCROLL.sync();
  });

  qs('#closeBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.close();
  });
}

async function loadAgentsMap() {
  agentsMap.clear();
  try {
    const { data, error } = await supabase
      .from('agents')
      .select('id, lastname, firstname')
      .order('lastname', { ascending: true });
    if (error) throw error;
    (data || []).forEach(a => {
      const name = [a.lastname || '', a.firstname || ''].filter(Boolean).join(', ');
      agentsMap.set(a.id, name || `#${a.id}`);
    });
  } catch (e) {
    console.warn('[agents map]', e.message);
  }
}

function agentName(agent_id) {
  if (agent_id == null) return '';
  const k = Number(agent_id);
  return agentsMap.get(k) || `#${agent_id}`;
}

async function loadAllMembers() {
  setMsg('Loading members…');
  const tbody = qs('#membersTbody');
  tbody.innerHTML = '';

  let from = 0, total = 0, allIds = [];

  while (true) {
    const { data: members, error } = await supabase
      .from('members')
      .select('id, maf_no, last_name, first_name, middle_name, gender, civil_status, address, zipcode, birth_date, birthplace, nationality, age, height, weight, religion, contact_number, monthly_due, plan_type, contracted_price, date_joined, balance, casket_type, membership, occupation, agent_id')
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    const rows = members || [];
    if (!rows.length) break;

    // collect member ids for bene fetch
    allIds.push(...rows.map(r => r.id));

    // render member rows now (bene rows appended after bene fetch)
    for (const m of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(m.maf_no)}</td>
        <td>${esc(m.last_name)}</td>
        <td>${esc(m.first_name)}</td>
        <td>${esc(m.middle_name)}</td>
        <td>${esc(m.gender)}</td>
        <td>${esc(m.civil_status)}</td>
        <td>${esc(m.address)}</td>
        <td>${esc(m.zipcode)}</td>
        <td>${esc(m.birth_date)}</td>
        <td>${esc(m.birthplace)}</td>
        <td>${esc(m.nationality)}</td>
        <td>${esc(m.age)}</td>
        <td>${esc(m.height)}</td>
        <td>${esc(m.weight)}</td>
        <td>${esc(m.religion)}</td>
        <td>${esc(m.contact_number)}</td>
        <td>${money(m.monthly_due)}</td>
        <td>${esc(m.plan_type)}</td>
        <td>${money(m.contracted_price)}</td>
        <td>${esc(m.date_joined)}</td>
        <td>${money(m.balance)}</td>
        <td>${esc(m.casket_type)}</td>
        <td>${esc(m.membership)}</td>
        <td>${esc(m.occupation)}</td>
        <td>${esc(agentName(m.agent_id))}</td>
      `;
      tbody.appendChild(tr);

      // placeholder beneficiaries row (content filled later)
      const beneTr = document.createElement('tr');
      beneTr.className = 'beneficiaries-row';
      beneTr.dataset.memberId = m.id;
      beneTr.dataset.parentVisible = '1';
      beneTr.style.display = 'none';
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
            <tbody><tr><td colspan="7">Loading…</td></tr></tbody>
          </table>
        </td>`;
      tbody.appendChild(beneTr);
    }

    total += rows.length;
    from += rows.length;
    setMsg(`Loaded ${total} member(s)…`);
    if (rows.length < PAGE) break;
  }

  await loadAllBeneficiaries(allIds);

  // fill beneficiaries into their rows
  const beneVisible = (qs('#toggleBeneficiariesBtn')?.textContent || '').includes('Hide');
  qsa('.beneficiaries-row').forEach(tr => {
    const id = Number(tr.dataset.memberId);
    const list = beneficiariesMap.get(id) || [];
    const tbd = tr.querySelector('tbody');
    if (!list.length) {
      tbd.innerHTML = `<tr><td colspan="7">No beneficiaries</td></tr>`;
    } else {
      tbd.innerHTML = list.map(b => `
        <tr>
          <td>${esc(b.relation)}</td>
          <td>${esc(b.last_name)}</td>
          <td>${esc(b.first_name)}</td>
          <td>${esc(b.middle_name)}</td>
          <td>${esc(b.birth_date)}</td>
          <td>${esc(b.age)}</td>
          <td>${esc(b.address)}</td>
        </tr>
      `).join('');
    }
    tr.style.display = beneVisible ? 'table-row' : 'none';
  });

  setMsg(`Loaded ${total} member(s).`);

  // (Re)align the floating slider to the table container
  FLOAT_HSCROLL.init();
}

/* ===== Floating horizontal "slider" (fixed to viewport) =====
   - Always visible near bottom of the window
   - Aligns to the .scroll-x container's left/width
   - Mirrors/controls the real horizontal scroll
*/
const FLOAT_HSCROLL = (function () {
  let sliderWrap, slider, wrap, ro, styleEl;
  let suppress = false;

  function ensureStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.textContent = `
      .hs-float{
        position: fixed; z-index: 9999;
        bottom: 16px;   /* distance from window bottom */
        left: 24px;     /* default; we compute real left */
        width: 320px;   /* default; we compute real width */
        padding: 6px 10px;
        background: rgba(24,28,38,.75);
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px;
        backdrop-filter: blur(6px);
        box-shadow: 0 10px 24px rgba(0,0,0,.35);
      }
      .hs-float input[type="range"]{
        -webkit-appearance: none; appearance: none;
        width: 100%; height: 8px; background: transparent; margin: 0;
      }
      .hs-float input[type="range"]::-webkit-slider-runnable-track{
        height: 8px; background: #3b4a63; border-radius: 5px;
      }
      .hs-float input[type="range"]::-webkit-slider-thumb{
        -webkit-appearance: none; width: 18px; height: 18px;
        background: #8fb0ff; border-radius: 50%; margin-top: -5px;
        box-shadow: 0 2px 6px rgba(0,0,0,.35);
      }
      .hs-float input[type="range"]::-moz-range-track{
        height: 8px; background: #3b4a63; border-radius: 5px;
      }
      .hs-float input[type="range"]::-moz-range-thumb{
        width: 16px; height: 16px; background: #8fb0ff; border-radius: 50%;
      }
    `;
    document.head.appendChild(styleEl);
  }

  function findWrap() {
    // Your scroll container (.scroll-x)
    const viaClass = document.querySelector('.scroll-x');
    if (viaClass) return viaClass;

    // Fallbacks
    const tbody = document.querySelector('#membersTbody');
    if (tbody) {
      const byClosest = tbody.closest('.scroll-x');
      if (byClosest) return byClosest;
      if (tbody.parentElement) return tbody.parentElement;
    }
    const table = document.querySelector('#membersTable');
    if (table) {
      const byClosest = table.closest('.scroll-x');
      if (byClosest) return byClosest;
      return table.parentElement;
    }
    return null;
  }

  function layout() {
    if (!wrap || !sliderWrap) return;
    const rect = wrap.getBoundingClientRect();

    // show only when the table container is on screen
    const visible = rect.bottom > 0 && rect.top < window.innerHeight;
    sliderWrap.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    // Align slider width/left to the visible part of the table container
    const margin = 16;
    const left = Math.max(margin, rect.left);
    const rightLimit = window.innerWidth - margin;
    const width = Math.max(260, Math.min(rect.width, rightLimit - left));

    sliderWrap.style.left = left + 'px';
    sliderWrap.style.width = width + 'px';

    // Update slider range to match scrollable range
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

      // range -> table
      slider.addEventListener('input', () => {
        if (suppress) return;
        suppress = true;
        wrap.scrollLeft = Number(slider.value);
        suppress = false;
      });

      // table -> range
      wrap.addEventListener('scroll', () => {
        if (suppress) return;
        suppress = true;
        slider.value = String(wrap.scrollLeft);
        suppress = false;
      });

      // keep things aligned
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

async function loadAllBeneficiaries(ids) {
  setMsg('Loading beneficiaries…');
  beneficiariesMap.clear();
  const pageSize = 2000; // efficient in chunks
  for (let i = 0; i < ids.length; i += pageSize) {
    const slice = ids.slice(i, i + pageSize);
    const { data, error } = await supabase
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

window.addEventListener('DOMContentLoaded', boot);