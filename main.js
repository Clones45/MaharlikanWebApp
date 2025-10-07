// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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
