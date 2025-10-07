// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ⬇️ NEW: auto-updater (uses your GitHub Releases per package.json "publish")
const { autoUpdater } = require('electron-updater');

// --- Safe .env loader (dev + packaged) ---
(function loadEnv() {
  try {
    // 1) Dev: project root next to main.js
    const devEnv = path.join(__dirname, '.env');
    // 2) Packaged: <app folder>/resources/.env
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const entry = path.join(__dirname, 'renderer', 'index.html');
  console.log('[MAIN] Loading:', entry);
  win.loadFile(entry);
}

app.whenReady().then(() => {
  createWindow();

  // ⬇️ NEW: trigger auto-update a few seconds after launch
  try {
    // optional: auto download when found (default true)
    autoUpdater.autoDownload = true;

    setTimeout(() => {
      console.log('[UPDATE] Checking for updates…');
      autoUpdater.checkForUpdatesAndNotify();
    }, 3000);

    autoUpdater.on('update-available', (info) => {
      console.log('[UPDATE] Update available:', info?.version || '');
    });

    autoUpdater.on('update-downloaded', async () => {
      console.log('[UPDATE] Update downloaded. Prompting to install…');
      const result = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: 'A new version has been downloaded.',
        detail: 'Click "Restart now" to quit and install the update.',
      });
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });

    autoUpdater.on('error', (err) => {
      console.warn('[UPDATE] Auto-update error:', err?.message || err);
    });
  } catch (e) {
    console.warn('[UPDATE] Failed to initialize auto-updater:', e?.message || e);
  }

  ipcMain.handle('env:get', () => ({
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  }));

  ipcMain.on('open-window', (_evt, file) => {
    const child = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 800,
      backgroundColor: '#0b0c10',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const childPath = path.join(__dirname, 'renderer', file);
    console.log('[MAIN] Child loading:', childPath);
    child.loadFile(childPath);
    child.center();
    child.maximize();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
