// =============================================================
// Maharlikan Admin Desktop — main.js (with Safe Config Popup)
// =============================================================

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

/* -------------------------------------------------------------
   1) Early logging setup (for crash diagnostics)
------------------------------------------------------------- */
const logPath = path.join(process.env.APPDATA || ".", "maharlikan-startup.log");
function safeLog(msg) {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { }
}
safeLog("=== App starting ===");

process.on("uncaughtException", (err) =>
  safeLog("UncaughtException: " + err.stack)
);
process.on("unhandledRejection", (err) =>
  safeLog("UnhandledRejection: " + err)
);

/* -------------------------------------------------------------
   2) Safe .env loader (works in dev + packaged builds)
------------------------------------------------------------- */
(function loadEnvSafely() {
  try {
    const dotenv = require("dotenv");
    const candidates = [
      path.join(process.resourcesPath || "", ".env"),
      path.join(__dirname, ".env"),
    ];
    for (const file of candidates) {
      if (file && fs.existsSync(file)) {
        dotenv.config({ path: file });
        console.log("[MAIN] Loaded .env from:", file);
        safeLog("[MAIN] Loaded .env from: " + file);
        return;
      }
    }
    console.warn("[MAIN] .env not found — using existing process.env.");
    safeLog("[MAIN] WARNING: No .env file found in candidates.");
  } catch (e) {
    console.warn("[MAIN] Failed to load .env:", e.message);
    safeLog("[MAIN] ERROR loading .env: " + e.message);
  }
})();

/* -------------------------------------------------------------
   3) Check critical environment values
------------------------------------------------------------- */
function checkEnvOrExit() {
  const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    const msg =
      "Missing critical configuration values:\n\n" +
      missing.join("\n") +
      "\n\nPlease reinstall the app or contact your administrator.";
    safeLog("[MAIN] Missing env keys: " + missing.join(", "));
    dialog.showErrorBox("Configuration Error", msg);
    app.quit();
    return false;
  }
  return true;
}

/* -------------------------------------------------------------
   4) Globals and renderer path helpers
------------------------------------------------------------- */
let mainWindow = null;

const RENDER_ROOTS = [
  path.join(__dirname, "renderer"),
  path.join(__dirname, "renderer", "pages"),
];

function buildAllowlist() {
  const files = new Set();
  for (const root of RENDER_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (entry.toLowerCase().endsWith(".html")) files.add(entry);
    }
  }
  return files;
}

let ALLOWED_RENDER_FILES = buildAllowlist();
console.log("[MAIN] Allowlisted HTML files:", [...ALLOWED_RENDER_FILES].join(", ") || "(none)");
safeLog("[MAIN] Allowlisted HTML files: " + [...ALLOWED_RENDER_FILES].join(", "));

function normalizeFileName(file) {
  const raw = String(file ?? "").trim();
  // Allow .html followed by optional query string
  // e.g. "register-agent.html?foo=bar"
  const match = raw.match(/^([a-zA-Z0-9_\-]+\.html)(\?.*)?$/i);
  if (!match) return null;
  // Return the full string (filename + query) so loadFile works, 
  // OR just the filename for validation? 
  // loadFile in Electron supports query params? Yes, usually.
  // But we need to validate against the ALLOWLIST which only has filenames.

  const filename = match[1]; // e.g. register-agent.html
  return { filename, full: raw };
}

function resolveRendererPath(rawPath) {
  // rawPath might be "register-agent.html?token=..."
  // We need to find the actual file path for "register-agent.html"
  // and then append "?token=..." to it.

  const match = rawPath.match(/^([a-zA-Z0-9_\-]+\.html)(\?.*)?$/i);
  if (!match) return null;

  const filename = match[1];
  const query = match[2] || "";

  for (const root of RENDER_ROOTS) {
    const p = path.join(root, filename);
    if (fs.existsSync(p)) {
      // Return path + query. 
      // Note: loadFile supports query params if passed as a URL, 
      // but here we are passing a path. Electron's loadFile usually takes a filePath.
      // To support query params with loadFile, we might need to use loadURL(`file://${p}${query}`).
      // However, let's try returning just the path and see if loadFile handles it, 
      // OR better: return the object and handle it in openChildWindow.
      return { path: p, query };
    }
  }
  return null;
}

/* -------------------------------------------------------------
   5) Reusable main window logic
------------------------------------------------------------- */
function openChildWindow(basename) {
  const resolved = resolveRendererPath(basename);
  if (!resolved) {
    console.warn("[MAIN] File not found in renderer roots:", basename);
    safeLog("[MAIN] Missing renderer file: " + basename);
    return;
  }

  const { path: filePath, query } = resolved;
  const fileUrl = `file://${filePath.replace(/\\/g, "/")}${query}`;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(fileUrl).catch((err) => {
      console.error("[MAIN] loadURL failed:", err.message);
      safeLog("[MAIN] loadURL failed: " + err.message);
    });
    return;
  }

  // Fallback if mainWindow closed
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: "#0b0c10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(fileUrl);
}

/* -------------------------------------------------------------
   6) Create main window (entry point)
------------------------------------------------------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0b0c10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const entry = path.join(__dirname, "renderer", "login.html");
  console.log("[MAIN] Loading entry:", entry);
  safeLog("[MAIN] Loading entry: " + entry);

  mainWindow.loadFile(entry).catch((err) => {
    console.error("[MAIN] Failed to load entry:", err.message);
    safeLog("[MAIN] Failed to load entry: " + err.message);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    ALLOWED_RENDER_FILES = buildAllowlist();
    console.log("[MAIN] (Dev) Rebuilt allowlist:", [...ALLOWED_RENDER_FILES].join(", ") || "(none)");
    console.log("[MAIN] (Dev) Rebuilt allowlist:", [...ALLOWED_RENDER_FILES].join(", ") || "(none)");
  });

  // -----------------------------------------------------------
  // HIDDEN SHORTCUT: CTRL + SHIFT + Q -> Manage Collections
  // -----------------------------------------------------------
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === "q") {
      console.log("[SHORTCUT] CTRL+SHIFT+Q detected. Opening hidden manager...");
      event.preventDefault();
      // Ensure the file is allowed (it should be picked up by buildAllowlist if it exists)
      // But we might need to manually allow it if buildAllowlist is strict about .html files in root vs pages
      // Our buildAllowlist scans renderer/ and renderer/pages/ so it should be fine.
      openChildWindow("manage_collections.html");
    }
  });
}

/* -------------------------------------------------------------
   7) App ready + Auto-updater (safe version)
------------------------------------------------------------- */
app.whenReady().then(() => {
  // Check environment first
  if (!checkEnvOrExit()) return;

  createWindow();

  app.on("web-contents-created", (_, contents) => {
    contents.setWindowOpenHandler(() => {
      console.warn("[MAIN] Blocked attempt to open a new window.");
      return { action: "deny" };
    });
  });

  try {
    if (app.isPackaged) {
      console.log("[UPDATE] Checking for updates...");
      safeLog("[UPDATE] Checking for updates...");

      autoUpdater.autoDownload = true;

      autoUpdater.on("update-available", (info) => {
        console.log(`[UPDATE] Update available: ${info?.version || "unknown"}`);
        safeLog("[UPDATE] Update available: " + (info?.version || "unknown"));
      });

      autoUpdater.on("update-not-available", () => {
        console.log("[UPDATE] No updates found.");
        safeLog("[UPDATE] No updates found.");
      });

      autoUpdater.on("update-downloaded", async () => {
        console.log("[UPDATE] Update downloaded. Prompting user...");
        safeLog("[UPDATE] Update downloaded. Prompting user...");
        const result = await dialog.showMessageBox({
          type: "info",
          buttons: ["Restart now", "Later"],
          defaultId: 0,
          cancelId: 1,
          title: "Update Ready",
          message: "A new version has been downloaded.",
          detail: "Click 'Restart now' to quit and install the update.",
        });
        if (result.response === 0) autoUpdater.quitAndInstall();
      });

      autoUpdater.on("error", (err) => {
        console.warn("[UPDATE] Auto-update error:", err.message);
        safeLog("[UPDATE] Auto-update error: " + err.message);
      });

      try {
        autoUpdater.checkForUpdatesAndNotify();
      } catch (e) {
        safeLog("[UPDATE] Failed to check updates: " + e.message);
      }
    } else {
      console.log("[UPDATE] Skipped auto-updater in development mode.");
      safeLog("[UPDATE] Skipped auto-updater in dev.");
    }
  } catch (e) {
    console.warn("[UPDATE] Failed to initialize auto-updater:", e.message);
    safeLog("[UPDATE] Initialization error: " + e.message);
  }

  /* -----------------------------------------------------------
     8) IPC handlers
  ----------------------------------------------------------- */
  ipcMain.handle("env:get", () => ({
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    ADMIN_PORTAL_SECRET: process.env.ADMIN_PORTAL_SECRET || "",
  }));

  ipcMain.handle("open-window", (_evt, file) => {
    const normalized = normalizeFileName(file);
    if (!normalized) return console.warn("[MAIN] Invalid filename format:", file);

    const { filename, full } = normalized;

    if (!ALLOWED_RENDER_FILES.has(filename)) {
      ALLOWED_RENDER_FILES = buildAllowlist();
      if (!ALLOWED_RENDER_FILES.has(filename)) {
        console.warn("[MAIN] File not allowlisted:", filename);
        return;
      }
    }

    openChildWindow(full);
  });

  ipcMain.on("open-window", (_evt, file) => {
    const normalized = normalizeFileName(file);
    if (!normalized) return console.warn("[MAIN] Invalid filename format:", file);

    const { filename, full } = normalized;

    if (!ALLOWED_RENDER_FILES.has(filename)) {
      ALLOWED_RENDER_FILES = buildAllowlist();
      if (!ALLOWED_RENDER_FILES.has(filename)) {
        console.warn("[MAIN] File not allowlisted:", filename);
        return;
      }
    }

    openChildWindow(full);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* -------------------------------------------------------------
   9) Quit when all windows are closed (except macOS)
------------------------------------------------------------- */
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
