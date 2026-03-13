// Assumes window.SB is already created & authenticated as an admin.

(function () {
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));

  let SB = null;
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const qEl = document.getElementById('q');
  const statusEl = document.getElementById('status');
  const refreshBtn = document.getElementById('refreshBtn');
  const exportBtn = document.getElementById('exportBtn');

  let rows = []; // cached list for filtering/export

  // ----- Init Supabase -----
  async function initSupabase() {
    let env = null;
    if (window.electronAPI?.getEnv) {
      try { env = await window.electronAPI.getEnv(); } catch { }
    }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
      if (window.__ENV__) env = window.__ENV__;
    }
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

    if (env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
      SB = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: true,  // ✅ ENABLE: Auto-refresh tokens
          detectSessionInUrl: false,
          storage: dummyStorage    // ✅ ISOLATE from localStorage
        },
      });

      SB.auth.onAuthStateChange((event) => {
        if (event === 'TOKEN_REFRESHED') console.log('[inquiries] ✅ Token refreshed');
      });

      // Session fix
      const params = new URLSearchParams(window.location.search);
      const token = params.get("access_token");
      const refresh = params.get("refresh_token");
      if (token && refresh) {
        await SB.auth.setSession({ access_token: token, refresh_token: refresh });
      }

      window.SB = SB;
      wireUI();
      load();
      subscribeRealtime();
    }
  }

  // ----- UI helpers -----
  const formWrap = qs('body');
  if (formWrap && !qs('#homeBtn')) {
    const backBtn = document.createElement('button');
    backBtn.id = 'homeBtn';
    backBtn.textContent = '🏠 Home';
    backBtn.style.position = 'fixed';
    backBtn.style.top = '14px';
    backBtn.style.right = '18px';
    backBtn.style.zIndex = '9999';
    backBtn.style.background = '#0b4d87';
    backBtn.style.color = '#fff';
    backBtn.style.border = '0';
    backBtn.style.borderRadius = '8px';
    backBtn.style.padding = '8px 14px';
    backBtn.style.cursor = 'pointer';
    backBtn.style.fontWeight = '600';
    backBtn.onclick = () => window.location.href = 'index.html';
    backBtn.onmouseenter = () => backBtn.style.filter = 'brightness(0.9)';
    backBtn.onmouseleave = () => backBtn.style.filter = 'brightness(1)';
    formWrap.appendChild(backBtn);
  }

  function htmlesc(s) {
    return (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function dateLocal(s) {
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }
  function render() {
    const q = qEl.value.trim().toLowerCase();
    const status = statusEl.value;
    const filtered = rows.filter(r => {
      const t = `${r.first_name} ${r.last_name} ${r.email} ${r.mobile} ${r.location} ${r.message}`.toLowerCase();
      const okQ = !q || t.includes(q);
      const okS = !status || r.status === status;
      return okQ && okS;
    });

    listEl.innerHTML = '';
    emptyEl.style.display = filtered.length ? 'none' : 'block';

    for (const r of filtered) {
      const el = document.createElement('div');
      el.className = 'row';
      el.dataset.id = r.id;
      el.innerHTML = `
          <div class="inq-header">
          <div>
        <h3>${htmlesc(r.first_name)} ${htmlesc(r.last_name)}</h3>
        <span class="pill ${r.status}">${r.status.replace('_', ' ')}</span>
          </div>
          </div>

          <div class="inq-info">
          <p>📧 <strong>Email:</strong> ${htmlesc(r.email)}</p>
          <p>📱 <strong>Mobile:</strong> ${htmlesc(r.mobile)}</p>
          ${r.location ? `<p>📍 <strong>Location:</strong> ${htmlesc(r.location)}</p>` : ''}
          <p>🕒 <strong>Date Submitted:</strong> ${dateLocal(r.created_at)}</p>
          </div>

          <div class="inq-message">
          <p>💬 <strong>Message:</strong></p>
          <div class="msg-box">${htmlesc(r.message)}</div>
          </div>

          <div class="inq-actions">
          <button class="btn set-new">Mark New</button>
          <button class="btn set-prog">In Progress</button>
          <button class="btn set-closed">Close</button>
           </div>
          `;


      el.querySelector('.set-new').onclick = () => updateStatus(r.id, 'new');
      el.querySelector('.set-prog').onclick = () => updateStatus(r.id, 'in_progress');
      el.querySelector('.set-closed').onclick = () => updateStatus(r.id, 'closed');
      listEl.appendChild(el);
    }
  }

  async function updateStatus(id, status) {
    const { error } = await SB.from('inquiries').update({ status }).eq('id', id);
    if (error) { console.error(error); alert('Update failed'); return; }
    // Update local cache instantly
    const i = rows.findIndex(r => r.id === id);
    if (i >= 0) rows[i].status = status;
    render();
  }

  async function load() {
    const { data, error } = await SB
      .from('inquiries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) { console.error(error); return; }
    rows = data || [];
    render();
  }

  function subscribeRealtime() {
    SB.channel('inquiries-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inquiries' }, payload => {
        // Prepend new inquiry and re-render
        rows = [payload.new, ...rows];
        render();
        // Optional: desktop notification
        if (Notification && Notification.permission === 'granted') {
          new Notification('New Inquiry', { body: `${payload.new.first_name} ${payload.new.last_name}` });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inquiries' }, payload => {
        const i = rows.findIndex(r => r.id === payload.new.id);
        if (i >= 0) rows[i] = payload.new;
        render();
      })
      .subscribe();
  }

  function exportCSV() {
    const header = ['id', 'created_at', 'first_name', 'last_name', 'mobile', 'email', 'location', 'message', 'status', 'assigned_to', 'source'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const vals = header.map(k => {
        const v = r[k] ?? '';
        const s = String(v).replace(/"/g, '""');
        return `"${s}"`;
      });
      lines.push(vals.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inquiries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ----- events -----
  function wireUI() {
    qEl.addEventListener('input', render);
    statusEl.addEventListener('change', render);
    refreshBtn.addEventListener('click', load);
    exportBtn.addEventListener('click', exportCSV);

    // Request notification permission once
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // boot
  initSupabase();
})();
