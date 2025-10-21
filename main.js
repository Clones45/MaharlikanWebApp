// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

/* -------------------------------------------------------------
   1) Load .env safely (dev + packaged)
------------------------------------------------------------- */
(function loadEnv() {
  try {
    const devEnv = path.join(__dirname, '.env');
    const packedEnv = process.resourcesPath
      ? path.join(process.resourcesPath, '.env')
      : null;
    const candidates = [devEnv, packedEnv].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        require('dotenv').config({ path: p });
        console.log('[MAIN] Loaded .env from:', p);
        return;
      }
    }
    console.warn('[MAIN] .env not found; using existing process.env');
  } catch (e) {
    console.warn('[MAIN] Failed to load .env:', e?.message || e);
  }
})();

/* -------------------------------------------------------------
   2) Globals
------------------------------------------------------------- */
let mainWindow = null;

const RENDER_ROOTS = [
  path.join(__dirname, 'renderer'),
  path.join(__dirname, 'renderer', 'pages'),
];

function buildAllowlist() {
  const files = new Set();
  for (const root of RENDER_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (entry.toLowerCase().endsWith('.html')) files.add(entry);
    }
  }
  return files;
}
let ALLOWED_RENDER_FILES = buildAllowlist();
console.log('[MAIN] Allowlisted HTML files:', [...ALLOWED_RENDER_FILES].join(', ') || '(none)');

function normalizeFileName(file) {
  const raw = String(file ?? '').trim();
  const base = path.basename(raw);
  if (!base || !/\.html$/i.test(base)) return null;
  return base;
}

function resolveRendererPath(basename) {
  for (const root of RENDER_ROOTS) {
    const p = path.join(root, basename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function openChildWindow(basename) {
  const targetPath = resolveRendererPath(basename);
  if (!targetPath) {
    console.warn('[MAIN] File not found in renderer roots:', basename);
    return;
  }

  const child = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#0b0c10',
    autoHideMenuBar: true,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  child.loadFile(targetPath).catch(err => {
    console.error('[MAIN] loadFile failed:', err?.message || err);
  });

  child.once('ready-to-show', () => {
    try { child.show(); } catch {}
  });
  child.center();
  child.maximize();
}

/* -------------------------------------------------------------
   3) Window creation
------------------------------------------------------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0b0c10',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const entry = path.join(__dirname, 'renderer', 'login.html');
  console.log('[MAIN] Loading entry:', entry);
  mainWindow.loadFile(entry);

  if (!app.isPackaged) {
    mainWindow.webContents.on('did-finish-load', () => {
      ALLOWED_RENDER_FILES = buildAllowlist();
      console.log('[MAIN] (Dev) Rebuilt allowlist:', [...ALLOWED_RENDER_FILES].join(', ') || '(none)');
    });
  }
}

/* -------------------------------------------------------------
   4) App ready + Auto Update
------------------------------------------------------------- */
app.whenReady().then(() => {
  createWindow();

  // 🪄 Auto Update (runs only when packaged)
  try {
    if (app.isPackaged) {
      console.log('[UPDATE] Checking for updates…');
      autoUpdater.autoDownload = true;
      autoUpdater.checkForUpdatesAndNotify();

      autoUpdater.on('update-available', (info) => {
        console.log(`[UPDATE] Update available: ${info?.version || 'unknown'}`);
      });

      autoUpdater.on('update-not-available', () => {
        console.log('[UPDATE] No updates found.');
      });

      autoUpdater.on('update-downloaded', async () => {
        console.log('[UPDATE] Update downloaded. Prompting user...');
        const result = await dialog.showMessageBox({
          type: 'info',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update Ready',
          message: 'A new version has been downloaded.',
          detail: 'Click "Restart now" to quit and install the update.',
        });
        if (result.response === 0) autoUpdater.quitAndInstall();
      });

      autoUpdater.on('error', (err) => {
        console.warn('[UPDATE] Auto-update error:', err?.message || err);
      });
    } else {
      console.log('[UPDATE] Skipped auto-updater in development mode.');
    }
  } catch (e) {
    console.warn('[UPDATE] Failed to initialize auto-updater:', e?.message || e);
  }

  /* -----------------------------------------------------------
     5) IPC handlers
  ----------------------------------------------------------- */
  ipcMain.handle('env:get', () => ({
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    ADMIN_PORTAL_SECRET: process.env.ADMIN_PORTAL_SECRET || '',
  }));

  ipcMain.handle('open-window', (_evt, file) => {
    const base = normalizeFileName(file);
    if (!base) return console.warn('[MAIN] Invalid filename:', file);

    if (!ALLOWED_RENDER_FILES.has(base)) {
      ALLOWED_RENDER_FILES = buildAllowlist();
      if (!ALLOWED_RENDER_FILES.has(base)) return;
    }
    openChildWindow(base);
  });

  ipcMain.on('open-window', (_evt, file) => {
    const base = normalizeFileName(file);
    if (!base) return console.warn('[MAIN] Invalid filename:', file);

    if (!ALLOWED_RENDER_FILES.has(base)) {
      ALLOWED_RENDER_FILES = buildAllowlist();
      if (!ALLOWED_RENDER_FILES.has(base)) return;
    }
    openChildWindow(base);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* -------------------------------------------------------------
   6) Quit when all windows are closed (except macOS)
------------------------------------------------------------- */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
