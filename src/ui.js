// DOM side of the app: hover tooltip, click-for-details panel and the alerts toggle.
// Shares globals with renderer.js (agents, ROOMS, canvas, fmtTok, fmtDur, selectedId).
const panel = document.getElementById('panel');
const tip = document.getElementById('tip');
const alertsBtn = document.getElementById('alerts');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(k, v) {
  const r = el('div', 'row');
  r.append(el('span', null, k), el('span', null, v));
  return r;
}

function stateLabel(a) {
  return a.state === 'working' ? 'Working' : a.state === 'waiting' ? 'Waiting for you' : 'Idle';
}

function ctxColor(f) { return f < 0.6 ? '#5fd96a' : f < 0.85 ? '#f2a93b' : '#d93a3a'; }

function ctxBar(a) {
  const max = a.ctxMax || 200000;
  const f = Math.min(1, (a.ctx || 0) / max);
  const wrap = el('div');
  const bar = el('div', 'bar');
  const fill = el('i');
  fill.style.width = Math.round(f * 100) + '%';
  fill.style.background = ctxColor(f);
  bar.append(fill);
  wrap.append(bar, el('div', null, fmtTok(a.ctx || 0) + ' / ' + fmtTok(max) + ' tokens (' + Math.round(f * 100) + '%)'));
  return wrap;
}

// ---------- hover tooltip ----------
function pickAgent(px, py) {
  let best = null;
  for (const a of agents.values()) {
    if (a.leaving || !a.hit) continue;
    if (a.hit.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) && (!best || a.y > best.y)) best = a;
  }
  return best;
}

function overPet(pt) {
  const h = pet.hit;
  return !!h && pt[0] >= h.x && pt[0] <= h.x + h.w && pt[1] >= h.y && pt[1] <= h.y + h.h;
}

function eventPoint(ev) {
  const k = canvas.width / canvas.clientWidth;
  return [ev.offsetX * k, ev.offsetY * k];
}

function showTip(a, ev) {
  if (!a) { tip.style.display = 'none'; return; }
  tip.textContent = '';
  const head = el('div');
  head.append(el('b', null, a.name), el('span', 'dim', '  ' + (a.sub ? '↳ ' : '') + (a.project || '')));
  tip.append(head, el('div', null, stateLabel(a) + (a.activity ? ': ' + a.activity : '')));
  if (a.ctx) tip.append(el('div', 'dim', 'context ' + Math.round(100 * Math.min(1, a.ctx / (a.ctxMax || 200000))) + '%  ·  ' + fmtTok(freshTokens(a)) + ' tokens' + (a.cost ? '  ·  ' + fmtCost(a.cost) : '')));
  if (a.trait) tip.append(el('div', 'dim', a.trait.icon + ' ' + a.trait.label));
  tip.append(el('div', 'dim', 'click for details'));
  tip.style.display = 'block';
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, ev.clientX + 14) + 'px';
  tip.style.top = Math.min(window.innerHeight - h - 8, ev.clientY + 16) + 'px';
}

canvas.addEventListener('mousemove', (ev) => {
  const pt = eventPoint(ev);
  mouseDev.x = pt[0];
  mouseDev.y = pt[1];
  const a = pickAgent(...pt);
  const onPet = !a && overPet(pt);
  canvas.style.cursor = a || onPet ? 'pointer' : 'default';
  if (onPet) {
    tip.textContent = '';
    tip.append(el('b', null, pet.name), el('span', 'dim', '  the office cat'), el('div', 'dim', 'click to pet'));
    tip.style.display = 'block';
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, ev.clientX + 14) + 'px';
    tip.style.top = Math.min(window.innerHeight - tip.offsetHeight - 8, ev.clientY + 16) + 'px';
  } else {
    showTip(a, ev);
  }
});
canvas.addEventListener('mouseleave', () => {
  tip.style.display = 'none';
  mouseDev.x = -1;
  mouseDev.y = -1;
});

// ---------- details panel ----------
const MEOWS = ['meow!', 'purr...', 'mrrp?', 'prrrr'];
canvas.addEventListener('click', (ev) => {
  const pt = eventPoint(ev);
  if (!pickAgent(...pt) && overPet(pt)) {
    pet.say = { text: MEOWS[Math.floor(Math.random() * MEOWS.length)], until: Date.now() + 2200 };
    return;
  }
  const a = pickAgent(...eventPoint(ev));
  selectedId = a ? a.id : null;
  renderPanel();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { selectedId = null; renderPanel(); }
});

function renderPanel() {
  const a = selectedId ? agents.get(selectedId) : null;
  if (!a || a.leaving) {
    if (selectedId && !a) selectedId = null;
    panel.style.display = 'none';
    return;
  }
  const scroll = panel.scrollTop;
  panel.textContent = '';
  const now = Date.now();

  const close = el('div', 'close', '×');
  close.addEventListener('click', () => { selectedId = null; renderPanel(); });
  panel.append(close, el('h1', null, a.name));

  const parent = a.parent ? [...agents.values()].find((x) => x.id === a.parent) : null;
  panel.append(el('div', 'sub', (a.sub ? '↳ subagent "' + a.project + '"' + (parent ? ' of ' + parent.name : '') : a.project) + (a.title ? ' · ' + a.title : '')));

  const chip = el('span', 'chip ' + a.state, stateLabel(a));
  const status = el('div');
  status.append(chip);
  panel.append(status);
  if (a.activity) panel.append(el('div', null, a.activity));

  panel.append(el('h2', null, 'Time'));
  if (a.state !== 'idle' && a.turnStart) panel.append(row(a.state === 'waiting' ? 'Waiting since' : 'Working for', fmtDur(now - (a.state === 'waiting' ? a.updated : a.turnStart))));
  else panel.append(row('Idle for', fmtDur(now - a.updated)));
  if (a.firstTs) panel.append(row('Session started', fmtDur(now - a.firstTs) + ' ago'));
  panel.append(row('Room', 'Room ' + (Math.floor(a.desk / DESKS_PER_ROOM) + 1)));
  if (a.trait) panel.append(row('Personality', a.trait.icon + ' ' + a.trait.label));

  if (a.ctx) {
    panel.append(el('h2', null, 'Context window'), ctxBar(a));
  }
  if (a.tokens) {
    panel.append(el('h2', null, 'Tokens'));
    panel.append(row('Total (new work)', fmtTok(freshTokens(a))));
    panel.append(row('Output', fmtTok(a.tokens.output)));
    panel.append(row('Input + cache writes', fmtTok(a.tokens.input + a.tokens.cacheCreate)));
    panel.append(row('Cache reads', fmtTok(a.tokens.cacheRead)));
    if (a.cost) panel.append(row('Est. cost' + (a.costPartial ? ' (partial)' : ''), fmtCost(a.cost)));
    if (a.model) panel.append(row('Model', a.model));
  }

  if (!a.sub) {
    panel.append(el('h2', null, 'Todo list'));
    if (a.todos && a.todos.length) {
      const ul = el('ul');
      for (const t of a.todos) {
        const cls = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo';
        ul.append(el('li', cls, (cls === 'done' ? '✓ ' : cls === 'doing' ? '▶ ' : '○ ') + t.text));
      }
      panel.append(ul);
    } else {
      panel.append(el('div', 'empty', 'No todo list in this session yet'));
    }

    const subs = [...agents.values()].filter((x) => x.parent === a.id && !x.leaving);
    panel.append(el('h2', null, 'Subagents (' + subs.length + ')'));
    if (subs.length) {
      const ul = el('ul');
      for (const s of subs) ul.append(el('li', 'todo', s.name + ' · ' + s.project + (s.activity ? ' · ' + s.activity : '')));
      panel.append(ul);
    } else {
      panel.append(el('div', 'empty', 'none right now'));
    }
  }

  panel.append(el('h2', null, 'Recent actions'));
  if (a.recent && a.recent.length) {
    const ul = el('ul');
    for (const r of a.recent) {
      const li = el('li', 'todo');
      li.append(el('span', 't', r.ts ? fmtDur(now - r.ts) + ' ago' : ''), document.createTextNode(r.text));
      ul.append(li);
    }
    panel.append(ul);
  } else {
    panel.append(el('div', 'empty', 'nothing yet'));
  }

  panel.style.display = 'block';
  panel.scrollTop = scroll;
}
setInterval(() => { if (selectedId) renderPanel(); }, 1000);

// ---------- alerts toggle ----------
let notifyOn = true;
try { notifyOn = localStorage.getItem('notify') !== 'off'; } catch { /* storage unavailable */ }
function applyNotify() {
  alertsBtn.textContent = notifyOn ? '🔔 Alerts on' : '🔕 Alerts off';
  alertsBtn.className = notifyOn ? '' : 'off';
  window.office.setNotify(notifyOn);
}
alertsBtn.addEventListener('click', () => {
  notifyOn = !notifyOn;
  try { localStorage.setItem('notify', notifyOn ? 'on' : 'off'); } catch { /* ignore */ }
  applyNotify();
});
applyNotify();
