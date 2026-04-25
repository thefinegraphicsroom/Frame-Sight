// renderer.js  –  All renderer-side logic
'use strict';

/* ════════════════════════════════════════════════════════════════════
   DOM Shortcuts
════════════════════════════════════════════════════════════════════ */
const $  = (id)  => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* ════════════════════════════════════════════════════════════════════
   App State
════════════════════════════════════════════════════════════════════ */
const S = {
  tab: 'settings',

  // Profile
  profileName: 'HOK',

  // Capture
  sources:        [],
  selectedSource: null,
  captureStream:  null,
  captureRunning: false,

  // Canvas dimensions
  nativeW: 1920,
  nativeH: 1080,
  displayW: 0,
  displayH: 0,

  // Layers
  layers:     [],
  nextId:     1,
  counters:   {},   // { prefix: count }
  drawMode:   'text',
  labelPrefix:'Player',

  // Drag-to-draw state
  dragging:   false,
  dragStart:  null,
  tempRect:   null,

  // Engine
  engineRunning:  false,
  engineInterval: null,

  // OCR (Tesseract.js — runs natively in the main process via Node.js)
  ocrReady: false,
  tessLang: 'eng',   // language code sent to the Tesseract.js worker

  // Live data store — team keys seeded after S.leftTeamKey/rightTeamKey are declared
  liveData: {},

  // Team names (manual)
  leftTeam:     '',
  rightTeam:    '',
  leftTeamKey:  'LEFT_TEAM',
  rightTeamKey: 'RIGHT_TEAM',

  // ── Kill-gate: KDA layers only scan when a kill is detected ──────
  // Stores the last confirmed numeric kill counts from LEFT_KILL / RIGHT_KILL.
  // When either count changes, kdaTrigger is set true so the next engineTick
  // will OCR all mode==='kda' layers and then reset the flag.
  killGate: {
    leftKill:   null,   // last accepted LEFT_KILL numeric value
    rightKill:  null,   // last accepted RIGHT_KILL numeric value
    kdaTrigger: false,  // true  → scan KDA this tick then clear
  },

  // Timer tracking — each timer layer gets its own entry:
  //   { startNumeric, startWallMs, frozenDisplay? }
  //   startNumeric = the first OCR-read value in seconds
  //   startWallMs  = Date.now() at the moment of that first read
  timerTrackers: {},

  // Timer pause state
  timerPaused:     false,
  timerPauseStart: null,  // wall-clock ms when last pause began

  // Stats
  fps:       0,
  fpsCount:  0,
  fpsLast:   Date.now(),
  latency:   0,
  areasScanned: 0,

  // Network
  serverUrl: '',
  localIP:   '',
  port:      14337,

  outputFolder: null,
};

/* ════════════════════════════════════════════════════════════════════
   Toast
════════════════════════════════════════════════════════════════════ */
let toastTimer = null;
function toast(msg, duration = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ════════════════════════════════════════════════════════════════════
   Tab switching
════════════════════════════════════════════════════════════════════ */
const TAB_SIDEBAR = { settings:'tab-settings', capture:'tab-capture', live:'tab-live', info:'tab-info', debug:'tab-debug' };
const TAB_VIEW    = { settings:null, capture:'view-capture', live:'view-live', info:'view-info', debug:'view-debug' };

function setTab(name) {
  S.tab = name;

  // Sidebar tabs
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));

  // Sidebar content
  for (const [k, id] of Object.entries(TAB_SIDEBAR)) {
    $(id).style.display = k === name ? '' : 'none';
  }

  // Main views
  for (const [k, id] of Object.entries(TAB_VIEW)) {
    if (!id) continue;
    $(id).style.display  = k === name ? 'flex' : 'none';
  }

  // Settings shows no main view; just leave capture canvas visible
  if (name === 'settings') {
    $('view-capture').style.display = 'flex';
    $('view-live').style.display    = 'none';
    $('view-info').style.display    = 'none';
    $('view-debug').style.display   = 'none';
  }

  // When switching to debug tab, refresh the layer selector
  if (name === 'debug') { debugPopulateLayerSel(); kdaMonitorRender(); }
}

$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

/* ════════════════════════════════════════════════════════════════════
   Window Controls
════════════════════════════════════════════════════════════════════ */
$('win-min').addEventListener('click',   () => window.api.minimize());
$('win-max').addEventListener('click',   () => window.api.maximize());
$('win-close').addEventListener('click', () => window.api.close());

/* ════════════════════════════════════════════════════════════════════
   Server / IP
════════════════════════════════════════════════════════════════════ */
window.api.onServerUrl((url, ip, port) => {
  S.serverUrl = url;
  S.localIP   = ip;
  S.port      = port;
  $('ip-text').textContent = `IP4: ${ip}:${port}`;
  $('endpoint-url-display').textContent = url;
});

$('ip-badge').addEventListener('click', () => {
  if (S.serverUrl) {
    navigator.clipboard.writeText(S.serverUrl);
    toast('Endpoint URL copied!');
  }
});
$('endpoint-badge').addEventListener('click', () => {
  if (S.serverUrl) {
    navigator.clipboard.writeText(S.serverUrl);
    toast('Endpoint URL copied!');
  }
});

/* ════════════════════════════════════════════════════════════════════
   Profile Name sync
════════════════════════════════════════════════════════════════════ */
$('profile-name').addEventListener('change', () => {
  S.profileName = $('profile-name').value.trim() || 'HOK';
  window.api.startServer(S.profileName);
  $('endpoint-url-display').textContent = S.serverUrl.replace(/\/[^/]+\.json$/, `/${S.profileName}.json`);
});

/* ════════════════════════════════════════════════════════════════════
   Team Names (manual) — key & value both editable
════════════════════════════════════════════════════════════════════ */
function applyTeamKey(side, newKey) {
  const k = newKey.trim().toUpperCase().replace(/\s+/g, '_') || (side === 'left' ? 'LEFT_TEAM' : 'RIGHT_TEAM');
  const inputEl = $(side === 'left' ? 'left-team-key' : 'right-team-key');
  inputEl.value = k;   // normalise displayed value

  if (side === 'left') {
    const oldKey = S.leftTeamKey;
    if (oldKey !== k) {
      const val = S.liveData[oldKey] ?? S.leftTeam;
      delete S.liveData[oldKey];
      S.liveData[k] = val;
      S.leftTeamKey = k;
    }
  } else {
    const oldKey = S.rightTeamKey;
    if (oldKey !== k) {
      const val = S.liveData[oldKey] ?? S.rightTeam;
      delete S.liveData[oldKey];
      S.liveData[k] = val;
      S.rightTeamKey = k;
    }
  }
  updateJsonDisplay();
  window.api.updateData([S.liveData]);
}

function applyTeamName(side, value) {
  const v   = value.trim().toUpperCase();
  const key = side === 'left' ? S.leftTeamKey : S.rightTeamKey;
  if (side === 'left') S.leftTeam  = v;
  else                 S.rightTeam = v;
  S.liveData[key] = v;
  updateJsonDisplay();
  window.api.updateData([S.liveData]);
}

$('left-team-key').addEventListener('change',  e => applyTeamKey('left',  e.target.value));
$('right-team-key').addEventListener('change', e => applyTeamKey('right', e.target.value));
$('left-team').addEventListener('input',  e => applyTeamName('left',  e.target.value));
$('right-team').addEventListener('input', e => applyTeamName('right', e.target.value));


$('btn-window').addEventListener('click', async () => {
  $('source-picker').style.display = 'block';
  await loadSources();
});

$('btn-refresh-sources').addEventListener('click', loadSources);

async function loadSources() {
  $('source-grid').innerHTML = '<div style="color:var(--text3);font-size:11px;grid-column:span 2;text-align:center;padding:8px">Loading…</div>';
  S.sources = await window.api.getSources();
  renderSources();
}

function renderSources() {
  const grid = $('source-grid');
  grid.innerHTML = '';
  S.sources.forEach(src => {
    const card = document.createElement('div');
    card.className = 'source-card' + (S.selectedSource?.id === src.id ? ' selected' : '');
    card.innerHTML = `
      <img class="source-thumb" src="${src.thumbnail}" alt="">
      <div class="source-name" title="${src.name}">${src.name}</div>
    `;
    card.addEventListener('click', () => {
      S.selectedSource = src;
      renderSources();
      toast(`Selected: ${src.name}`);
    });
    grid.appendChild(card);
  });
}

/* ════════════════════════════════════════════════════════════════════
   Screen Capture
════════════════════════════════════════════════════════════════════ */
const video   = document.createElement('video');
video.muted   = true;
video.autoplay = true;

const canvas = $('preview-canvas');
const ctx    = canvas.getContext('2d', { willReadFrequently: true });

// FPS counter
function countFrame() {
  S.fpsCount++;
  const now = Date.now();
  const elapsed = now - S.fpsLast;
  if (elapsed >= 1000) {
    S.fps       = Math.round(S.fpsCount * 1000 / elapsed);
    S.fpsCount  = 0;
    S.fpsLast   = now;
    $('stat-fps').textContent = S.fps;
  }
}

let animFrame    = null;
let animInterval = null;
const PREVIEW_FPS = 30;

function startPreviewLoop() {
  stopPreviewLoop();

  function drawFrame() {
    if (!S.captureRunning) return;
    if (video.readyState < 2) return;

    const container = $('canvas-container');
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    S.nativeW = video.videoWidth  || 1920;
    S.nativeH = video.videoHeight || 1080;

    const ratio = S.nativeW / S.nativeH;
    let dw = cw, dh = cw / ratio;
    if (dh > ch) { dh = ch; dw = ch * ratio; }

    if (canvas.width !== Math.round(dw) || canvas.height !== Math.round(dh)) {
      canvas.width  = Math.round(dw);
      canvas.height = Math.round(dh);
      S.displayW = canvas.width;
      S.displayH = canvas.height;
      positionOverlay();
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    countFrame();
    renderLayerBoxes();
  }

  // rAF when visible (smooth), setInterval when hidden (keeps canvas live for OCR)
  function rafLoop() {
    if (!S.captureRunning) return;
    drawFrame();
    animFrame = requestAnimationFrame(rafLoop);
  }

  animFrame = requestAnimationFrame(rafLoop);

  function onVisChange() {
    if (!S.captureRunning) {
      document.removeEventListener('visibilitychange', onVisChange);
      clearInterval(animInterval); animInterval = null;
      return;
    }
    if (document.hidden) {
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      if (!animInterval) animInterval = setInterval(drawFrame, Math.round(1000 / PREVIEW_FPS));
    } else {
      clearInterval(animInterval); animInterval = null;
      animFrame = requestAnimationFrame(rafLoop);
    }
  }

  document.addEventListener('visibilitychange', onVisChange);
  S._visChangeHandler = onVisChange;
}

function stopPreviewLoop() {
  if (animFrame)    { cancelAnimationFrame(animFrame); animFrame = null; }
  if (animInterval) { clearInterval(animInterval); animInterval = null; }
  if (S._visChangeHandler) {
    document.removeEventListener('visibilitychange', S._visChangeHandler);
    S._visChangeHandler = null;
  }
}

function positionOverlay() {
  const svg = $('overlay-svg');
  const drag = $('drag-overlay');
  const rect  = canvas.getBoundingClientRect();
  const cont  = $('canvas-container').getBoundingClientRect();

  const offX = rect.left - cont.left;
  const offY = rect.top  - cont.top;

  [svg, drag].forEach(el => {
    el.style.left   = offX + 'px';
    el.style.top    = offY + 'px';
    el.style.width  = rect.width  + 'px';
    el.style.height = rect.height + 'px';
  });
}

$('btn-start-capture').addEventListener('click', async () => {
  if (S.captureRunning) {
    stopCapture();
    return;
  }

  if (!S.selectedSource) {
    // Auto-select first screen source if none chosen
    if (S.sources.length === 0) await loadSources();
    S.selectedSource = S.sources.find(s => s.id.startsWith('screen:')) || S.sources[0];
    if (!S.selectedSource) {
      toast('⚠ No capture sources found. Open Settings to pick a window.');
      return;
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource:   'desktop',
          chromeMediaSourceId: S.selectedSource.id,
          minWidth: 640, maxWidth: 4096,
          minHeight: 360, maxHeight: 4096,
        },
      },
    });

    S.captureStream  = stream;
    S.captureRunning = true;
    video.srcObject  = stream;

    await video.play();

    $('no-capture').style.display   = 'none';
    canvas.style.display            = 'block';
    $('drag-overlay').style.display = 'block';
    $('btn-start-capture').textContent = '⏹ Stop Capture';
    $('btn-start-capture').classList.replace('btn-success', 'btn-danger');
    $('btn-run-engine').disabled = false;

    // Init layer data
    S.layers.forEach(l => {
      if (!(l.name in S.liveData)) S.liveData[l.name] = 'Waiting for reading...';
    });
    updateJsonDisplay();

    startPreviewLoop();
    setTab('capture');

    // Init OCR if not already ready
    if (!S.ocrReady) initPyOCR();

  } catch (err) {
    toast('⚠ Capture failed: ' + err.message);
  }
});

function stopCapture() {
  S.captureRunning = false;
  stopPreviewLoop();
  S.captureStream?.getTracks().forEach(t => t.stop());
  S.captureStream = null;
  video.srcObject = null;

  $('no-capture').style.display   = 'flex';
  canvas.style.display            = 'none';
  $('drag-overlay').style.display = 'none';
  $('btn-start-capture').textContent = '▶ Start Capture';
  $('btn-start-capture').classList.replace('btn-danger', 'btn-success');

  stopEngine();
  $('btn-run-engine').disabled = true;
}

/* ════════════════════════════════════════════════════════════════════
   SVG Layer Overlay Rendering
════════════════════════════════════════════════════════════════════ */
const COLORS = {
  text: '#8b5cf6',
  bar:  '#22d3ee',
};

function renderLayerBoxes() {
  const svg = $('overlay-svg');
  // Keep only layer rects; temp rect handled separately
  const existing = svg.querySelectorAll('[data-layer-id]');
  const ids = new Set(S.layers.map(l => String(l.id)));

  // Remove stale
  existing.forEach(el => {
    if (!ids.has(el.dataset.layerId)) el.remove();
  });

  S.layers.forEach(layer => {
    const scaleX = S.displayW / S.nativeW;
    const scaleY = S.displayH / S.nativeH;

    const dx = layer.x * scaleX;
    const dy = layer.y * scaleY;
    const dw = layer.w * scaleX;
    const dh = layer.h * scaleY;

    const color = COLORS[layer.type] || COLORS.text;

    let group = svg.querySelector(`[data-layer-id="${layer.id}"]`);
    if (!group) {
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('data-layer-id', layer.id);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('fill',            'none');
      rect.setAttribute('stroke-width',    '1.5');
      rect.setAttribute('rx',              '2');

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('font-size',   '10');
      label.setAttribute('font-family', 'JetBrains Mono, monospace');
      label.setAttribute('dominant-baseline', 'text-before-edge');

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('rx', '2');
      bg.setAttribute('fill', 'rgba(13,11,20,0.8)');

      group.appendChild(bg);
      group.appendChild(rect);
      group.appendChild(label);
      svg.appendChild(group);
    }

    const [bg, rect, label] = group.children;

    rect.setAttribute('x',      dx);
    rect.setAttribute('y',      dy);
    rect.setAttribute('width',  dw);
    rect.setAttribute('height', dh);
    rect.setAttribute('stroke', color);

    const liveVal = S.liveData[layer.name] !== undefined
      ? `  ${String(S.liveData[layer.name]).slice(0, 20)}` : '';
    const labelText = layer.name + liveVal;

    label.setAttribute('x',     dx + 2);
    label.setAttribute('y',     dy - 12 > 0 ? dy - 12 : dy + 2);
    label.setAttribute('fill',  color);
    label.textContent = labelText;

    const textLen = labelText.length * 6.5;
    bg.setAttribute('x',      dx + 1);
    bg.setAttribute('y',      dy - 12 > 0 ? dy - 12 : dy + 1);
    bg.setAttribute('width',  textLen);
    bg.setAttribute('height', 12);
  });
}

/* ════════════════════════════════════════════════════════════════════
   Drag-to-Draw Regions
════════════════════════════════════════════════════════════════════ */
const dragEl = $('drag-overlay');

dragEl.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const r = dragEl.getBoundingClientRect();
  S.dragging  = true;
  S.dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  S.tempRect  = null;
});

dragEl.addEventListener('mousemove', e => {
  if (!S.dragging) return;
  const r = dragEl.getBoundingClientRect();
  const cur = { x: e.clientX - r.left, y: e.clientY - r.top };

  S.tempRect = {
    x: Math.min(S.dragStart.x, cur.x),
    y: Math.min(S.dragStart.y, cur.y),
    w: Math.abs(cur.x - S.dragStart.x),
    h: Math.abs(cur.y - S.dragStart.y),
  };
  drawTempRect();
});

dragEl.addEventListener('mouseup', e => {
  if (!S.dragging) return;
  S.dragging = false;

  removeTempRect();

  if (!S.tempRect || S.tempRect.w < 5 || S.tempRect.h < 5) return;

  // Convert display coords → native coords
  const scaleX = S.nativeW / S.displayW;
  const scaleY = S.nativeH / S.displayH;

  const nativeLayer = {
    id:   S.nextId++,
    name: generateName(),
    type: S.drawMode,
    mode: 'all',
    brightText: true,
    expanded: true,
    x: Math.round(S.tempRect.x * scaleX),
    y: Math.round(S.tempRect.y * scaleY),
    w: Math.round(S.tempRect.w * scaleX),
    h: Math.round(S.tempRect.h * scaleY),
  };

  S.layers.push(nativeLayer);
  S.liveData[nativeLayer.name] = 'Waiting for reading...';
  updateJsonDisplay();
  renderLayerList();
  renderLayerBoxes();
  toast(`Layer "${nativeLayer.name}" created`);
  S.tempRect = null;
});

dragEl.addEventListener('mouseleave', () => {
  if (S.dragging) {
    S.dragging = false;
    removeTempRect();
  }
});

let tempRectEl = null;
function drawTempRect() {
  removeTempRect();
  if (!S.tempRect) return;
  const { x, y, w, h } = S.tempRect;
  const color = COLORS[S.drawMode] || COLORS.text;

  tempRectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  tempRectEl.setAttribute('x',            x);
  tempRectEl.setAttribute('y',            y);
  tempRectEl.setAttribute('width',        w);
  tempRectEl.setAttribute('height',       h);
  tempRectEl.setAttribute('fill',         color.replace(')', ',0.1)').replace('rgb','rgba'));
  tempRectEl.setAttribute('stroke',       color);
  tempRectEl.setAttribute('stroke-width', '1.5');
  tempRectEl.setAttribute('stroke-dasharray', '4 3');
  tempRectEl.setAttribute('rx',           '2');
  $('overlay-svg').appendChild(tempRectEl);
}

function removeTempRect() {
  if (tempRectEl) { tempRectEl.remove(); tempRectEl = null; }
}

function generateName() {
  const prefix = $('label-prefix')?.value?.trim() || 'Player';
  S.counters[prefix] = (S.counters[prefix] || 0) + 1;
  return `${prefix}${S.counters[prefix]}`;
}

/* ════════════════════════════════════════════════════════════════════
   Layer List Rendering
════════════════════════════════════════════════════════════════════ */
function renderLayerList() {
  const list = $('layer-list');

  if (S.layers.length === 0) {
    list.innerHTML = '<div style="color:var(--text3);font-size:11px;text-align:center;padding:16px 0">No layers yet. Draw regions on the canvas.</div>';
    debugPopulateLayerSel();
    return;
  }

  list.innerHTML = '';
  S.layers.forEach(layer => {
    const card = document.createElement('div');
    card.className = 'layer-card fade-in';
    card.dataset.id = layer.id;

    const ico = layer.type === 'bar' ? '📊' : '🅣';

    card.innerHTML = `
      <div class="layer-head">
        <span class="layer-ico">${ico}</span>
        <span class="layer-name">${layer.name}</span>
        <span class="layer-toggle ${layer.expanded ? 'open' : ''}">▼</span>
      </div>
      <div class="layer-body" style="${layer.expanded ? '' : 'display:none'}">
        <input class="layer-name-input" type="text" value="${layer.name}" placeholder="Layer name">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
          <div class="layer-field">
            <label>Processing Mode</label>
            <select class="layer-mode">
              <option value="all"     ${layer.mode==='all'    ?'selected':''}>All Characters</option>
              <option value="numbers" ${layer.mode==='numbers'?'selected':''}>Numbers Only</option>
              <option value="timer"   ${layer.mode==='timer'  ?'selected':''}>Timer (mm:ss)</option>
              <option value="kills"   ${layer.mode==='kills'  ?'selected':''}>Kills (0–99, max +1)</option>
              <option value="gold"    ${layer.mode==='gold'   ?'selected':''}>Gold (X.XK, max +1K)</option>
              <option value="turret"  ${layer.mode==='turret' ?'selected':''}>Turret (0–9, max +1)</option>
              <option value="tyrant"     ${layer.mode==='tyrant'    ?'selected':''}>Tyrant (0–9, max +1)</option>
              <option value="level"      ${layer.mode==='level'     ?'selected':''}>Player Level (max +1)</option>
              <option value="obj_timer"  ${layer.mode==='obj_timer' ?'selected':''}>Objective Timer (respawn cycle)</option>
              <option value="kda"        ${layer.mode==='kda'       ?'selected':''}>KDA (K/D/A)</option>
            </select>
          </div>
          <div class="layer-field">
            <label>Game Text Color</label>
            <label class="checkbox-wrap" style="margin-top:4px">
              <input type="checkbox" class="bright-check" ${layer.brightText?'checked':''}> White/Bright Text
            </label>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:5px;margin-bottom:8px">
          <div class="layer-field">
            <label>X</label>
            <input type="number" class="coord-x" value="${layer.x}">
          </div>
          <div class="layer-field">
            <label>Y</label>
            <input type="number" class="coord-y" value="${layer.y}">
          </div>
          <div class="layer-field">
            <label>W</label>
            <input type="number" class="coord-w" value="${layer.w}">
          </div>
          <div class="layer-field">
            <label>H</label>
            <input type="number" class="coord-h" value="${layer.h}">
          </div>
        </div>
        <div style="text-align:right">
          <button class="btn-delete">🗑 Delete Layer</button>
        </div>
      </div>
    `;

    // Events
    card.querySelector('.layer-head').addEventListener('click', () => {
      layer.expanded = !layer.expanded;
      card.querySelector('.layer-toggle').className = 'layer-toggle' + (layer.expanded ? ' open' : '');
      card.querySelector('.layer-body').style.display = layer.expanded ? '' : 'none';
    });

    // Name change
    const nameInput = card.querySelector('.layer-name-input');
    nameInput.addEventListener('change', () => {
      const oldName = layer.name;
      const newName = nameInput.value.trim();
      if (!newName || newName === oldName) return;
      layer.name = newName;
      if (oldName in S.liveData) {
        S.liveData[newName] = S.liveData[oldName];
        delete S.liveData[oldName];
      }
      card.querySelector('.layer-name').textContent = newName;
      updateJsonDisplay();
      renderLayerBoxes();
    });

    // Mode
    card.querySelector('.layer-mode').addEventListener('change', e => { layer.mode = e.target.value; });

    // Bright text
    card.querySelector('.bright-check').addEventListener('change', e => { layer.brightText = e.target.checked; });

    // Coords
    ['x','y','w','h'].forEach(coord => {
      card.querySelector('.coord-' + coord).addEventListener('change', e => {
        layer[coord] = parseInt(e.target.value) || 0;
        renderLayerBoxes();
      });
    });

    // Delete
    card.querySelector('.btn-delete').addEventListener('click', () => {
      S.layers = S.layers.filter(l => l.id !== layer.id);
      delete S.liveData[layer.name];
      updateJsonDisplay();
      renderLayerList();
      renderLayerBoxes();
      toast(`Layer "${layer.name}" deleted`);
    });

    list.appendChild(card);
  });

  // Keep debug layer selector in sync
  debugPopulateLayerSel();
}

/* ════════════════════════════════════════════════════════════════════
   Draw Mode Buttons
════════════════════════════════════════════════════════════════════ */
$('draw-text').addEventListener('click', () => {
  S.drawMode = 'text';
  $('draw-text').classList.add('active');
  $('draw-bar').classList.remove('active');
});
$('draw-bar').addEventListener('click', () => {
  S.drawMode = 'bar';
  $('draw-bar').classList.add('active');
  $('draw-text').classList.remove('active');
});

/* ════════════════════════════════════════════════════════════════════
   Python pytesseract OCR — sidecar init
════════════════════════════════════════════════════════════════════ */

// Listen for status pushed from main process when the Tesseract.js worker starts
window.api.onOcrStatus((status, detail) => {
  if (status === 'ready') {
    S.ocrReady = true;
    toast('✅ OCR engine ready (Tesseract.js)');
    // Enable the engine button if capture is already running
    if (S.captureRunning) $('btn-run-engine').disabled = false;
  } else if (status === 'error') {
    S.ocrReady = false;
    toast('⚠ OCR init failed: ' + (detail || 'unknown error'), 5000);
    console.error('[OCR Error]', detail);
  }
});

async function initPyOCR() {
  toast('⏳ Initialising Tesseract.js OCR engine…');
  // Poll until the Tesseract.js worker signals ready (it warms up on app start)
  let attempts = 0;
  const check = async () => {
    const ready = await window.api.checkOcr();
    if (ready) {
      S.ocrReady = true;
      toast('✅ OCR engine ready (Tesseract.js)');
    } else if (attempts++ < 30) {
      setTimeout(check, 500);   // retry every 500 ms, up to 15 s
    } else {
      toast('⚠ OCR engine did not start. Check that tesseract.js is installed (npm install).', 6000);
    }
  };
  check();
}

function getWhitelist(mode) {
  if (mode === 'numbers') return '0123456789';
  if (mode === 'timer')   return '0123456789:';
  // Gold: include S because OCR frequently misreads K→S and 5→S
  if (mode === 'gold')    return '0123456789.KkSs';
  if (mode === 'kills')   return '0123456789';
  if (mode === 'turret')  return '0123456789';
  if (mode === 'tyrant')  return '0123456789';
  if (mode === 'level')   return '0123456789';
  if (mode === 'obj_timer')  return '0123456789:'; // countdown timer digits only
  if (mode === 'kda')        return '0123456789/oO'; // digits + slash; oO caught by cleaner → 0
  return null;
}

/* ════════════════════════════════════════════════════════════════════
   Gold OCR correction — fix common Tesseract misreads before parsing
════════════════════════════════════════════════════════════════════ */
function correctGoldOcr(raw) {
  let s = raw.toUpperCase().replace(/\s+/g, '');

  // Step 1: Fix letter → digit substitutions Tesseract makes
  s = s.replace(/O/g,'0').replace(/[IL]/g,'1').replace(/B/g,'8').replace(/G/g,'6');

  // Step 2: S at end = K (most common misread of K suffix)
  s = s.replace(/S$/, 'K');

  // Step 3: Normalise separator — comma or space between digits = decimal dot
  s = s.replace(/(\d)[, ](\d)/g, '$1.$2');

  // Step 4: Missing dot — insert before the LAST digit that precedes K
  // Handles both 1-digit whole (5K→5.0K handled below) and 2-digit whole:
  //   "53K"  → "5.3K"   (5 whole, .3 frac)
  //   "103K" → "10.3K"  (10 whole, .3 frac)
  //   "186K" → "18.6K"
  // Rule: if digits before K have no dot, last digit becomes the fraction
  s = s.replace(/^(\d+)(\d)K$/, (_, head, frac) => {
    // Only apply if there's no dot already and at least 2 digits total
    return `${head}.${frac}K`;
  });

  // Step 5: Single digit no K and no dot — "5" alone after all fixes → "5.0K"
  // (catches a completely blank K suffix read)
  if (/^\d$/.test(s)) s = `${s}.0K`;

  // Step 6: Has dot but no K at end → append K  (e.g. "10.3" → "10.3K")
  if (/^\d+\.\d$/.test(s)) s += 'K';

  // Step 7: Single digit + K, no dot → X.0K  (e.g. "5K" → "5.0K")
  s = s.replace(/^(\d)K$/, '$1.0K');

  return s;
}

/* ════════════════════════════════════════════════════════════════════
   KDA OCR correction — normalise noisy Tesseract output before parse

   Returns an object:
     { cleaned: string, components: [k, d, a] | null, digitTokens: string[] }

   digitTokens is the character-by-character split for debug logging.
   components is null if we don't yet have a valid 3-part split.
════════════════════════════════════════════════════════════════════ */

// Max realistic value per KDA component. Values above this are treated
// as artifact-corrupted and the last digit is extracted instead.
const KDA_MAX_COMPONENT_VALUE = 30;
// Prefix digits that signal a "7X" (or similar) artifact merge:
// OCR noise manifests as a leading 7 prepended to the real single digit.
const KDA_ARTIFACT_PREFIXES = [7, 6]; // 7x most common; 6x less so

function correctKdaOcr(raw) {
  let s = raw;

  // Step 1: Replace common letter→digit misreads
  //   o / O  → 0   (round letter ↔ zero)
  //   l / I  → 1   (narrow verticals)
  //   S      → 5   (curve similarity)
  //   B      → 8
  s = s.replace(/[oO]/g, '0')
       .replace(/[lI]/g, '1')
       .replace(/S/g, '5')
       .replace(/B/g, '8');

  // Step 2: Strip ALL whitespace — handles "1 / 2 / 3", "0/0 / 0" etc.
  s = s.replace(/\s+/g, '');

  // Step 3: Collapse consecutive slashes → single slash (e.g. "1//2" → "1/2")
  s = s.replace(/\/+/g, '/');

  // Step 4: Strip any leading/trailing slashes
  s = s.replace(/^\/+|\/+$/g, '');

  // Step 5: Remove non-digit, non-slash characters that survived
  s = s.replace(/[^0-9/]/g, '');

  // Step 6a: Missing-slash recovery — handles the case where OCR reads '/'
  // as a digit (typically 7 or 6), collapsing two components into one.
  // Pattern: we have only 2 parts but one part is exactly 3 digits whose
  // MIDDLE digit is a known slash-artifact (7 or 6).
  //   e.g.  "1/474"  → parts ["1","474"] → middle of "474" is 7 → "1/4/4"
  //         "1/464"  → middle of "464" is 6 → "1/4/4"
  // We try every part in a 2-part split; the first successful expansion wins.
  const partsRaw = s.split('/');
  if (partsRaw.length === 2) {
    for (let i = 0; i < partsRaw.length; i++) {
      const p = partsRaw[i];
      if (p.length === 3 && KDA_ARTIFACT_PREFIXES.includes(parseInt(p[1], 10))) {
        const expanded = `${p[0]}/${p[2]}`;
        const rebuilt  = [...partsRaw.slice(0, i), expanded, ...partsRaw.slice(i + 1)].join('/');
        console.log(
          `[KDA SLASH-ART] part[${i}] "${p}" — middle "${p[1]}" is slash artifact`
          + ` → expanded to "${expanded}" → "${rebuilt}"`
        );
        s = rebuilt;
        break;
      }
    }
  }

  // Build digit token array for debug (each char is a token, after all recovery)
  const digitTokens = s.split('');

  const parts = s.split('/');
  let correctedParts = null;
  if (parts.length === 3) {
    correctedParts = parts.map((p, idx) => {
      const n = parseInt(p, 10);
      if (isNaN(n) || n <= KDA_MAX_COMPONENT_VALUE) return p; // fine
      // Two-digit artifact candidate
      if (p.length === 2) {
        const leading = parseInt(p[0], 10);
        if (KDA_ARTIFACT_PREFIXES.includes(leading)) {
          const corrected = p[p.length - 1]; // last digit is the real value
          console.log(
            `[KDA ARTIFACT] component[${idx}] "${p}" (${n}) > max ${KDA_MAX_COMPONENT_VALUE}`
            + ` → prefix "${leading}" stripped → "${corrected}"`
          );
          return corrected;
        }
      }
      // Longer artifact or unknown pattern: keep last digit as best guess
      const fallback = p[p.length - 1] || '0';
      console.log(
        `[KDA ARTIFACT] component[${idx}] "${p}" > max ${KDA_MAX_COMPONENT_VALUE}`
        + ` → fallback last digit "${fallback}"`
      );
      return fallback;
    });
    s = correctedParts.join('/');
  }

  return { cleaned: s, components: correctedParts, digitTokens };
}


async function ocrLayer(layer) {
  if (!S.ocrReady) return null;

  const offscreen = document.createElement('canvas');
  offscreen.width  = Math.max(1, layer.w);
  offscreen.height = Math.max(1, layer.h);
  const octx = offscreen.getContext('2d');
  octx.drawImage(video, layer.x, layer.y, layer.w, layer.h, 0, 0, layer.w, layer.h);

  const imgData = octx.getImageData(0, 0, offscreen.width, offscreen.height);
  const ppCfg = layer.ppMode
    ? { mode: layer.ppMode, threshold: layer.ppThresh ?? 128, redBoost: layer.ppBoost ?? 2 }
    : { mode: layer.brightText ? 'bright' : 'dark', threshold: layer.brightText ? 140 : 100, redBoost: 2 };
  preprocessImage(imgData, ppCfg);
  octx.putImageData(imgData, 0, 0);

  try {
    const base64 = offscreen.toDataURL('image/png').split(',')[1];

    // ── ROI debug log for KDA layers ──────────────────────────────
    if (layer.mode === 'kda') {
      const scaleX = (S.displayW / S.nativeW).toFixed(2);
      const scaleY = (S.displayH / S.nativeH).toFixed(2);
      console.log(
        `[OCR ROI] ${layer.name}: ${layer.w}x${layer.h}px native`
        + ` | display scale ${scaleX}x${scaleY}`
        + ` | offscreen ${offscreen.width}x${offscreen.height}px`
      );
    }

    const text = await window.api.ocrImage({
      id:        ocrIdCounter++,
      image:     base64,
      lang:      S.tessLang,
      whitelist: getWhitelist(layer.mode) || '',
    });
    return text; // raw — SmartFilter cleans below
  } catch (_) {
    return null;
  }
}

// Per-call ID counter for OCR requests
let ocrIdCounter = 0;

/* ════════════════════════════════════════════════════════════════════
   SmartFilter — format enforcement + jump limiting per mode
════════════════════════════════════════════════════════════════════ */
const filterState = {}; // name → { display, numeric, staleCount }

function parseRaw(mode, raw) {
  if (!raw) return null;
  const s = raw.trim();

  switch (mode) {

    case 'timer': {
      const m = s.match(/(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const mins = parseInt(m[1]);
      const secs = parseInt(m[2]);
      if (secs > 59) return null;
      const numeric = mins * 60 + secs;
      const display = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      return { display, numeric };
    }

    case 'gold': {
      const corrected = correctGoldOcr(s);
      // Match X.XK, XX.XK, XXX.XK  (e.g. 1.5K – 999.9K)
      const m = corrected.match(/^(\d{1,3})\.(\d)K$/);
      if (!m) return null;
      const whole   = parseInt(m[1]);
      const frac    = parseInt(m[2]);
      // Reject clearly impossible values (0.XK is always a misread)
      if (whole === 0 && frac === 0) return null;
      const numeric = whole + frac / 10;
      const display = `${whole}.${frac}K`;
      return { display, numeric };
    }

    case 'kills': {
      const clean = s.replace(/[^0-9]/g, '');
      if (!clean) return null;
      const numeric = parseInt(clean);
      if (isNaN(numeric) || numeric > 99) return null;
      return { display: String(numeric), numeric };
    }

    case 'turret': {
      const clean = s.replace(/[^0-9]/g, '');
      if (!clean) return null;
      const numeric = parseInt(clean);
      if (isNaN(numeric) || numeric > 11) return null;
      return { display: String(numeric), numeric };
    }

    case 'tyrant': {
      const clean = s.replace(/[^0-9]/g, '');
      if (!clean) return null;
      const numeric = parseInt(clean);
      if (isNaN(numeric) || numeric > 9) return null;
      return { display: String(numeric), numeric };
    }

    case 'level': {
      const clean = s.replace(/[^0-9]/g, '');
      if (!clean) return null;
      const numeric = parseInt(clean);
      if (isNaN(numeric) || numeric < 1 || numeric > 99) return null;
      return { display: String(numeric), numeric };
    }

    case 'numbers': {
      const clean = s.replace(/[^0-9]/g, '');
      if (!clean) return null;
      const numeric = parseInt(clean);
      return { display: clean, numeric };
    }

    case 'kda': {
      // Clean + artifact-correct first, then strictly validate
      const { cleaned } = correctKdaOcr(s);
      // Accept ONLY \d{1,2}/\d{1,2}/\d{1,2}  — no extra segments, no missing parts
      const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/);
      if (!m) return null;
      const k = parseInt(m[1]);
      const d = parseInt(m[2]);
      const a = parseInt(m[3]);
      // Sanity: individual components max 99; reject anything absurd
      if (k > 99 || d > 99 || a > 99) return null;
      return {
        display: `${k}/${d}/${a}`,
        numeric: k * 10000 + d * 100 + a,
        k, d, a,
      };
    }

    case 'obj_timer': {
      // Countdown timer format mm:ss — same parse as 'timer'
      const m = s.match(/(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const mins = parseInt(m[1]);
      const secs = parseInt(m[2]);
      if (secs > 59) return null;
      const numeric = mins * 60 + secs;
      const display = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      return { display, numeric };
    }

    default:
      return null;
  }
}

const MAX_JUMP = {
  timer:   2,        // max 2 seconds change per read (covers slow OCR cycles)
  gold:    1.0,      // max +1.0K change per read
  kills:   2,        // max +2 kills per read
  turret:  1,        // max +1 turret per read
  tyrant:  1,        // max +1 tyrant per read
  level:   1,        // max +1 level per read
  numbers: Infinity, // generic numbers — no jump limit
  obj_timer:  5,     // max 5 seconds jump per read (covers OCR lag); reset handled by state machine
  kda:     Infinity, // KDA uses per-component smoothing — not packed-numeric jump limit
};

// Modes where values can only go up (never decrease during a match)
// NOTE: 'timer' is intentionally excluded — game timers count DOWN.
const MONOTONIC_UP = new Set(['kills', 'turret', 'tyrant', 'gold', 'level']);

/* ════════════════════════════════════════════════════════════════════
   KDA Smart Filter — per-component temporal smoothing
   Each of K, D, A is validated independently:
     • K and A can increase OR stay the same (kills / assists accumulate)
     • D can increase OR stay the same (deaths accumulate)
     • Max allowed jump per component per tick: KDA_MAX_COMPONENT_JUMP
     • A component that suddenly jumps by more than the limit is treated
       as an OCR misread → the PREVIOUS value for that component is kept.
   This catches "1/2/7" when real value is "1/2/1" without discarding the
   whole KDA — only the spiking component is corrected.
════════════════════════════════════════════════════════════════════ */

// Max single-tick increase allowed per K, D, or A component.
// KDA values only ever increase (kills/deaths/assists never go backwards).
// A jump of >2 in one tick is almost certainly an OCR misread.
const KDA_MAX_COMPONENT_JUMP = 2;

// name → { k, d, a, display, staleCount }
const kdaState = {};

function applyKdaFilter(layer, rawText) {
  const name   = layer.name;
  const raw    = rawText || '';

  // ── Debug: raw OCR output ────────────────────────────────────────
  console.log(`[OCR RAW] ${name}: "${raw}"`);

  // ── Clean + artifact-correct ─────────────────────────────────────
  const { cleaned, digitTokens } = correctKdaOcr(raw);

  console.log(`[OCR CLEANED] ${name}: "${cleaned}"`);
  console.log(`[OCR DIGITS]  ${name}: [${digitTokens.map(t => `'${t}'`).join(', ')}]`);

  // ── Parse (strict format gate) ───────────────────────────────────
  const parsed = parseRaw('kda', cleaned);
  const prev   = kdaState[name];

  if (!parsed) {
    if (prev) prev.staleCount = (prev.staleCount || 0) + 1;
    const fallback = prev ? prev.display : null;
    console.log(`[OCR CORRECTED] ${name}: INVALID — kept "${fallback ?? 'none'}"`
      + ` (stale=${prev?.staleCount ?? 0})`);
    kdaMonitorPush(name, raw, cleaned, fallback ?? '—', 'invalid', `bad format (stale=${prev?.staleCount ?? 0})`);
    return fallback;
  }

  // ── First ever reading — accept unconditionally ──────────────────
  if (!prev) {
    kdaState[name] = { k: parsed.k, d: parsed.d, a: parsed.a, display: parsed.display, staleCount: 0 };
    console.log(`[OCR CORRECTED] ${name}: "${parsed.display}" (first reading)`);
    kdaMonitorPush(name, raw, cleaned, parsed.display, 'ok', 'first reading');
    return parsed.display;
  }

  // ── Per-component temporal smoothing ────────────────────────────
  let { k, d, a } = parsed;
  let corrected = false;
  const reasons = [];

  // Rule 1 — Monotonic: KDA only ever increases during a match
  if (k < prev.k) { reasons.push(`K↓${prev.k}→${k}`); k = prev.k; corrected = true; }
  if (d < prev.d) { reasons.push(`D↓${prev.d}→${d}`); d = prev.d; corrected = true; }
  if (a < prev.a) { reasons.push(`A↓${prev.a}→${a}`); a = prev.a; corrected = true; }

  // Rule 2 — Spike cap: reject single-tick jumps above max
  if (k - prev.k > KDA_MAX_COMPONENT_JUMP) {
    reasons.push(`K spike ${prev.k}→${k}`);
    k = prev.k; corrected = true;
  }
  if (d - prev.d > KDA_MAX_COMPONENT_JUMP) {
    reasons.push(`D spike ${prev.d}→${d}`);
    d = prev.d; corrected = true;
  }
  if (a - prev.a > KDA_MAX_COMPONENT_JUMP) {
    reasons.push(`A spike ${prev.a}→${a}`);
    a = prev.a; corrected = true;
  }

  const display = `${k}/${d}/${a}`;
  kdaState[name] = { k, d, a, display, staleCount: 0 };

  if (corrected) {
    console.log(`[OCR CORRECTED] ${name}: "${parsed.display}" → "${display}" | reasons: ${reasons.join('; ')}`);
    kdaMonitorPush(name, raw, cleaned, display, 'corrected', reasons.join('; '));
  } else {
    console.log(`[OCR CORRECTED] ${name}: "${display}" (accepted as-is)`);
    kdaMonitorPush(name, raw, cleaned, display, 'ok', '');
  }

  return display;
}

function resetKdaFilter(name) {
  delete kdaState[name];
  delete kdaMonitorData[name];
}

/* ════════════════════════════════════════════════════════════════════
   KDA Live Monitor — collects per-tick data and renders into #view-debug
════════════════════════════════════════════════════════════════════ */
const KDA_HISTORY_MAX = 30; // rows kept per player

// name → { raw, cleaned, final, status, reason, history: [{time,raw,cleaned,final,status}] }
const kdaMonitorData = {};

function kdaMonitorPush(name, raw, cleaned, final, status, reason) {
  if (!kdaMonitorData[name]) {
    kdaMonitorData[name] = { raw: '', cleaned: '', final: '', status: 'stale', reason: '', history: [] };
  }
  const entry = kdaMonitorData[name];
  entry.raw     = raw;
  entry.cleaned = cleaned;
  entry.final   = final;
  entry.status  = status;
  entry.reason  = reason;

  // Push to front of history
  const now = new Date();
  const ts  = `${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0').slice(0,2)}`;
  entry.history.unshift({ time: ts, raw, cleaned, final, status });
  if (entry.history.length > KDA_HISTORY_MAX) entry.history.pop();
}

function kdaMonitorRender() {
  const body   = $('kda-monitor-body');
  const tickEl = $('kda-mon-tick');
  const sel    = $('kda-layer-sel');
  if (!body || !sel) return;

  // Find all KDA layers
  const kdaLayers = S.layers.filter(l => l.mode === 'kda');

  // Rebuild the dropdown if layer list changed
  const selNames = Array.from(sel.options).slice(1).map(o => o.value);
  const layerNames = kdaLayers.map(l => l.name);
  if (JSON.stringify(selNames) !== JSON.stringify(layerNames)) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">— pick a KDA layer —</option>';
    kdaLayers.forEach(l => {
      const o = document.createElement('option');
      o.value = l.name;
      o.textContent = l.name;
      if (l.name === prev) o.selected = true;
      sel.appendChild(o);
    });
    // Auto-select first if nothing selected
    if (!sel.value && kdaLayers.length > 0) sel.value = kdaLayers[0].name;
  }

  if (kdaLayers.length === 0) {
    body.innerHTML = '<div class="kda-mon-empty">No KDA layers detected yet.<br>Add a layer with mode <b style="color:var(--purple3)">⚔️ KDA</b> and start the engine.</div>';
    if (tickEl) tickEl.textContent = 'no KDA layers';
    return;
  }

  const selectedName = sel.value;
  if (!selectedName) {
    body.innerHTML = '<div class="kda-mon-empty">Select a KDA layer above to monitor it.</div>';
    if (tickEl) tickEl.textContent = 'none selected';
    return;
  }

  const layer = kdaLayers.find(l => l.name === selectedName);
  if (!layer) return;

  const now = new Date();
  const ts  = `${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  if (tickEl) tickEl.textContent = `updated ${ts}`;

  const d      = kdaMonitorData[selectedName];
  const raw     = d ? escapeHtml(d.raw     || '—') : '—';
  const cleaned = d ? escapeHtml(d.cleaned || '—') : '—';
  const final   = d ? escapeHtml(d.final   || '—') : '—';
  const status  = d ? d.status : 'stale';
  const reason  = d ? escapeHtml(d.reason  || '')  : '';
  const roiW = layer.w, roiH = layer.h;

  let html = `<div class="kda-player-block">`;
  html += `<div class="kda-player-name">⚔️ ${escapeHtml(selectedName)} <span style="font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace">${roiW}×${roiH}px ROI</span></div>`;

  // Current tick rows
  html += `<div class="kda-row">
    <div class="kda-row-label">Raw OCR</div>
    <div class="kda-cell raw" style="grid-column:2/6">${raw}</div>
  </div>`;
  html += `<div class="kda-row">
    <div class="kda-row-label">Cleaned</div>
    <div class="kda-cell cleaned" style="grid-column:2/5">${cleaned}</div>
    <div class="kda-status-badge ${status}">${status.toUpperCase()}</div>
  </div>`;
  html += `<div class="kda-row">
    <div class="kda-row-label">Final</div>
    <div class="kda-cell final ${status}" style="grid-column:2/5">${final}</div>
    <div style="font-size:9px;color:var(--text3);grid-column:5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${reason}">${reason ? '⚠ ' + reason : '✓'}</div>
  </div>`;

  // History table
  if (d && d.history.length > 0) {
    html += `<div class="kda-history">
      <div class="kda-history-header">
        <span>Time</span><span>Raw</span><span>Cleaned</span><span>Final</span><span>Status</span>
      </div>
      <div class="kda-history-body">`;
    d.history.forEach(h => {
      html += `<div class="kda-history-row">
        <span class="time">${h.time}</span>
        <span>${escapeHtml(h.raw || '—')}</span>
        <span>${escapeHtml(h.cleaned || '—')}</span>
        <span class="${h.status}">${escapeHtml(h.final || '—')}</span>
        <span class="${h.status}">${h.status}</span>
      </div>`;
    });
    html += `</div></div>`;
  }

  html += `</div>`;
  body.innerHTML = html;
}


   /*Handles the respawn cycle: ALIVE → RESPAWNING → SPAWNING → ALIVE
   Each objective timer (TY_TIME, OLORD_TIME etc.) gets its own state.

   States:
     ALIVE      — objective is alive; timer not visible; output = "ALIVE"
     RESPAWNING — countdown running (visible); output = "MM:SS"
     SPAWNING   — reached 00:01, held for 1 tick; output = "SPAWNING"

   Transitions:
     ALIVE      + valid timer OCR  → RESPAWNING
     RESPAWNING + valid timer OCR  → RESPAWNING (update display)
     RESPAWNING + null OCR         → SPAWNING  (timer just disappeared)
     SPAWNING   + any              → ALIVE      (one tick grace)
     ALIVE      + null OCR         → ALIVE      (stay waiting)
════════════════════════════════════════════════════════════════════ */

// name → { phase, lastNumeric, spawnTick }
const objTimerState = {};

// companion state key suffix written into liveData alongside the timer value
const OBJ_STATE_SUFFIX = '_STATE';

function applyObjTimer(layer, rawText) {
  const name    = layer.name;
  const parsed  = parseRaw('obj_timer', rawText);   // null if OCR empty / no match
  const stateKey = name + OBJ_STATE_SUFFIX;

  // Bootstrap state on first call
  if (!objTimerState[name]) {
    objTimerState[name] = { phase: 'ALIVE', lastNumeric: null, spawnTick: false };
  }

  const st = objTimerState[name];

  switch (st.phase) {

    case 'ALIVE':
      if (parsed !== null) {
        // Timer just appeared → new respawn cycle begins
        st.phase       = 'RESPAWNING';
        st.lastNumeric = parsed.numeric;
        st.spawnTick   = false;
        S.liveData[stateKey] = 'RESPAWNING';
        console.log(`[ObjTimer] "${name}" ALIVE → RESPAWNING @ ${parsed.display}`);
        return parsed.display;
      }
      // No timer visible — remain ALIVE
      S.liveData[stateKey] = 'ALIVE';
      return 'ALIVE';

    case 'RESPAWNING': {
      if (parsed !== null) {
        // Sanity: timer must be counting DOWN (or same, for stale OCR)
        // Allow up to MAX_JUMP[obj_timer] seconds gap in either direction
        // so a brief misread doesn't reset the cycle.
        const jump = parsed.numeric - st.lastNumeric;
        if (jump > MAX_JUMP.obj_timer) {
          // Suspiciously large upward jump → treat as OCR noise; keep last
          console.log(`[ObjTimer] "${name}" RESPAWNING — upward jump ${jump}s rejected`);
          S.liveData[stateKey] = 'RESPAWNING';
          return st.lastDisplay || parsed.display;
        }
        st.lastNumeric = parsed.numeric;
        st.lastDisplay = parsed.display;

        // Entering final second — next disappearance will be SPAWNING
        if (parsed.numeric <= 1) {
          st.spawnTick = true;
        }

        S.liveData[stateKey] = 'RESPAWNING';
        return parsed.display;
      }

      // Timer disappeared
      if (st.spawnTick) {
        // Was at 00:01, now gone → objective is spawning
        st.phase     = 'SPAWNING';
        st.spawnTick = false;
        S.liveData[stateKey] = 'SPAWNING';
        console.log(`[ObjTimer] "${name}" RESPAWNING → SPAWNING`);
        return 'SPAWNING';
      }

      // Timer disappeared without reaching 00:01 (e.g. brief OCR miss)
      // Give it one more tick with state intact before giving up
      if (!st._missTick) {
        st._missTick = true;
        S.liveData[stateKey] = 'RESPAWNING';
        return st.lastDisplay || 'RESPAWNING';
      }
      // Two consecutive misses → treat as ALIVE (timer really gone)
      st.phase      = 'ALIVE';
      st._missTick  = false;
      st.lastNumeric = null;
      st.lastDisplay = null;
      S.liveData[stateKey] = 'ALIVE';
      console.log(`[ObjTimer] "${name}" RESPAWNING → ALIVE (timer disappeared early)`);
      return 'ALIVE';
    }

    case 'SPAWNING':
      // One grace tick — then move to ALIVE regardless of OCR
      st.phase      = 'ALIVE';
      st.lastNumeric = null;
      st.lastDisplay = null;
      st._missTick  = false;
      S.liveData[stateKey] = 'ALIVE';
      console.log(`[ObjTimer] "${name}" SPAWNING → ALIVE`);
      return 'ALIVE';

    default:
      st.phase = 'ALIVE';
      return 'ALIVE';
  }
}

function resetObjTimer(name) {
  delete objTimerState[name];
  // Also clear the companion state key from liveData
  delete S.liveData[name + OBJ_STATE_SUFFIX];
}

function applyFilter(layer, rawText) {
  const mode = layer.mode;
  const name = layer.name;

  // ── Objective Timer — dedicated state machine, never freezes ──────
  if (mode === 'obj_timer') return applyObjTimer(layer, rawText);

  // ── KDA — per-component temporal smoothing ────────────────────────
  if (mode === 'kda') return applyKdaFilter(layer, rawText);

  // ── Game Timer — wall-clock counter seeded by first OCR read ──────
  if (mode === 'timer') {
    const tracker = S.timerTrackers[name];

    if (!tracker) {
      // Not yet started — try to parse OCR and seed the tracker
      const parsed = parseRaw('timer', rawText);
      if (!parsed) return null;

      // First valid read — record base value and wall-clock start time
      S.timerTrackers[name] = {
        startNumeric: parsed.numeric,
        startWallMs:  Date.now(),
      };

      return parsed.display;
    }

    // Timer already running — return frozen value if paused, else compute elapsed
    if (S.timerPaused && tracker.frozenDisplay !== undefined) {
      return tracker.frozenDisplay;
    }
    // Timer already running — compute elapsed seconds from wall clock
    const elapsedSecs = Math.floor((Date.now() - tracker.startWallMs) / 1000);
    const totalSecs   = tracker.startNumeric + elapsedSecs;
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }


  if (!Object.prototype.hasOwnProperty.call(MAX_JUMP, mode)) {
    const cleaned = (rawText || '').trim().replace(/\s+/g, ' ');
    return cleaned || null;
  }

  const parsed = parseRaw(mode, rawText);
  const prev   = filterState[name];

  // Format gate: if parse failed, keep last accepted value (increment stale count)
  if (!parsed) {
    if (prev) prev.staleCount = (prev.staleCount || 0) + 1;
    return prev ? prev.display : null;
  }

  // For timer: allow a catch-up jump of (staleCount + maxJump) so that if OCR
  // was blocked for N cycles, it can jump N+1 seconds to re-sync with real time.
  let maxJump = MAX_JUMP[mode] ?? Infinity;
  if (mode === 'timer' && prev && prev.staleCount > 0) {
    maxJump += prev.staleCount; // allow extra seconds to catch up
  }

  if (prev !== undefined) {
    const jump = parsed.numeric - prev.numeric;
    const absJump = Math.abs(jump);

    // Jump too large → reject, increment stale count
    if (absJump > maxJump) {
      prev.staleCount = (prev.staleCount || 0) + 1;
      return prev.display;
    }

    // Monotonic modes (gold, kills, turret, tyrant, level): never go backwards
    if (MONOTONIC_UP.has(mode) && jump < 0) {
      prev.staleCount = (prev.staleCount || 0) + 1;
      return prev.display;
    }
  }

  // Accept — reset stale count
  filterState[name] = { ...parsed, staleCount: 0 };

  return parsed.display;
}

function resetFilter(name) {
  delete filterState[name];
  delete S.timerTrackers[name];
  resetObjTimer(name);
  resetKdaFilter(name);
}



function preprocessImage(imgData, cfg) {
  // Backward-compat: if cfg is a boolean it was the old 'brightText' flag
  if (typeof cfg === 'boolean') {
    cfg = cfg
      ? { mode: 'bright', threshold: 140, redBoost: 2 }
      : { mode: 'dark',   threshold: 100, redBoost: 2 };
  }
  const { mode, threshold, redBoost } = cfg;
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    let val;
    if (mode === 'red') {
      // Red-boost: amplify red channel, subtract green+blue  →  red text becomes bright
      const v = Math.max(0, Math.min(255, r * redBoost - g - b));
      val = v > threshold ? 0 : 255;   // invert: text → black, background → white
    } else if (mode === 'white') {
      // White isolation: min(R,G,B) — white pixels stay bright, any coloured ring (red, green…) drops to ~0
      // Perfect for white numbers sitting on a red-ring avatar badge
      const v = Math.min(r, g, b);
      val = v > threshold ? 0 : 255;   // invert: white text → black on white
    } else {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (mode === 'bright') {
        val = lum > threshold ? 0 : 255;  // bright text → black on white
      } else {
        val = lum < threshold ? 0 : 255;  // dark text → keep dark
      }
    }
    d[i] = d[i+1] = d[i+2] = val;
    d[i+3] = 255;
  }
}

/* ════════════════════════════════════════════════════════════════════
   Engine Loop
════════════════════════════════════════════════════════════════════ */
$('btn-run-engine').addEventListener('click', () => {
  if (S.engineRunning) { stopEngine(); return; }
  startEngine();
});

/* ── Timer Pause / Play ─────────────────────────────────────────── */
$('btn-timer-pause').addEventListener('click', () => {
  const pbtn = $('btn-timer-pause');

  if (!S.timerPaused) {
    // ── PAUSE ──────────────────────────────────────────────────────
    S.timerPaused     = true;
    S.timerPauseStart = Date.now();

    // Freeze current display value for every active timer tracker
    for (const name in S.timerTrackers) {
      const t = S.timerTrackers[name];
      const elapsedSecs = Math.floor((Date.now() - t.startWallMs) / 1000);
      const totalSecs   = t.startNumeric + elapsedSecs;
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      t.frozenDisplay = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }

    pbtn.textContent = '▶ Timer';
    pbtn.classList.replace('btn-outline', 'btn-primary');
    toast('⏸ Timer paused');

  } else {
    // ── RESUME ─────────────────────────────────────────────────────
    const pauseDuration = Date.now() - S.timerPauseStart;

    // Shift each tracker's start point forward so elapsed time skips the pause
    for (const name in S.timerTrackers) {
      const t = S.timerTrackers[name];
      t.startWallMs += pauseDuration;
      delete t.frozenDisplay;
    }

    S.timerPaused     = false;
    S.timerPauseStart = null;

    pbtn.textContent = '⏸ Timer';
    pbtn.classList.replace('btn-primary', 'btn-outline');
    toast('▶ Timer resumed');
  }
});

function startEngine() {
  if (!S.captureRunning) { toast('⚠ Start capture first'); return; }

  if (!S.ocrReady) { toast('⏳ OCR engine not ready yet…'); return; }

  S.engineRunning = true;
  $('btn-run-engine').textContent = '⏹ Stop Engine';
  $('btn-run-engine').classList.replace('btn-yellow', 'btn-danger');

  // Enable the pause timer button
  const pbtn = $('btn-timer-pause');
  pbtn.disabled     = false;
  pbtn.textContent  = '⏸ Timer';
  pbtn.classList.remove('btn-primary');
  pbtn.classList.add('btn-outline');

  // Start server if not already
  window.api.startServer(S.profileName);

  // Init liveData
  S.layers.forEach(l => {
    if (!(l.name in S.liveData)) S.liveData[l.name] = 'Waiting for reading...';
  });

  engineTick();
}

function stopEngine() {
  S.engineRunning = false;
  clearTimeout(S.engineInterval);
  S.layers.forEach(l => resetFilter(l.name));

  // Reset timer trackers so next match starts fresh
  S.timerTrackers = {};

  // Reset timer pause state
  S.timerPaused     = false;
  S.timerPauseStart = null;
  const pbtn = $('btn-timer-pause');
  pbtn.textContent = '⏸ Timer';
  pbtn.classList.remove('btn-primary');
  pbtn.classList.add('btn-outline');
  pbtn.disabled = true;

  // Reset kill-gate so next match starts clean
  S.killGate.leftKill   = null;
  S.killGate.rightKill  = null;
  S.killGate.kdaTrigger = false;

  $('btn-run-engine').textContent = '⚙ Run Engine';
  $('btn-run-engine').classList.replace('btn-danger', 'btn-yellow');
  toast('Engine stopped');
}

/* ────────────────────────────────────────────────────────────────────
   Kill-gate helpers
   ─────────────────────────────────────────────────────────────────── */

/**
 * Check LEFT_KILL and RIGHT_KILL layers.
 * If either numeric value has increased since the last tick, set
 * S.killGate.kdaTrigger = true so all KDA layers get scanned this tick.
 *
 * @param {Object} killResults  — map of { layerName: rawOcrText }
 *                                for the two kill layers only.
 */
function updateKillGate(filteredResults) {
  const kg = S.killGate;
  let triggered = false;

  for (const [name, prevKey] of [
    ['LEFT_KILL',  'leftKill'],
    ['RIGHT_KILL', 'rightKill'],
  ]) {
    // filteredResults holds the SmartFilter-accepted display string e.g. "3"
    // applyFilter(mode='kills') already validated + monotonic-checked it,
    // so we just parse the clean string directly — no re-OCR, no re-correction.
    const val = filteredResults[name];
    if (val == null) continue;

    const numeric = parseInt(val, 10);
    if (isNaN(numeric)) continue;

    const prev = kg[prevKey];
    if (prev === null || numeric > prev) {
      console.log(
        `[KillGate] ${name} ${prev ?? '?'} → ${numeric} | triggering KDA burst`
      );
      kg[prevKey] = numeric;
      triggered   = true;
    }
  }

  if (triggered) kg.kdaTrigger = true;
}

async function engineTick() {
  if (!S.engineRunning) return;

  const t0      = Date.now();
  const results = {};
  const kg      = S.killGate;

  // ── Partition layers ────────────────────────────────────────────
  // kdaLayers    → mode==='kda'  : only scan when kill-gate fires
  // killLayers   → mode==='kills', name===LEFT_KILL|RIGHT_KILL
  //                always scan — these ARE the gate triggers
  // activeLayers → everything else (gold, timer, numbers, obj_timer…)
  const kdaLayers    = S.layers.filter(l => l.mode === 'kda');
  const killLayers   = S.layers.filter(l => l.name === 'LEFT_KILL' || l.name === 'RIGHT_KILL');
  const activeLayers = S.layers.filter(l => l.mode !== 'kda' && l.name !== 'LEFT_KILL' && l.name !== 'RIGHT_KILL');

  // ── Step 1: Always scan kill counters + all non-KDA layers ─────
  const alwaysScanLayers = [...killLayers, ...activeLayers];
  const alwaysResults    = await Promise.all(
    alwaysScanLayers.map(layer => ocrLayer(layer).catch(() => null))
  );

  alwaysScanLayers.forEach((layer, i) => {
    const rawText = alwaysResults[i];

    // obj_timer must be called every tick for its state machine
    if (layer.mode === 'obj_timer') {
      const filtered = applyFilter(layer, rawText ?? null);
      results[layer.name] = filtered ?? 'ALIVE';
      return;
    }

    if (rawText !== null && rawText !== undefined) {
      const filtered = applyFilter(layer, rawText);
      if (filtered !== null && filtered !== undefined) {
        results[layer.name] = filtered;
      }
    }
  });

  // ── Step 2: Check if a kill just happened ──────────────────────
  // Pass the already-filtered results map — SmartFilter already ran
  // applyFilter(mode='kills') above, so we read the accepted string
  // value ("3", "5" etc.) instead of re-parsing raw OCR noise.
  updateKillGate(results);

  // ── Step 3: Scan KDA layers ONLY when kill-gate is triggered ───
  let kdaScanned = 0;
  if (kg.kdaTrigger && kdaLayers.length > 0) {
    console.log(`[KillGate] Burst-scanning ${kdaLayers.length} KDA layers`);

    const kdaResults = await Promise.all(
      kdaLayers.map(layer => ocrLayer(layer).catch(() => null))
    );

    kdaLayers.forEach((layer, i) => {
      const rawText = kdaResults[i];
      if (rawText !== null && rawText !== undefined) {
        const filtered = applyFilter(layer, rawText);
        if (filtered !== null && filtered !== undefined) {
          results[layer.name] = filtered;
        }
      }
    });

    kdaScanned     = kdaLayers.length;
    kg.kdaTrigger  = false;   // reset gate until next kill
  }

  // ── Commit & stats ──────────────────────────────────────────────
  Object.assign(S.liveData, results);
  await window.api.updateData([S.liveData]);

  S.latency      = Date.now() - t0;
  // areasScanned reflects what was actually OCR'd this tick
  S.areasScanned = alwaysScanLayers.length + kdaScanned;

  $('stat-latency').textContent = S.latency + ' ms';
  $('stat-areas').textContent   = S.areasScanned;

  updateJsonDisplay();
  renderLayerBoxes();
  kdaMonitorRender();

  const delay = Math.max(50, 10 - S.latency);
  S.engineInterval = setTimeout(engineTick, delay);
}

/* ════════════════════════════════════════════════════════════════════
   JSON Display
════════════════════════════════════════════════════════════════════ */
function updateJsonDisplay() {
  const el = $('json-display');
  if (Object.keys(S.liveData).length === 0) {
    el.innerHTML = `<span class="json-brace">{}</span>`;
    return;
  }

  let html = '<span class="json-brace">{</span>\n';
  const entries = Object.entries(S.liveData);
  entries.forEach(([k, v], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    let valHtml;
    if (typeof v === 'number') {
      valHtml = `<span class="json-num">${v}</span>`;
    } else if (v === null) {
      valHtml = `<span class="json-null">null</span>`;
    } else {
      valHtml = `<span class="json-str">"${escapeHtml(String(v))}"</span>`;
    }
    html += `  <span class="json-key">"${escapeHtml(k)}"</span>: ${valHtml}${comma}\n`;
  });
  html += '<span class="json-brace">}</span>';
  el.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ════════════════════════════════════════════════════════════════════
   Output Folder
════════════════════════════════════════════════════════════════════ */
$('btn-select-folder').addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    S.outputFolder = folder;
    $('folder-display').textContent = folder;
    toast('Output folder set');
  }
});

/* ════════════════════════════════════════════════════════════════════
   Profile Export / Import
════════════════════════════════════════════════════════════════════ */
$('btn-export').addEventListener('click', async () => {
  const profile = {
    name:         S.profileName,
    version:      '1.0',
    layers:       S.layers,
    leftTeam:     S.leftTeam,
    rightTeam:    S.rightTeam,
    leftTeamKey:  S.leftTeamKey,
    rightTeamKey: S.rightTeamKey,
    created:      new Date().toISOString(),
  };
  const path = await window.api.saveProfile(profile);
  if (path) toast(`✅ Profile saved: ${path.split('/').pop() || path.split('\\').pop()}`);
});

$('btn-import').addEventListener('click', async () => {
  const profile = await window.api.loadProfile();
  if (!profile) return;

  S.profileName  = profile.name || 'HOK';
  S.layers       = profile.layers || [];
  S.leftTeam     = profile.leftTeam     || '';
  S.rightTeam    = profile.rightTeam    || '';
  S.leftTeamKey  = (profile.leftTeamKey  || 'LEFT_TEAM').toUpperCase();
  S.rightTeamKey = (profile.rightTeamKey || 'RIGHT_TEAM').toUpperCase();
  S.liveData     = { [S.leftTeamKey]: S.leftTeam, [S.rightTeamKey]: S.rightTeam };
  S.layers.forEach(l => { S.liveData[l.name] = 'Waiting for reading...'; });

  $('profile-name').value    = S.profileName;
  $('left-team').value       = S.leftTeam;
  $('right-team').value      = S.rightTeam;
  $('left-team-key').value   = S.leftTeamKey;
  $('right-team-key').value  = S.rightTeamKey;

  // Rebuild counters
  S.counters = {};
  S.layers.forEach(l => {
    const m = l.name.match(/^(.+?)(\d+)$/);
    if (m) {
      const prefix = m[1], num = parseInt(m[2]);
      S.counters[prefix] = Math.max(S.counters[prefix] || 0, num);
    }
  });
  S.nextId = S.layers.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1;

  updateJsonDisplay();
  renderLayerList();
  renderLayerBoxes();
  window.api.startServer(S.profileName);
  toast(`✅ Profile "${S.profileName}" loaded (${S.layers.length} layers)`);
});

/* ════════════════════════════════════════════════════════════════════
   OCR Language Change  (Tesseract.js: worker is re-initialised on next
   OCR call if the language differs from the currently loaded model)
════════════════════════════════════════════════════════════════════ */
$('ocr-lang').addEventListener('change', (e) => {
  S.tessLang = e.target.value;
  toast(`OCR language set to: ${S.tessLang}`);
});

/* ════════════════════════════════════════════════════════════════════
   Window Resize – reposition overlay
════════════════════════════════════════════════════════════════════ */
window.addEventListener('resize', () => {
  if (S.captureRunning) positionOverlay();
});



/* ════════════════════════════════════════════════════════════════════
   OCR Debug Panel
════════════════════════════════════════════════════════════════════ */
function debugPopulateLayerSel() {
  const sel = $('debug-layer-sel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- select a layer --</option>';
  S.layers.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    // Restore previous selection if still valid
    if (String(l.id) === cur) o.selected = true;
    // Reflect any saved per-layer config in the controls
    sel.appendChild(o);
  });
  const has = !!sel.value;
  $('debug-snap').disabled  = !has;
  $('debug-apply').disabled = !has;
  // Reflect saved settings for selected layer
  if (has) debugLoadLayerSettings(parseInt(sel.value));
}

function debugLoadLayerSettings(layerId) {
  const layer = S.layers.find(l => l.id === layerId);
  if (!layer) return;
  if (layer.ppMode) {
    $('debug-mode').value   = layer.ppMode;
    $('debug-thresh').value = layer.ppThresh ?? 128;
    $('debug-boost').value  = layer.ppBoost  ?? 2.0;
  } else {
    // Default from brightText flag
    $('debug-mode').value   = layer.brightText ? 'bright' : 'dark';
    $('debug-thresh').value = layer.brightText ? 140 : 100;
    $('debug-boost').value  = 2.0;
  }
  $('debug-thresh-val').textContent = $('debug-thresh').value;
  $('debug-boost-val').textContent  = parseFloat($('debug-boost').value).toFixed(1);
  $('debug-boost-row').style.display = $('debug-mode').value === 'red' ? '' : 'none';
}

function debugSnap() {
  const layerId = parseInt($('debug-layer-sel').value);
  const layer   = S.layers.find(l => l.id === layerId);
  if (!layer) return;
  if (!S.captureRunning) { toast('⚠ Start capture first'); return; }

  const mode   = $('debug-mode').value;
  const thresh = parseInt($('debug-thresh').value);
  const boost  = parseFloat($('debug-boost').value);

  const oc = $('debug-canvas-orig');
  const bc = $('debug-canvas-bin');
  oc.width  = layer.w; oc.height = layer.h;
  bc.width  = layer.w; bc.height = layer.h;

  const octx = oc.getContext('2d');
  // Draw raw crop from the live video
  octx.drawImage(video, layer.x, layer.y, layer.w, layer.h, 0, 0, layer.w, layer.h);

  // Clone pixel data and run preprocessImage on the copy
  const src = octx.getImageData(0, 0, layer.w, layer.h);
  const bin = new ImageData(new Uint8ClampedArray(src.data), layer.w, layer.h);
  preprocessImage(bin, { mode, threshold: thresh, redBoost: boost });
  bc.getContext('2d').putImageData(bin, 0, 0);

  $('debug-no-layer').style.display = 'none';
}

$('debug-layer-sel').addEventListener('change', () => {
  const layerId = parseInt($('debug-layer-sel').value);
  const has = !!$('debug-layer-sel').value;
  $('debug-snap').disabled  = !has;
  $('debug-apply').disabled = !has;
  if (has) debugLoadLayerSettings(layerId);
});

['debug-mode', 'debug-thresh', 'debug-boost'].forEach(id => {
  $(id).addEventListener('input', () => {
    $('debug-thresh-val').textContent = $('debug-thresh').value;
    $('debug-boost-val').textContent  = parseFloat($('debug-boost').value).toFixed(1);
    $('debug-boost-row').style.display = $('debug-mode').value === 'red' ? '' : 'none';
    // Live preview: re-snap automatically while capture is running
    if ($('debug-layer-sel').value && S.captureRunning) debugSnap();
  });
});

$('debug-snap').addEventListener('click', debugSnap);

$('debug-apply').addEventListener('click', () => {
  const layerId = parseInt($('debug-layer-sel').value);
  const layer   = S.layers.find(l => l.id === layerId);
  if (!layer) return;
  layer.ppMode   = $('debug-mode').value;
  layer.ppThresh = parseInt($('debug-thresh').value);
  layer.ppBoost  = parseFloat($('debug-boost').value);
  toast(`✅ Preprocessing saved to "${layer.name}"`);
});

// KDA monitor layer selector — re-render immediately on change
$('kda-layer-sel').addEventListener('change', () => kdaMonitorRender());

/* ════════════════════════════════════════════════════════════════════
   Init
════════════════════════════════════════════════════════════════════ */
async function init() {
  // Start server and get IP
  await window.api.startServer(S.profileName);

  const ip = await window.api.getIP();
  const port = await window.api.getPort();
  S.localIP = ip;
  S.port    = port;
  S.serverUrl = `http://${ip}:${port}/${S.profileName}.json`;
  $('ip-text').textContent = `IP4: ${ip}:${port}`;
  $('endpoint-url-display').textContent = S.serverUrl;

  // Seed team keys into liveData
  S.liveData[S.leftTeamKey]  = S.leftTeam;
  S.liveData[S.rightTeamKey] = S.rightTeam;

  // Pre-load sources in background
  loadSources().catch(() => {});

  // Set initial tab
  setTab('settings');
  updateJsonDisplay();
}

init();