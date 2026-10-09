const { app, BrowserWindow, Notification, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { scan, dailyStats, applyHook, HOOK_PORT } = require('./sessions');
const demo = require('./demo');

const DEMO = process.argv.includes('--demo');
const SHOT = process.env.OFFICE_SCREENSHOT; // dev helper: save a PNG and quit
if (SHOT) app.disableHardwareAcceleration();
// A window opened in the background by a Claude hook sits behind the terminal; Chromium then treats it as
// occluded and pauses requestAnimationFrame, so the canvas never paints (stays blank until you click it).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.setAppUserModelId('com.local.agentsoffice'); // needed for Windows toast notifications

let notifyEnabled = true;
ipcMain.on('notify-enabled', (_e, on) => { notifyEnabled = !!on; });

// Tell the user when a terminal starts waiting for them (permission prompt, question...).
const lastState = new Map();
function checkAlerts(win, list) {
  const seen = new Set();
  for (const s of list) {
    if (s.parent) continue;
    seen.add(s.id);
    const before = lastState.get(s.id);
    lastState.set(s.id, s.state);
    if (s.state !== 'waiting' || before === 'waiting') continue;
    if (!win.isFocused()) win.flashFrame(true);
    if (notifyEnabled && Notification.isSupported()) {
      const n = new Notification({ title: s.project + ' needs you', body: s.activity || 'Waiting for your input' });
      n.on('click', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
      n.show();
    }
  }
  for (const id of lastState.keys()) if (!seen.has(id)) lastState.delete(id);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 680,
    minWidth: 640,
    minHeight: 400,
    title: 'Agents Office',
    backgroundColor: '#1b1a24',
    autoHideMenuBar: true,
    show: false, // shown on ready-to-show: a window started by a background hook can otherwise stay unpainted
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.once('ready-to-show', () => {
    win.show();
    win.moveTop(); // launched from a hook we don't own the foreground, so just raise it without stealing focus
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  if (SHOT) win.webContents.on('console-message', (_e, ...a) => console.log('renderer:', JSON.stringify(a)));
  win.on('focus', () => win.flashFrame(false));

  const push = () => {
    if (win.isDestroyed()) return;
    const list = DEMO ? demo.tick() : scan();
    win.webContents.send('sessions', list);
    if (!DEMO) checkAlerts(win, list);
  };
  const pushStats = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('stats', DEMO ? demo.stats() : dailyStats());
  };

  // Claude Code hooks (see scripts/install-hooks.js) post their events here for instant state changes.
  let hookTimer = null;
  const hookServer = DEMO || SHOT ? null : http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') { res.statusCode = 404; res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const ev = JSON.parse(body.replace(/^﻿/, ''));
        if (process.env.OFFICE_DEBUG) fs.appendFileSync(process.env.OFFICE_DEBUG, 'hook: ' + ev.hook_event_name + ' ' + ev.session_id + ' ' + (ev.tool_name || '') + '\n'); // dev: path of a log file
        if (applyHook(ev) && !hookTimer) {
          hookTimer = setTimeout(() => { hookTimer = null; push(); }, 60);
        }
      } catch { /* malformed event */ }
      res.statusCode = 204;
      res.end();
    });
  });
  if (hookServer) {
    hookServer.on('error', () => { /* port taken: fall back to transcript detection only */ });
    hookServer.listen(HOOK_PORT, '127.0.0.1');
    win.on('closed', () => hookServer.close());
  }

  win.webContents.on('did-finish-load', () => {
    push();
    setTimeout(pushStats, 1500);
    const timer = setInterval(push, DEMO ? 4000 : 1500);
    const statsTimer = setInterval(pushStats, 60 * 1000);
    win.on('closed', () => { clearInterval(timer); clearInterval(statsTimer); });
    if (SHOT) {
      setTimeout(async () => {
        if (process.env.OFFICE_SHOT_FULL) { if (process.env.OFFICE_SHOT_JS) await win.webContents.executeJavaScript(process.env.OFFICE_SHOT_JS); await new Promise((r) => setTimeout(r, 500)); win.show(); const img = await win.webContents.capturePage(); fs.writeFileSync(SHOT, img.toPNG()); console.log('full', JSON.stringify(img.getSize())); app.quit(); return; }
        const url = await win.webContents.executeJavaScript(process.env.OFFICE_SHOT_JS || 'document.getElementById("c").toDataURL()');
        fs.writeFileSync(SHOT, Buffer.from(url.split(',')[1], 'base64'));
        app.quit();
      }, Number(process.env.OFFICE_SHOT_DELAY || 9000));
    }
  });
}

// Only one office window, no matter how many Claude sessions try to launch it.
if (!SHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) { if (w.isMinimized()) w.restore(); }
  });
  app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => app.quit());
