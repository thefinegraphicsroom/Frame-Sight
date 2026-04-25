// main.js – Electron Main Process
'use strict';

const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell, Menu } = require('electron');
const path      = require('path');
const http      = require('http');
const fs        = require('fs');
const os        = require('os');

/* ─── State ──────────────────────────────────────────────────────────────── */
let mainWindow  = null;
let httpServer  = null;
let serverPort  = 14337;
let outputDir   = null;
let liveData    = {};
let profileName = 'HOK';

/* ─── Tesseract.js OCR ───────────────────────────────────────────────────── */
// We lazily require Tesseract.js so the import error (if the package is
// missing) surfaces as a graceful OCR-status error rather than a crash.
let Tesseract        = null;
let ocrReady         = false;
let ocrWorker        = null;   // single persistent worker — keeps the model hot
let workerLang       = null;   // language the worker was last initialised with
let ocrInitialising  = false;
const OCR_TIMEOUT    = 15000;  // ms per request

async function initTesseract(lang = 'eng') {
  if (ocrInitialising) return;
  ocrInitialising = true;

  try {
    if (!Tesseract) Tesseract = require('tesseract.js');

    // Tear down previous worker if language changed
    if (ocrWorker && workerLang !== lang) {
      await ocrWorker.terminate().catch(() => {});
      ocrWorker = null;
      ocrReady  = false;
    }

    if (!ocrWorker) {
      ocrWorker  = await Tesseract.createWorker(lang, 1, {
        // Suppress Tesseract's own verbose logging in production
        logger: () => {},
      });
      workerLang = lang;
    }

    ocrReady = true;
    mainWindow?.webContents.send('ocr-status', 'ready');
  } catch (err) {
    ocrReady = false;
    mainWindow?.webContents.send('ocr-status', 'error', err.message);
  } finally {
    ocrInitialising = false;
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function startHttpServer(pName) {
  profileName = pName || profileName;

  if (httpServer) { try { httpServer.close(); } catch (_) {} }

  httpServer = http.createServer((_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(liveData, null, 2));
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { serverPort++; startHttpServer(profileName); }
  });

  httpServer.listen(serverPort, '0.0.0.0', () => {
    const ip  = getLocalIP();
    const url = `http://${ip}:${serverPort}/${profileName}.json`;
    mainWindow?.webContents.send('server-url', url, ip, serverPort);
  });
}

function writeOutputFiles() {
  if (!outputDir) return;
  try {
    fs.writeFileSync(path.join(outputDir, `${profileName}.json`), JSON.stringify(liveData, null, 2));
    for (const [k, v] of Object.entries(liveData)) {
      fs.writeFileSync(path.join(outputDir, `${k}.txt`), String(v));
    }
  } catch (_) {}
}

/* ─── Window ─────────────────────────────────────────────────────────────── */
function createWindow() {
  mainWindow = new BrowserWindow({
    width:    1500,
    height:   900,
    minWidth: 1100,
    minHeight: 680,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0d0b14',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile('index.html');
}

/* ─── IPC Handlers ───────────────────────────────────────────────────────── */
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 200 },
  });
  return sources.map(s => ({
    id:        s.id,
    name:      s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('start-server', (_e, pName) => {
  startHttpServer(pName);
  return true;
});

ipcMain.handle('update-data', (_e, data) => {
  liveData = data;
  writeOutputFiles();
  return true;
});

ipcMain.handle('select-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!r.canceled) { outputDir = r.filePaths[0]; return outputDir; }
  return null;
});

ipcMain.handle('save-profile', async (_e, profileData) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${profileData.name}_profile.json`,
    filters: [{ name: 'JSON Profile', extensions: ['json'] }],
  });
  if (!r.canceled) {
    fs.writeFileSync(r.filePath, JSON.stringify(profileData, null, 2));
    return r.filePath;
  }
  return null;
});

ipcMain.handle('load-profile', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON Profile', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (!r.canceled) {
    return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  }
  return null;
});

ipcMain.handle('get-ip',   () => getLocalIP());
ipcMain.handle('get-port', () => serverPort);

// ── Tesseract.js OCR ──
ipcMain.handle('check-ocr', () => ocrReady);

ipcMain.handle('ocr-image', async (_e, { image, lang, whitelist }) => {
  // Re-initialise the worker if the requested language has changed
  if (!ocrWorker || workerLang !== (lang || 'eng')) {
    await initTesseract(lang || 'eng');
  }

  if (!ocrReady || !ocrWorker) {
    throw new Error('Tesseract OCR worker is not ready');
  }

  // Build Tesseract parameters
  const params = {
    // PSM 7 = single text line — best for HUD regions
    tessedit_pageseg_mode: '7',
    tessedit_ocr_engine_mode: '3',
  };
  if (whitelist) {
    params.tessedit_char_whitelist = whitelist;
  }

  // Decode base64 → Buffer so Tesseract.js can accept it directly
  const imageBuffer = Buffer.from(image, 'base64');

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('OCR request timed out')), OCR_TIMEOUT)
  );

  const ocrPromise = (async () => {
    await ocrWorker.setParameters(params);
    const { data } = await ocrWorker.recognize(imageBuffer);
    return (data.text || '').trim();
  })();

  return Promise.race([ocrPromise, timeoutPromise]);
});

// Window controls (custom titlebar)
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('win-close',    () => mainWindow?.close());

/* ─── App lifecycle ──────────────────────────────────────────────────────── */

// Prevent Chromium from throttling timers / canvas rendering when the window
// is minimised or in the background.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

app.whenReady().then(() => {
  createWindow();
  startHttpServer(profileName);
  // Kick off Tesseract initialisation immediately so it's warm by the time
  // the user starts capture. Errors surface via the ocr-status IPC event.
  initTesseract('eng');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try { httpServer?.close(); } catch (_) {}
  try { if (ocrWorker) await ocrWorker.terminate(); } catch (_) {}
});