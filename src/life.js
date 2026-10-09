// The "alive" touches of the office: personalities, small talk, confetti, coffee counter, visitors'
// reports, day and night, the office cat and seasonal decor.
// Loaded after renderer.js and shares its globals (agents, DESKS, ROOMS, r, hash, ...).

// ---------- personalities ----------
// A trait is picked from the session id, so the same terminal always has the same personality.
// `slots` are the break-area spots it likes (indexes into BREAK_SLOTS); `idleDelay` is how long it
// waits at its desk before taking a break.
const TRAITS = [
  { id: 'coffee', label: 'Coffee addict', icon: '☕', slots: [3], idleDelay: 1500,
    lines: ['need more coffee...', "is it coffee o'clock?", 'one more cup!', 'coffee fixes bugs'] },
  { id: 'pool', label: 'Pool shark', icon: '🎱', slots: [5, 6, 7, 8], idleDelay: 2000,
    lines: ['rack em up!', 'I never miss', 'bank shot incoming', 'loser buys coffee'] },
  { id: 'owl', label: 'Night owl', icon: '🦉', slots: [0, 1, 2], idleDelay: 2500,
    lines: ['I work best at night', 'five more minutes...', 'is it morning already?', 'nap time'] },
  { id: 'chatty', label: 'Chatty', icon: '💬', slots: [9, 10], idleDelay: 2000,
    lines: ['did I tell you about my commit?', 'so anyway...', 'you will not believe this', 'long story short...'] },
  { id: 'water', label: 'Stays hydrated', icon: '💧', slots: [4], idleDelay: 2500,
    lines: ['drink some water!', 'hydrate or diedrate', 'water is underrated', 'eight glasses a day'] },
  { id: 'focus', label: 'Workaholic', icon: '💼', slots: [], idleDelay: 12000,
    lines: ['just one more task', 'breaks are for later', 'back to work soon', 'the backlog never ends'] },
];

function traitFor(id) {
  return TRAITS[hash(id + ':trait') % TRAITS.length];
}

const SMALL_TALK = [
  'tabs or spaces?', 'did you see that diff?', 'who broke the build?', 'works on my machine',
  'I love a green test run', 'any plans for the weekend?', 'rubber duck debugging works', 'merge conflicts again...',
  'have you tried turning it off?', 'is it a bug or a feature?',
];

// One line per speaking turn; mixes generic talk, the agent's personality and its real numbers.
function chatLine(a, turn) {
  const pool = [...SMALL_TALK, ...(a.trait ? a.trait.lines : []), ...(a.trait ? a.trait.lines : [])];
  if (a.tokens) pool.push('I used ' + fmtTok(freshTokens(a)) + ' tokens so far');
  if (a.ctx && a.ctxMax) pool.push('my context is ' + Math.round((100 * a.ctx) / a.ctxMax) + '% full');
  if (a.cost) pool.push('my bill is ' + fmtCost(a.cost) + ' already');
  return pool[(hash(a.id) + turn * 7) % pool.length];
}

// Two agents standing close together in the break area take turns talking.
function updateChats(now) {
  const list = [...agents.values()].filter((a) =>
    !a.leaving && (a.dest === 'break') && !a.walking && !a.path.length && a.slot >= 0 && !BREAK_SLOTS[a.slot].pool);
  for (const a of list) a.chat = null;
  const turn = Math.floor(now / 3600);
  for (const a of list) {
    let buddy = null;
    let best = 34;
    for (const b of list) {
      if (b === a) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < best) { best = d; buddy = b; }
    }
    if (!buddy) continue;
    const speaks = (turn % 2 === 0) === (a.id < buddy.id);
    a.chat = { buddy, speaking: speaks, text: speaks ? chatLine(a, turn) : '' };
  }
  // when three agents stand together, never let two neighbours talk at once
  for (const a of list) {
    if (a.chat && a.chat.speaking && a.chat.buddy.chat && a.chat.buddy.chat.speaking && a.id > a.chat.buddy.id) a.chat.speaking = false;
  }
}

// ---------- coffee counter ----------
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function getCups() {
  try {
    const v = JSON.parse(localStorage.getItem('office.cups') || 'null');
    return v && v.day === todayKey() ? v.n : 0;
  } catch { return 0; }
}

function addCup() {
  try { localStorage.setItem('office.cups', JSON.stringify({ day: todayKey(), n: getCups() + 1 })); } catch { /* storage unavailable */ }
}

// ---------- celebrations: confetti and cheers ----------
const particles = [];
const CONFETTI = ['#f2c94c', '#d93a3a', '#4a90d9', '#5fd96a', '#e07fb0', '#ffffff', '#e8832a'];
const CHEERS = ['done!', 'all done!', 'nailed it!', 'ship it!', 'that was a big one!'];

function celebrate(a, now) {
  for (let i = 0; i < 48; i++) {
    particles.push({
      x: a.x, y: a.y - 16, vx: (Math.random() - 0.5) * 70, vy: -35 - Math.random() * 55,
      color: CONFETTI[i % CONFETTI.length], life: 1.5 + Math.random() * 0.9,
    });
  }
  a.cheerUntil = now + 2600;
  a.say = { text: CHEERS[hash(a.id + now) % CHEERS.length], until: now + 3500 };
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 130 * dt;
    p.vx *= 0.99;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function lifeDrawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    r(p.x, p.y, 2, 1, p.color);
  }
  ctx.globalAlpha = 1;
}

// A visiting subagent hands its report to the main agent: a paper flies to the desk and stays there a while.
function lifeDrawPaper(now) {
  for (const a of agents.values()) {
    if (a.reportAt && now - a.reportAt < 1100) {
      const boss = agents.get(a.visitBoss);
      if (!boss) continue;
      const d = DESKS[boss.desk];
      const p = (now - a.reportAt) / 1100;
      const x = a.x + (d.x + 19 - a.x) * p;
      const y = a.y - 8 + (d.y + 1 - (a.y - 8)) * p - Math.sin(p * Math.PI) * 7;
      r(x, y, 4, 3, '#ffffff');
      r(x + 1, y + 1, 2, 1, '#8a8fa0');
    }
    if (a.paperUntil && now < a.paperUntil && !a.leaving) {
      const d = DESKS[a.desk];
      r(d.x + 17, d.y, 5, 3, '#ffffff');
      r(d.x + 18, d.y + 1, 3, 1, '#8a8fa0');
    }
  }
}

// ---------- day and night ----------
var hourOverride = null; // tests can force an hour of the day
var seasonOverride = null; // tests can force a month (1-12)

function lifeHour() {
  if (hourOverride !== null) return hourOverride;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

function lifeMonth() {
  return seasonOverride !== null ? seasonOverride : new Date().getMonth() + 1;
}

// hour, sky top, sky bottom, cloud, darkness of the room lights
const SKY_KEYS = [
  [0, '#0c1030', '#1a2050', '#3a4070', 0.34],
  [5, '#0c1030', '#1a2050', '#3a4070', 0.34],
  [6.5, '#d9705c', '#f2b27a', '#ffd9b0', 0.14],
  [8, '#7ec8f0', '#a9dcf5', '#ffffff', 0],
  [17, '#7ec8f0', '#a9dcf5', '#ffffff', 0],
  [18.5, '#e8845c', '#f2b27a', '#ffd9b0', 0.1],
  [20, '#3a3a7a', '#7a5a8a', '#8a7aa0', 0.24],
  [21.5, '#0c1030', '#1a2050', '#3a4070', 0.34],
  [24, '#0c1030', '#1a2050', '#3a4070', 0.34],
];

function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function lifeSky() {
  const h = lifeHour();
  let i = 0;
  while (i < SKY_KEYS.length - 2 && h >= SKY_KEYS[i + 1][0]) i++;
  const [h0, t0, b0, c0, s0] = SKY_KEYS[i];
  const [h1, t1, b1, c1, s1] = SKY_KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  return { top: mixHex(t0, t1, t), bottom: mixHex(b0, b1, t), cloud: mixHex(c0, c1, t), shade: s0 + (s1 - s0) * t };
}

// stars, moon and snow inside one window (x = left edge of the window)
function lifeWindowExtras(wx, sky, t) {
  if (sky.shade >= 0.2) {
    for (let k = 0; k < 6; k++) {
      const on = (Math.floor(t / 700) + k * 3 + wx) % 7 !== 0;
      if (on) r(wx + 4 + ((k * 13 + wx) % 36), 12 + ((k * 7 + wx) % 14), 1, 1, '#f4f1d0');
    }
    r(wx + 31, 13, 5, 5, '#f4f1d0');
    r(wx + 33, 12, 4, 4, sky.top); // crescent
  }
  if (lifeMonth() === 12) {
    for (let k = 0; k < 9; k++) {
      const x = wx + 3 + ((k * 5 + Math.floor(t / (420 + k * 50))) % 38);
      const y = 10 + ((t / (70 + k * 12) + k * 9) % 21);
      r(x, y, 1, 1, '#ffffff');
    }
  }
}

// darkness over the whole office in the evening and at night
function lifeShade() {
  const a = lifeSky().shade;
  if (a > 0.01) r(0, 0, LW, WORLD_H, 'rgba(10,12,44,' + a.toFixed(3) + ')');
}

// working monitors keep glowing in the dark
function lifeGlow(awakeDesk, t) {
  if (lifeSky().shade < 0.05) return;
  for (const i of awakeDesk) {
    const d = DESKS[i];
    if (!d || d.x === undefined || i >= ROOM_COUNT * DESKS_PER_ROOM) continue;
    r(d.x + 31, d.y - 11, 13, 8, '#2b5a96');
    for (let k = 0; k < 4; k++) {
      const w = 3 + ((hash(String(k + Math.floor(t / 350))) >> 4) % 7);
      r(d.x + 32, d.y - 10 + k * 2, w, 1, k % 2 ? '#a9e3ff' : '#8dffa0');
    }
    r(d.x + 28, d.y - 1, 17, 1, 'rgba(140,190,255,0.35)');
  }
}

// ---------- seasonal decor ----------
function drawPumpkin(x, y, glow) {
  r(x, y + 2, 9, 6, '#e8832a');
  r(x + 1, y + 1, 7, 1, '#f09a3e');
  r(x + 1, y + 8, 7, 1, '#b8601a');
  r(x + 4, y - 1, 2, 3, '#3f7a3a');
  const face = glow ? '#ffe07a' : '#2b1a0a';
  r(x + 2, y + 4, 2, 2, face);
  r(x + 6, y + 4, 2, 2, face);
  r(x + 3, y + 7, 4, 1, face);
}

function drawTree(cx, base, t) {
  r(cx - 16, base - 5, 7, 5, '#d93a3a'); r(cx - 13, base - 5, 1, 5, '#f2c94c');
  r(cx + 10, base - 6, 8, 6, '#4a90d9'); r(cx + 13, base - 6, 1, 6, '#f2c94c');
  r(cx - 2, base - 6, 4, 6, '#6b4a32');
  r(cx - 11, base - 16, 22, 10, '#2f8f4a');
  r(cx - 8, base - 26, 16, 10, '#38a556');
  r(cx - 5, base - 34, 10, 9, '#43b862');
  r(cx - 1, base - 38, 3, 3, '#ffd34d');
  const lights = [[-8, -12], [6, -9], [-3, -20], [4, -23], [-1, -30], [9, -13], [-10, -8], [1, -15]];
  lights.forEach(([dx, dy], k) => r(cx + dx, base + dy, 2, 2, ['#ff5a5a', '#ffe07a', '#6ab8ff'][(Math.floor(t / 450) + k) % 3]));
}

function lifeDrawSeason(t) {
  const m = lifeMonth();
  const glow = lifeSky().shade > 0.15;
  if (m === 10) {
    for (const [x, y] of [[336, 254], [402, 258], [418, 252]]) drawPumpkin(x, y, glow);
    ROOMS.forEach((rm, i) => {
      drawPumpkin(4, DESKS[i * DESKS_PER_ROOM].y + 14, glow);
      for (let k = 0; k < 9; k++) r(4 + k, rm.y + 4 + (k >> 1), 1, 1, 'rgba(235,235,235,0.75)'); // cobweb
      for (let k = 0; k < 9; k++) r(4 + (k >> 1), rm.y + 4 + k, 1, 1, 'rgba(235,235,235,0.75)');
      r(4, rm.y + 4, 9, 1, 'rgba(235,235,235,0.75)');
      r(4, rm.y + 4, 1, 9, 'rgba(235,235,235,0.75)');
    });
  } else if (m === 12) {
    drawTree(380, 266, t);
  } else if (m >= 3 && m <= 5) {
    for (const [px, py] of [[326, 248], [468, 250]]) {
      r(px + 1, py + 1, 2, 2, '#ff7ab8'); r(px + 6, py + 3, 2, 2, '#ffe07a');
      r(px + 3, py - 3, 2, 2, '#ffffff'); r(px + 7, py - 1, 2, 2, '#ff7ab8');
    }
  }
}

// ---------- the office cat ----------
const pet = { name: 'Mochi', x: DOOR_X, y: 100, dir: 1, mode: 'sit', path: [], next: null, until: 0, walking: false, say: null, hit: null };
const PET_SPOTS = [[470, 238], [430, 262], [340, 262]]; // clear of the gym, library and meeting table
const COUCH_SPOT = [416, 93];

function petZone() {
  if (pet.x < ROOM_W - 2) {
    const i = ROOMS.findIndex((rm) => pet.y >= rm.y && pet.y < rm.y + rm.h);
    return { room: i >= 0 ? i : 0 };
  }
  return pet.x >= 318 ? { hall: false, breakArea: true } : { hall: true };
}

function petRoute(tx, ty, targetRoom) {
  const z = petZone();
  const pts = [];
  if (z.room !== undefined && ROOMS[z.room]) {
    const ra = ROOMS[z.room].aisleY;
    pts.push([pet.x, ra], [DOOR_X, ra]);
  } else if (z.breakArea) {
    pts.push([pet.x, AISLE_Y], [DOOR_X, AISLE_Y]);
  }
  if (targetRoom >= 0) {
    const ta = ROOMS[targetRoom].aisleY;
    pts.push([DOOR_X, ta], [tx, ta], [tx, ty]);
  } else {
    pts.push([DOOR_X, AISLE_Y], [tx, AISLE_Y], [tx, ty]);
  }
  pet.path = pts;
}

function petPlan() {
  const roll = Math.random();
  if (roll < 0.4) {
    petRoute(COUCH_SPOT[0], COUCH_SPOT[1], -1);
    pet.next = { mode: 'sleep', dur: 30000 + Math.random() * 40000 };
  } else if (roll < 0.8 && ROOMS.length) {
    const i = Math.floor(Math.random() * ROOMS.length);
    const d = DESKS[i * DESKS_PER_ROOM + Math.floor(Math.random() * DESKS_PER_ROOM)];
    petRoute(d.x + 24, ROOMS[i].aisleY, i);
    pet.next = { mode: 'sit', dur: 6000 + Math.random() * 8000 };
  } else {
    const sp = PET_SPOTS[Math.floor(Math.random() * PET_SPOTS.length)];
    petRoute(sp[0], sp[1], -1);
    pet.next = { mode: 'sit', dur: 6000 + Math.random() * 8000 };
  }
}

function updatePet(dt, now) {
  if (ROOMS.length && pet.x < ROOM_W - 2 && !ROOMS.some((rm) => pet.y >= rm.y && pet.y < rm.y + rm.h)) { pet.x = DOOR_X; pet.y = AISLE_Y; pet.path = []; } // its room vanished
  pet.walking = false;
  if (pet.path.length) {
    const [tx, ty] = pet.path[0];
    const dx = tx - pet.x;
    const dy = ty - pet.y;
    const dist = Math.hypot(dx, dy);
    const step = 30 * dt;
    if (dist <= step) { pet.x = tx; pet.y = ty; pet.path.shift(); }
    else { pet.x += (dx / dist) * step; pet.y += (dy / dist) * step; }
    if (Math.abs(dx) > 0.5) pet.dir = dx > 0 ? 1 : -1;
    pet.walking = true;
    if (!pet.path.length && pet.next) {
      pet.mode = pet.next.mode;
      pet.until = now + pet.next.dur;
      pet.next = null;
    }
    return;
  }
  if (now > pet.until && !pet.next) petPlan();
}

function lifeDrawPet(t) {
  const x = Math.round(pet.x);
  const y = Math.round(pet.y);
  const fur = '#d98a3a';
  const dark = '#a8601c';
  const d = pet.dir;
  const tail = Math.floor(t / 260) % 2;
  if (pet.walking) {
    const f = Math.floor(t / 130) % 2;
    r(x - 4, y - 1, 9, 1, 'rgba(0,0,0,0.2)');
    r(x - 3, y - 5, 7, 3, fur);
    r(x - 3, y - 5, 7, 1, dark);
    r(x - 3 + (f ? 0 : 1), y - 2, 1, 2, dark);
    r(x + 3 - (f ? 0 : 1), y - 2, 1, 2, dark);
    r(x + (d > 0 ? 3 : -5), y - 7, 3, 3, fur);
    r(x + (d > 0 ? 3 : -5), y - 8, 1, 1, dark);
    r(x + (d > 0 ? 5 : -3), y - 8, 1, 1, dark);
    r(x + (d > 0 ? 6 : -6), y - 6, 1, 1, '#1c1c24');
    r(x + (d > 0 ? -5 : 4), y - 7 - tail, 1, 4, dark);
  } else if (pet.mode === 'sleep') {
    r(x - 5, y - 1, 10, 1, 'rgba(0,0,0,0.2)');
    r(x - 4, y - 4, 9, 4, fur);
    r(x - 4, y - 4, 9, 1, dark);
    r(x + 2, y - 5, 4, 3, fur);
    r(x + 2, y - 6, 1, 1, dark);
    r(x + 5, y - 6, 1, 1, dark);
    r(x - 5, y - 3, 2, 1, dark);
  } else {
    r(x - 3, y - 1, 7, 1, 'rgba(0,0,0,0.2)');
    r(x - 2, y - 6, 5, 6, fur);
    r(x - 2, y - 6, 5, 1, dark);
    r(x - 1, y - 3, 3, 3, '#f4e4c8');
    r(x - 2, y - 9, 5, 4, fur);
    r(x - 2, y - 10, 1, 1, dark);
    r(x + 2, y - 10, 1, 1, dark);
    r(x - 1, y - 8, 1, 1, '#1c1c24');
    r(x + 1, y - 8, 1, 1, '#1c1c24');
    r(x + 3, y - 2 - tail, 1, 3, dark);
  }
}

// ---------- per-frame update + overlay ----------
function lifeUpdate(dt, now) {
  updateChats(now);
  updateParticles(dt);
  updatePet(dt, now);
}

// text drawn in screen space: coffee cup counter, sleeping cat, cat speech
function lifeOverlay(now, t, sx, sy, font, smallFont) {
  const cups = getCups();
  ctx.font = smallFont;
  const label = '☕ ' + cups + ' today';
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = 'rgba(43,34,49,0.9)';
  ctx.fillRect(Math.round(sx(438) - w / 2), sy(60), w, 13);
  ctx.fillStyle = '#e6c35a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(label, Math.round(sx(438)), sy(60) + 7);

  pet.hit = { x: sx(pet.x) - 7 * S, y: sy(pet.y - 11), w: 14 * S, h: 12 * S };
  if (pet.mode === 'sleep' && !pet.walking) {
    ctx.font = font;
    ctx.fillStyle = '#e8e0f5';
    const k = Math.floor(t / 900) % 3;
    for (let i = 0; i <= k; i++) ctx.fillText(i === 0 ? 'z' : 'Z', sx(pet.x) + (6 + i * 4) * S / 2, sy(pet.y - 8) - i * 8);
  }
  if (pet.say && now < pet.say.until) balloon(pet.say.text, sx(pet.x), sy(pet.y - 11), '#fff6e0', '#5a3a1c', font);
}
