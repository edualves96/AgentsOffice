// Pixel-art office renderer. Everything is drawn procedurally with rectangles
// on a 520x270 logical canvas that is scaled up by an integer factor.
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const LW = 520;
const LH = 270;
const MAX_ROOMS = 8;
const MAX_PARENTS = MAX_ROOMS; // one room per terminal
const DESKS_PER_ROOM = 5; // desk 0 is the main agent's, 1-4 are for its subagents
const AISLE_Y = 128;
const DOOR_X = 299;
const DOOR_Y = 50;
const SPEED = 44; // logical px / second

// ---------- layout ----------
const AREA_Y = 44;
let WORLD_H = LH; // grows when there are more than 4 rooms; the page then scrolls
const ROOM_W = 296;
const DESKS = Array.from({ length: MAX_ROOMS * DESKS_PER_ROOM }, () => ({}));
let ROOMS = [];
let ROOM_COUNT = 0;
let ROW_AISLES = [];

// Rooms are stacked top to bottom. Up to 4 rooms share the height; beyond that each room keeps a
// minimum height and the office grows downward.
function layoutRooms(n) {
  ROOM_COUNT = n;
  const h = n <= 4 ? Math.floor((LH - AREA_Y) / n) : 56;
  WORLD_H = Math.max(LH, AREA_Y + n * h);
  const dy = h >= 100 ? 40 : h >= 70 ? 22 : 16;
  const aisleOff = h >= 100 ? 103 : h >= 70 ? 64 : 52;
  ROOMS = [];
  for (let i = 0; i < n; i++) {
    const y = AREA_Y + i * h;
    ROOMS.push({ y, h, aisleY: y + aisleOff });
    for (let j = 0; j < DESKS_PER_ROOM; j++) {
      const d = DESKS[i * DESKS_PER_ROOM + j];
      d.x = 12 + j * 56;
      d.y = y + dy;
      d.seatX = d.x + 15;
      d.seatY = d.y + 4;
      d.gapX = d.x + 51;
      d.aisleY = y + aisleOff;
      d.room = i;
      d.boss = j === 0;
    }
  }
  ROW_AISLES = ROOMS.map((rm) => rm.aisleY);
}
layoutRooms(2);

const POOL = { x: 344, y: 168, w: 72 };
const POOL_SLOTS = [5, 6, 7, 8];
const COFFEE_SLOT = 3;
const GYM_LANE = 440; // free column west of the gym equipment
const EAST_LANE = 478; // free column west of the library and meeting table
const POOL_BYPASS_X = 334; // walk around the pool table on its left side
const BREAK_SLOTS = [
  { x: 348, y: 93, sit: true, label: 'chilling' }, { x: 376, y: 93, sit: true, label: 'chilling' }, { x: 404, y: 93, sit: true, label: 'chilling' }, // couch
  { x: 436, y: 90, sit: false, cup: true }, // coffee machine
  { x: 464, y: 96, sit: false, cup: true }, // water cooler
  { x: 362, y: 167, sit: false, pool: 1 }, { x: 398, y: 167, sit: false, pool: 1 }, // pool, far side
  { x: 362, y: 214, sit: false, pool: -1, via: POOL_BYPASS_X }, { x: 398, y: 214, sit: false, pool: -1, via: POOL_BYPASS_X }, // pool, near side
  { x: 436, y: 240, sit: false }, { x: 458, y: 248, sit: false }, // chatting spots
  { x: 481, y: 90, sit: false, snack: true, label: 'snack time' }, // vending machine
  { x: 498, y: 90, sit: false, cup: true }, // fridge
  { x: 513, y: 90, sit: false, cup: true }, // microwave
  { x: 458, y: 162, sit: false, run: true, label: 'running' }, // gym: treadmill
  { x: 450, y: 196, sit: false, lift: true, label: 'pumping iron', via: GYM_LANE }, // gym: weights
  { x: 455, y: 228, sit: true, label: 'stretching', via: GYM_LANE }, // gym: yoga mat
];

// Work places in the east wing. Agents walk there from the aisle by the lane x = EAST_LANE.
const LIB = { x: 484, y: 140, w: 34, h: 28 }; // bookshelf
const LIB_SLOTS = [{ x: 490, y: 186, via: EAST_LANE }, { x: 512, y: 186, via: EAST_LANE }];
const MEET = { x: 488, y: 216, w: 26, h: 16 }; // stand-up table
const MEET_SLOTS = [
  { x: 494, y: 219, via: EAST_LANE }, { x: 508, y: 219, via: EAST_LANE }, // behind the table
  { x: 494, y: 254, via: EAST_LANE }, { x: 508, y: 254, via: EAST_LANE }, // in front of it
];
const STANDUP_MS = 5000; // how long the stand-up lasts once the first subagent has arrived
const STANDUP_JOIN_MS = 6000; // subagents spawned this close together hold a stand-up
const LIB_HOLD_MS = 8000; // an agent stays in the library this long after its last read
const STANDUP_LINES = ["I'll take the search", 'on it!', 'any blockers?', 'ready when you are', 'I read the docs', 'let us split the work'];

// ---------- look ----------
const SKINS = ['#f2c9a0', '#e0a97c', '#c68a5b', '#8d5a3b', '#f7d9bd'];
const HAIRS = ['#2b2118', '#5a3a22', '#a8672a', '#d9b44a', '#8a8a92', '#b03a2e'];
const SHIRTS = ['#d95763', '#4a90d9', '#5fbf6a', '#e6a83a', '#9b6ad9', '#3cb8b2', '#e07fb0', '#d9d9e0'];
const PANTS = ['#2f3b52', '#3b3b46', '#4a3a2a', '#2a4a3a'];

const NAMES = ['Maya', 'Leo', 'Nora', 'Theo', 'Ivy', 'Milo', 'Zara', 'Finn', 'Luna', 'Kai', 'Ruby', 'Otto', 'Edda', 'Hugo', 'Cleo', 'Axel', 'Pia', 'Noah', 'Lola', 'Remy', 'Tess', 'Ezra', 'Wren', 'Jude', 'Fay', 'Rex', 'Mina', 'Dex', 'Iris', 'Bruno', 'Gia', 'Sol', 'Nico', 'Ada', 'Cato', 'Vera', 'Pablo', 'Lia', 'Enzo', 'Rosa', 'Tiago', 'Sara', 'Dara', 'Joel', 'Lena', 'Ravi', 'Yuki', 'Omar', 'Elsa', 'Bento'];

function pickName(id, taken) {
  let i = hash(id) % NAMES.length;
  for (let n = 0; n < NAMES.length; n++, i = (i + 1) % NAMES.length) {
    if (!taken.has(NAMES[i])) return NAMES[i];
  }
  return NAMES[hash(id) % NAMES.length];
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeLook(id) {
  const h = hash(id);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >> 3) % HAIRS.length],
    shirt: SHIRTS[(h >> 6) % SHIRTS.length],
    pants: PANTS[(h >> 9) % PANTS.length],
    long: ((h >> 12) % 3) === 0,
    seed: (h >> 16) % 1000,
  };
}

// ---------- drawing helpers ----------
const r = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

function drawPerson(x, y, look, pose, t, extras) {
  const ix = Math.round(x);
  let iy = Math.round(y);
  const frame = Math.floor(t / 150) % 2;
  const walking = pose === 'walk';
  const sitting = pose === 'sit' || pose === 'type';
  const bob = walking && frame ? -1 : 0;
  if (sitting) iy += 2;
  else r(ix - 4, iy - 1, 8, 2, 'rgba(0,0,0,0.25)');

  // legs
  if (walking) {
    r(ix - 3, iy - 3, 2, 3 - frame, look.pants);
    r(ix + 1, iy - 3, 2, 2 + frame, look.pants);
  } else {
    r(ix - 3, iy - 3, 2, 3, look.pants);
    r(ix + 1, iy - 3, 2, 3, look.pants);
  }
  r(ix - 3, iy - 1, 2, 1, '#1c1c24');
  r(ix + 1, iy - 1, 2, 1, '#1c1c24');

  // torso + arms
  r(ix - 4, iy - 9 + bob, 8, 6, look.shirt);
  if (extras && extras.cheer) {
    const up = Math.floor(t / 120) % 2;
    r(ix - 5, iy - 16 + bob - up, 1, 7, look.shirt);
    r(ix - 5, iy - 17 + bob - up, 1, 1, look.skin);
    r(ix + 4, iy - 16 + bob - (1 - up), 1, 7, look.shirt);
    r(ix + 4, iy - 17 + bob - (1 - up), 1, 1, look.skin);
  } else if (extras && extras.facepalm) {
    r(ix - 5, iy - 9 + bob, 1, 4, look.shirt);
    r(ix - 5, iy - 5 + bob, 1, 1, look.skin);
    r(ix + 4, iy - 11 + bob, 1, 5, look.shirt);
  } else if (pose === 'type') {
    const k = Math.floor(t / 110) % 2;
    r(ix - 5, iy - 8, 1, 4, look.shirt);
    r(ix + 4, iy - 8, 1, 4, look.shirt);
    r(ix - 4, iy - 4 + k, 2, 1, look.skin);
    r(ix + 2, iy - 5 - k + 1, 2, 1, look.skin);
  } else {
    const swing = walking ? (frame ? 1 : -1) : 0;
    r(ix - 5, iy - 9 + bob + swing, 1, 4, look.shirt);
    r(ix + 4, iy - 9 + bob - swing, 1, 4, look.shirt);
    r(ix - 5, iy - 5 + bob + swing, 1, 1, look.skin);
    r(ix + 4, iy - 5 + bob - swing, 1, 1, look.skin);
  }
  if (extras && extras.cup) r(ix + 5, iy - 7 + bob, 2, 2, '#f4f4f4');
  if (extras && extras.snack) { r(ix + 5, iy - 7 + bob, 3, 2, '#e8832a'); r(ix + 5, iy - 7 + bob, 3, 1, '#f2c94c'); }
  if (extras && extras.book) { r(ix + 4, iy - 9 + bob, 5, 4, '#2f6fd9'); r(ix + 5, iy - 8 + bob, 3, 2, '#f4f4f4'); }
  if (extras && extras.cue) {
    const c = extras.cue;
    if (c.shooter) {
      const jab = Math.round(Math.sin(t / 140) * 2);
      for (let k = -4; k < 12; k++) r(ix + 5 + (k + jab) * 0.9, iy - 6 + (k + jab) * 0.55 * c.dir, 1, 1, k < 0 ? '#3a2414' : '#d9b27a');
    } else {
      r(ix + 6, iy - 15, 1, 15, '#d9b27a');
    }
  }

  // head
  r(ix - 3, iy - 14 + bob, 6, 5, look.skin);
  r(ix - 4, iy - 16 + bob, 8, 3, look.hair);
  r(ix - 4, iy - 14 + bob, 1, 2, look.hair);
  r(ix + 3, iy - 14 + bob, 1, 2, look.hair);
  if (look.long) {
    r(ix - 4, iy - 13 + bob, 1, 5, look.hair);
    r(ix + 3, iy - 13 + bob, 1, 5, look.hair);
  }
  const blink = (Math.floor(t / 100) + look.seed) % 38 === 0;
  if (!blink && !(extras && extras.facepalm)) {
    r(ix - 2, iy - 12 + bob, 1, 1, '#1c1c24');
    r(ix + 1, iy - 12 + bob, 1, 1, '#1c1c24');
  }
  if (extras && extras.facepalm) {
    r(ix - 1, iy - 14 + bob, 4, 3, look.skin); // hand over the face
    r(ix - 1, iy - 14 + bob, 4, 1, 'rgba(0,0,0,0.25)');
  }
}

// ---------- static scenery ----------
function drawBackground(t, coffeeBusy) {
  // floor
  for (let y = 44; y < WORLD_H; y += 16) {
    for (let x = 0; x < LW; x += 16) {
      const dark = ((x >> 4) + (y >> 4)) % 2;
      r(x, y, 16, 16, x >= 320 ? (dark ? '#5b4a6e' : '#54446a') : (dark ? '#8a7f72' : '#938878'));
    }
  }
  // divider between office and break area
  r(318, 44, 2, 74, '#3a3347');
  r(318, 140, 2, WORLD_H - 140, '#3a3347');
  drawRooms();

  // wall
  r(0, 0, LW, 44, '#4b5a7a');
  r(0, 40, LW, 4, '#2f3a54');
  for (let x = 0; x < LW; x += 24) r(x, 0, 1, 40, '#44536f');

  // windows
  const sky = lifeSky();
  for (const wx of [30, 100, 170]) {
    r(wx, 8, 44, 26, '#e8eef8');
    r(wx + 2, 10, 40, 22, sky.top);
    r(wx + 2, 22, 40, 10, sky.bottom);
    r(wx + 8, 13, 8, 3, sky.cloud);
    r(wx + 28, 15, 10, 3, sky.cloud);
    lifeWindowExtras(wx, sky, t);
    r(wx + 21, 10, 2, 22, '#e8eef8');
    r(wx + 2, 20, 40, 2, '#e8eef8');
  }
  // stats poster (text is drawn in the overlay pass)
  r(234, 6, 50, 30, '#8a6a40');
  r(235, 7, 48, 28, '#f4ecd0');
  r(238, 5, 2, 2, '#d93a3a');
  r(278, 5, 2, 2, '#d93a3a');

  // door
  r(DOOR_X - 10, 14, 22, 30, '#2b2231');
  r(DOOR_X - 8, 16, 18, 28, '#6e4a32');
  r(DOOR_X + 6, 30, 2, 2, '#e6c35a');

  // sign
  r(334, 6, 90, 20, '#2b2231');
  r(336, 8, 86, 16, '#3f3552');
  for (let i = 0; i < 9; i++) r(340 + i * 9, 12, 5, 8, i % 3 === 1 ? '#f2b84b' : '#e8e0f5');

  // clock (real time)
  r(444, 8, 20, 20, '#2b2231');
  r(446, 10, 16, 16, '#f2f2f2');
  const now = new Date();
  const mAng = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
  const hAng = (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2;
  for (let k = 1; k <= 6; k++) r(454 + Math.cos(mAng) * k, 18 + Math.sin(mAng) * k, 1, 1, '#2b2231');
  for (let k = 1; k <= 4; k++) r(454 + Math.cos(hAng) * k, 18 + Math.sin(hAng) * k, 1, 1, '#c0392b');

  // rug in the break area
  r(326, 144, 108, 92, '#7a3b4f');
  r(328, 146, 104, 88, '#9a4b63');

  // coffee counter + espresso machine
  r(420, 44, 36, 30, '#6b4a32');
  r(420, 44, 36, 4, '#8a6244');
  r(424, 26, 28, 22, '#b8bcc9');
  r(424, 26, 28, 4, '#8a8fa0');
  r(427, 31, 10, 8, '#2b2f3a');
  r(439, 31, 10, 3, '#3b3f4c');
  r(441, 36, 2, 2, '#e64a3b');
  r(445, 36, 2, 2, '#5fd96a');
  r(431, 40, 12, 3, '#6b6e7c');
  r(436, 43, 3, 3, '#4a2f1c');
  r(433, 46, 9, 2, '#8a8fa0');
  r(446, 46, 5, 4, '#f4f4f4'); // spare cup
  r(448, 47, 2, 2, '#4a2f1c');
  if (coffeeBusy) {
    for (let k = 0; k < 3; k++) {
      const ph = ((t / 90 + k * 7) % 14);
      r(435 + Math.sin(t / 220 + k) * 2, 40 - ph * 0.8, 1, 2, 'rgba(255,255,255,' + (0.7 - ph / 24) + ')');
    }
  }
  // water cooler
  r(458, 52, 12, 24, '#d9dde8');
  r(459, 40, 10, 14, '#8fd0f0');
  r(460, 42, 3, 10, '#c9ecfa');
  r(462, 62, 4, 3, '#4a6ad9');

  placesDrawBack(t);

  // plants
  for (const [px, py] of [[326, 248], [468, 250]]) {
    r(px, py + 10, 10, 8, '#8a5a3a');
    r(px + 1, py, 8, 10, '#3f9a4a');
    r(px + 3, py - 4, 4, 6, '#52b85c');
  }
}

function drawRooms() {
  const wall = '#3a3347';
  ROOMS.forEach((rm, i) => {
    for (let y = rm.y; y < rm.y + rm.h; y += 16) {
      for (let x = 0; x < ROOM_W; x += 16) {
        r(x, y, Math.min(16, ROOM_W - x), Math.min(16, rm.y + rm.h - y), ((x >> 4) + (y >> 4)) % 2 ? '#b8956a' : '#ad8b61');
      }
    }
    r(0, rm.y, ROOM_W, 3, wall);
    r(0, rm.y + 3, ROOM_W - 2, 2, 'rgba(0,0,0,0.18)');
    r(0, rm.y, 3, rm.h, wall);
    if (i === ROOMS.length - 1) r(0, rm.y + rm.h - 3, ROOM_W, 3, wall);
    const doorTop = rm.aisleY - 18;
    const doorBottom = rm.aisleY + 4;
    r(ROOM_W - 2, rm.y, 3, doorTop - rm.y, wall);
    r(ROOM_W - 2, doorBottom, 3, rm.y + rm.h - doorBottom, wall);
    r(ROOM_W - 2, doorTop - 1, 3, 1, '#e6c35a');
    r(ROOM_W - 2, doorBottom, 3, 1, '#e6c35a');
    if (rm.h >= 100) {
      r(14, rm.y + 6, 82, 24, '#8a8fa0');
      r(15, rm.y + 7, 80, 22, '#f4f4f8');
      r(14, rm.y + 30, 82, 1, '#6a6f80');
      r(6, rm.y + rm.h - 26, 10, 8, '#8a5a3a');
      r(7, rm.y + rm.h - 36, 8, 10, '#3f9a4a');
      r(9, rm.y + rm.h - 40, 4, 6, '#52b85c');
    }
  });
}

function drawVacantShade() {
  const owned = new Set([...agents.values()].map((a) => Math.floor(a.desk / DESKS_PER_ROOM)));
  ROOMS.forEach((rm, i) => {
    if (!owned.has(i)) r(0, rm.y, ROOM_W, rm.h, 'rgba(20,18,30,0.3)');
  });
}

function drawCouchBack() {
  r(336, 64, 88, 24, '#c2563b');
  r(336, 64, 88, 4, '#d9694c');
  r(332, 72, 8, 28, '#a8452e');
  r(420, 72, 8, 28, '#a8452e');
}
function drawCouchFront() {
  r(340, 94, 80, 10, '#d9694c');
  r(340, 102, 80, 2, '#a8452e');
  for (const cx of [363, 389]) r(cx, 94, 1, 8, '#a8452e');
}

function ballPos(i, cycle) {
  const h = hash('ball' + i + ':' + cycle);
  return { x: POOL.x + 8 + (h % 1000) / 1000 * (POOL.w - 16), y: POOL.y + 5 + ((h >>> 10) % 1000) / 1000 * 11 };
}
const BALL_COLORS = ['#f4f4f4', '#f2c94c', '#2f6fd9', '#d93a3a', '#6b3fa0', '#e8832a', '#2a9d55', '#1c1c24'];

function drawPoolTable(t, playing) {
  const { x, y, w } = POOL;
  r(x + 2, y + 24, 4, 9, '#3a2414');
  r(x + w - 6, y + 24, 4, 9, '#3a2414');
  r(x, y, w, 24, '#6b3f22');
  r(x, y + 22, w, 3, '#4a2f1c');
  r(x + 3, y + 3, w - 6, 16, '#2f8f5b');
  r(x + 3, y + 3, w - 6, 2, '#3aa66b');
  for (const [px, py] of [[x + 1, y + 1], [x + w / 2 - 2, y], [x + w - 5, y + 1], [x + 1, y + 17], [x + w / 2 - 2, y + 18], [x + w - 5, y + 17]]) r(px, py, 4, 4, '#14110f');
  const cycle = Math.floor(t / 4500);
  const phase = (t % 4500) / 4500;
  const move = playing ? Math.min(1, Math.max(0, (phase - 0.55) / 0.35)) : 0;
  const e = move * move * (3 - 2 * move);
  for (let i = 0; i < BALL_COLORS.length; i++) {
    const p0 = ballPos(i, cycle);
    const p1 = playing ? ballPos(i, cycle + 1) : p0;
    r(p0.x + (p1.x - p0.x) * e, p0.y + (p1.y - p0.y) * e, 2, 2, BALL_COLORS[i]);
  }
}

function drawDesk(d, awake, t) {
  const { x, y } = d;
  // surface + front
  const boss = !!d.boss;
  r(x, y, 46, 4, boss ? '#b8814f' : '#d9b27a');
  r(x, y + 4, 46, 16, boss ? '#7a4f2e' : '#a8804f');
  r(x + 2, y + 6, 20, 12, boss ? '#5e3d26' : '#8f6a40');
  r(x + 24, y + 6, 20, 12, boss ? '#5e3d26' : '#8f6a40');
  if (boss) r(x + 17, y + 20, 12, 3, '#e6c35a');
  r(x + 10, y + 11, 4, 2, '#e6c35a');
  r(x + 32, y + 11, 4, 2, '#e6c35a');
  r(x + 1, y + 20, 3, 3, '#6b4f30');
  r(x + 42, y + 20, 3, 3, '#6b4f30');
  // keyboard + mug
  r(x + 8, y + 1, 16, 2, '#4b4e5c');
  r(x + 27, y + 1, 3, 3, '#f4f4f4');
  // monitor (screen faces the viewer, off to the right)
  r(x + 30, y - 12, 15, 11, '#2b2f3a');
  r(x + 31, y - 11, 13, 8, awake ? '#1d2a44' : '#15171f');
  if (awake) {
    for (let i = 0; i < 4; i++) {
      const w = 3 + ((hash(String(i + Math.floor(t / 350))) >> 4) % 7);
      r(x + 32, y - 10 + i * 2, w, 1, i % 2 ? '#7ec8f0' : '#5fd96a');
    }
  }
  r(x + 35, y - 3, 5, 2, '#4b4e5c');
}

// ---------- agents ----------
const agents = new Map(); // id -> agent
let hiddenCount = 0;
let sessionsLoaded = false;

function assignDesk(parent) {
  const used = new Set([...agents.values()].map((a) => a.desk));
  if (!parent) {
    for (let i = 0; i < MAX_ROOMS; i++) if (!used.has(i * DESKS_PER_ROOM)) return i * DESKS_PER_ROOM;
    return -1;
  }
  const room = Math.floor(parent.desk / DESKS_PER_ROOM);
  for (let j = 1; j < DESKS_PER_ROOM; j++) {
    const idx = room * DESKS_PER_ROOM + j;
    if (!used.has(idx)) return idx;
  }
  return -1;
}

function freeSlot(a) {
  const used = new Set([...agents.values()].map((x) => x.slot));
  const free = BREAK_SLOTS.map((_, i) => i).filter((i) => !used.has(i));
  if (!free.length) return -1;
  const liked = a && a.trait ? a.trait.slots.filter((i) => free.includes(i)) : [];
  if (liked.length && Math.random() < 0.75) return liked[Math.floor(Math.random() * liked.length)];
  const freePool = free.filter((i) => POOL_SLOTS.includes(i));
  const poolBusy = POOL_SLOTS.some((i) => used.has(i));
  if (freePool.length && Math.random() < (poolBusy ? 0.9 : 0.6)) {
    return freePool[Math.floor(Math.random() * freePool.length)];
  }
  return free[Math.floor(Math.random() * free.length)];
}

function seatPos(a) { const d = DESKS[a.desk]; return { x: d.seatX, y: d.seatY }; }

const PLACES = [...BREAK_SLOTS, ...LIB_SLOTS, ...MEET_SLOTS];

// From anywhere outside the rooms to the aisle row, without cutting through furniture.
function legToAisle(a, pts) {
  const at = PLACES.find((p) => p.via && Math.abs(p.x - a.x) < 2 && Math.abs(p.y - a.y) < 2);
  if (at) pts.push([at.via, a.y], [at.via, AISLE_Y]); // leaving a spot that is reached from the side
  else if (a.x > POOL_BYPASS_X && a.x < POOL.x + POOL.w + 6 && a.y > 200 && a.y < 230) pts.push([POOL_BYPASS_X, a.y], [POOL_BYPASS_X, AISLE_Y]); // near side of the pool table
  else if (Math.abs(a.y - AISLE_Y) > 1) pts.push([a.x, AISLE_Y]);
}

function routeTo(a, dest) {
  const pts = [];
  const d = DESKS[a.desk];
  if (dest.type === 'visit') {
    // a subagent walks along its room's aisle to the gap next to the main agent's desk
    const bd = DESKS[dest.boss.desk];
    if (a.x > DOOR_X + 0.5) { legToAisle(a, pts); pts.push([DOOR_X, AISLE_Y], [DOOR_X, d.aisleY]); } // it was outside, in the meeting or library
    else if (Math.abs(a.y - d.seatY) < 2 && a.x >= d.x - 6 && a.x <= d.gapX) pts.push([d.gapX, d.seatY], [d.gapX, d.aisleY]);
    else pts.push([a.x, d.aisleY]);
    pts.push([bd.gapX, bd.aisleY], [bd.gapX, bd.seatY]);
    a.path = pts;
    return;
  }
  const atSeatRow = Math.abs(a.y - d.seatY) < 2 && a.x >= d.x - 6 && a.x <= d.gapX;
  if (atSeatRow) {
    pts.push([d.gapX, d.seatY], [d.gapX, d.aisleY], [DOOR_X, d.aisleY], [DOOR_X, AISLE_Y]);
  } else if (a.x < DOOR_X - 0.5) {
    const aisle = ROW_AISLES.reduce((p, q) => (Math.abs(q - a.y) < Math.abs(p - a.y) ? q : p));
    pts.push([a.x, aisle], [DOOR_X, aisle], [DOOR_X, AISLE_Y]);
  } else {
    legToAisle(a, pts);
  }
  if (dest.type === 'desk') {
    pts.push([DOOR_X, AISLE_Y], [DOOR_X, d.aisleY], [d.gapX, d.aisleY], [d.gapX, d.seatY], [d.seatX, d.seatY]);
  } else if (dest.type === 'slot') {
    const s = dest.spot || BREAK_SLOTS[dest.slot];
    if (s.via) pts.push([s.via, AISLE_Y], [s.via, s.y], [s.x, s.y]);
    else pts.push([s.x, AISLE_Y], [s.x, s.y]);
  } else if (dest.type === 'exit') {
    pts.push([DOOR_X, AISLE_Y], [DOOR_X, DOOR_Y]);
  }
  a.path = pts;
}

function applySessions(list) {
  sessionsLoaded = true;
  const byRecent = (p, q) => q.updated - p.updated;
  const parents = list.filter((s) => !s.parent).sort(byRecent);
  const shownParents = parents.slice(0, MAX_PARENTS);
  const parentIds = new Set(shownParents.map((s) => s.id));
  const subs = list.filter((s) => s.parent && parentIds.has(s.parent)).sort(byRecent);
  const visible = [...shownParents, ...subs];
  hiddenCount = parents.length - shownParents.length;
  const ids = new Set(visible.map((s) => s.id));

  for (const a of agents.values()) a.overflowSubs = 0;
  const born = []; // agents created by this update
  for (const s of visible) {
    let a = agents.get(s.id);
    if (!a) {
      const parentAgent = s.parent ? agents.get(s.parent) : null;
      if (s.parent && !parentAgent) continue;
      const desk = assignDesk(parentAgent);
      if (desk < 0) {
        if (parentAgent) parentAgent.overflowSubs++; // the room is full: show a +N badge
        continue;
      }
      a = {
        id: s.id, name: pickName(s.id, new Set([...agents.values()].map((x) => x.name))), sub: !!s.parent, desk, slot: -1, trait: traitFor(s.id), known: false, x: DOOR_X, y: DOOR_Y, path: [], look: makeLook(s.id),
        dest: null, leaving: false, idleSince: 0, state: 'idle', alpha: 1, spot: -1, createdAt: Date.now(),
      };
      agents.set(s.id, a);
      born.push(a);
    }
    a.project = s.project;
    a.title = s.title;
    const prevState = a.known ? a.state : null;
    a.state = s.state;
    a.activity = s.activity;
    a.updated = s.updated;
    a.parent = s.parent || null;
    a.tokens = s.tokens || null;
    a.ctx = s.ctx || 0;
    a.ctxMax = s.ctxMax || 200000;
    a.cost = s.cost || 0;
    a.costPartial = !!s.costPartial;
    a.model = s.model || '';
    a.todos = s.todos || null;
    a.recent = s.recent || [];
    a.firstTs = s.firstTs || 0;
    a.turnStart = s.turnStart || 0;
    a.research = !!s.research;
    a.building = !!s.building;

    const nowE = Date.now();
    // a long task just finished: confetti
    if (!a.sub && prevState === 'working' && s.state === 'idle' && s.turnStart && nowE - s.turnStart > 120000) celebrate(a, nowE);
    // the latest test run failed: facepalm
    if (!a.sub && s.testFailTs && s.testFailTs > (a.seenFail || 0)) {
      a.seenFail = s.testFailTs;
      if (a.known && nowE - s.testFailTs < 30000) {
        a.facepalmUntil = nowE + 4000;
        a.say = { text: 'ugh, tests failed...', until: nowE + 4000 };
      }
    }
    a.known = true;
  }
  planStandups(born);
  for (const a of agents.values()) {
    if (!ids.has(a.id) && !a.leaving) {
      a.leaving = true;
      a.slot = -1;
      a.spot = -1;
      a.meeting = null;
      const boss = a.sub && a.parent ? agents.get(a.parent) : null;
      if (boss && !boss.leaving && Math.floor(boss.desk / DESKS_PER_ROOM) === Math.floor(a.desk / DESKS_PER_ROOM)) {
        // a finished subagent first hands its report to the main agent
        a.dest = 'visit';
        a.visitBoss = boss.id;
        routeTo(a, { type: 'visit', boss });
      } else {
        a.dest = 'exit';
        routeTo(a, { type: 'exit' });
      }
    }
  }
}

// Several subagents of one terminal that appear close together gather at the meeting table first.
function planStandups(born) {
  const now = Date.now();
  for (const boss of new Set(born.filter((a) => a.sub && a.parent).map((a) => agents.get(a.parent)))) {
    if (!boss || boss.leaving) continue;
    const crew = [...agents.values()].filter((a) => a.sub && a.parent === boss.id && !a.leaving && now - a.createdAt < STANDUP_JOIN_MS && (a.meeting || a.dest == null || a.path.length));
    if (crew.length < 2) continue;
    const group = (crew.find((a) => a.meeting) || {}).meeting || { until: 0 };
    for (const a of crew) if (!a.meeting && a.dest !== 'meeting') a.meeting = group;
    if (!boss.say || boss.say.until < now) boss.say = { text: 'stand-up time!', until: now + 2400 };
  }
}

const COFFEE_LINES = ['ahh, coffee!', 'fuel acquired', 'one for the road', 'caffeine loaded'];

// Before a new job, an agent in the break area sometimes grabs a coffee first (coffee addicts nearly always).
function wantsCoffeeRun(a) {
  if (a.slot === COFFEE_SLOT) return false; // already standing at the machine
  if ([...agents.values()].some((x) => x !== a && x.slot === COFFEE_SLOT)) return false; // someone is using it
  return Math.random() < (a.trait && a.trait.id === 'coffee' ? 0.9 : 0.25);
}

function freeSpot(list, dest, a) {
  const used = new Set([...agents.values()].filter((x) => x !== a && !x.leaving && x.dest === dest && x.spot >= 0).map((x) => x.spot));
  return list.findIndex((_, i) => !used.has(i));
}

// Stand-up at the meeting table and reading at the library. Returns true while the agent is busy with one.
function updateSpecial(a, now) {
  const m = a.meeting;
  if (m && (!m.until || now < m.until)) {
    if (a.dest !== 'meeting') {
      const spot = freeSpot(MEET_SLOTS, 'meeting', a);
      if (spot < 0) a.meeting = null; // table is full: go straight to the desk
      else {
        a.spot = spot; a.slot = -1; a.dest = 'meeting'; a.meetSaid = false;
        routeTo(a, { type: 'slot', spot: MEET_SLOTS[spot] });
        return true;
      }
    } else {
      if (!a.path.length) {
        if (!m.until) m.until = now + STANDUP_MS; // the first one to arrive starts the clock
        if (!a.meetSaid) {
          a.meetSaid = true;
          const from = now + 300 + a.spot * 900;
          a.say = { text: STANDUP_LINES[hash(a.id) % STANDUP_LINES.length], from, until: from + 1700 };
        }
      }
      return true;
    }
  }
  a.meeting = null; // the stand-up is over (or never happened)
  if (a.dest === 'meeting') { a.spot = -1; a.meetSaid = false; }

  if (a.state === 'working' && a.research) a.libUntil = now + LIB_HOLD_MS;
  if (a.libUntil > now && a.dest !== 'coffee') {
    if (a.dest === 'library') return true;
    const spot = freeSpot(LIB_SLOTS, 'library', a);
    if (spot >= 0) {
      a.spot = spot; a.slot = -1; a.dest = 'library';
      routeTo(a, { type: 'slot', spot: LIB_SLOTS[spot] });
      return true;
    }
  } else if (a.dest === 'library') a.spot = -1;
  return false;
}

function updateAgent(a, dt, now) {
  if (a.leaving) {
    if (a.dest === 'visit') {
      if (!a.path.length) {
        if (!a.visitUntil) {
          a.visitUntil = now + 2600;
          a.reportAt = now;
          a.say = { text: 'here is my report!', until: now + 2000 };
          const boss = agents.get(a.visitBoss);
          if (boss && !boss.leaving) {
            boss.say = { text: 'thanks!', from: now + 1300, until: now + 2900 };
            boss.paperUntil = now + 9000;
          }
        } else if (now > a.visitUntil) {
          a.dest = 'exit';
          routeTo(a, { type: 'exit' });
        }
      }
    } else if (!a.path.length) {
      a.gone = true;
      return;
    }
  } else if (!updateSpecial(a, now)) {
    const wantDesk = a.sub || a.state !== 'idle';
    if (wantDesk) a.idleSince = 0;
    else if (!a.idleSince) a.idleSince = now;
    const wantBreak = !wantDesk && now - a.idleSince > (a.trait ? a.trait.idleDelay : 2500);

    if (a.dest === 'coffee' && !wantDesk) a.dest = 'break'; // changed plans: just chill at the machine
    if (wantDesk && a.dest !== 'desk' && a.dest !== 'coffee') {
      if (a.dest === 'break' && !a.sub && wantsCoffeeRun(a)) {
        a.slot = COFFEE_SLOT;
        a.dest = 'coffee';
        a.coffeeUntil = 0;
        a.cupDone = false;
        routeTo(a, { type: 'slot', slot: COFFEE_SLOT });
      } else {
        a.slot = -1;
        a.dest = 'desk';
        routeTo(a, { type: 'desk' });
      }
    } else if (wantBreak && a.dest !== 'break') {
      const slot = freeSlot(a);
      if (slot >= 0) {
        a.slot = slot;
        a.cupDone = false;
        a.dest = 'break';
        routeTo(a, { type: 'slot', slot });
      }
    }
  }

  // move along path (axis-aligned segments)
  a.walking = false;
  if (a.path.length) {
    const [tx, ty] = a.path[0];
    const dx = tx - a.x;
    const dy = ty - a.y;
    const dist = Math.hypot(dx, dy);
    const step = SPEED * dt;
    if (dist <= step) { a.x = tx; a.y = ty; a.path.shift(); }
    else { a.x += (dx / dist) * step; a.y += (dy / dist) * step; }
    a.walking = true;
  }

  // arrived at the coffee machine: drink, count the cup, then go to work
  if (!a.leaving && !a.path.length) {
    if (a.dest === 'coffee') {
      if (!a.coffeeUntil) {
        a.coffeeUntil = now + 2800;
        a.cupDone = true;
        addCup();
        a.say = { text: COFFEE_LINES[hash(a.id + now) % COFFEE_LINES.length], until: now + 2600 };
      } else if (now > a.coffeeUntil) {
        a.coffeeUntil = 0;
        a.slot = -1;
        a.dest = 'desk';
        routeTo(a, { type: 'desk' });
      }
    } else if (a.dest === 'break' && a.slot === COFFEE_SLOT && !a.cupDone) {
      a.cupDone = true;
      addCup();
    }
  }
}

function poseOf(a) {
  if (a.walking) return 'walk';
  if (a.dest === 'desk') return a.state === 'working' ? 'type' : 'sit';
  if ((a.dest === 'break' || a.dest === 'coffee') && a.slot >= 0) {
    const sl = BREAK_SLOTS[a.slot];
    return sl.run ? 'walk' : sl.sit ? 'sit' : 'stand'; // running on the treadmill is walking on the spot
  }
  return 'stand';
}

// ---------- text overlays (screen space, crisp) ----------
let S = 3;
let OX = 0;
let OY = 0;

function pill(text, cx, cy, bg, fg, font) {
  ctx.font = font;
  const w = ctx.measureText(text).width + 10;
  const h = 15;
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}

// Two-line name tag: person's name on top, project / agent type below.
function nameTag(name, sub, cx, top, bg, font, smallFont, ctxFrac) {
  ctx.font = font;
  const w1 = ctx.measureText(name).width;
  ctx.font = smallFont;
  const w2 = ctx.measureText(sub).width;
  const w = Math.max(w1, w2) + 10;
  const h1 = 15;
  const h2 = 12;
  const gauge = ctxFrac === null ? 0 : 4;
  const x = Math.round(cx - w / 2);
  ctx.fillStyle = bg;
  ctx.fillRect(x, top, w, h1 + h2 + gauge);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, x + w / 2, top + h1 / 2 + 1);
  ctx.font = smallFont;
  ctx.fillStyle = '#b9b0d0';
  ctx.fillText(sub, x + w / 2, top + h1 + h2 / 2);
  if (gauge) {
    ctx.fillStyle = '#2b2f3a';
    ctx.fillRect(x + 2, top + h1 + h2 + 1, w - 4, 2);
    ctx.fillStyle = ctxFrac < 0.6 ? '#5fd96a' : ctxFrac < 0.85 ? '#f2a93b' : '#d93a3a';
    ctx.fillRect(x + 2, top + h1 + h2 + 1, Math.max(1, Math.round((w - 4) * ctxFrac)), 2);
  }
  return { x, y: top, w, h: h1 + h2 + gauge };
}

// Speech balloon with a little tail pointing down at the head.
function balloon(text, cx, bottom, bg, fg, font) {
  ctx.font = font;
  const w = ctx.measureText(text).width + 14;
  const h = 19;
  const tail = Math.max(4, Math.round(S * 1.5));
  const x = Math.round(cx - w / 2);
  const y = Math.round(bottom - tail - h);
  ctx.fillStyle = '#1c1c24';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.beginPath();
  ctx.moveTo(cx - tail - 1, y + h + 1);
  ctx.lineTo(cx + tail + 1, y + h + 1);
  ctx.lineTo(cx, y + h + tail + 2);
  ctx.fill();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(cx - tail, y + h);
  ctx.lineTo(cx + tail, y + h);
  ctx.lineTo(cx, y + h + tail);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}

var selectedId = null; // agent shown in the details panel (set by ui.js)
var mouseDev = { x: -1, y: -1 }; // mouse position in canvas pixels (set by ui.js)
let dailyStatsData = null;

function fmtTok(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(1) + 'M';
}

function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 10) return m + 'm ' + (s % 60) + 's';
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function fmtCost(c) {
  if (!c) return '$0';
  return '~$' + (c < 10 ? c.toFixed(2) : c < 100 ? c.toFixed(1) : Math.round(c));
}

function freshTokens(a) {
  const t = a.tokens;
  return t ? t.input + t.output + t.cacheCreate : 0;
}

function clip(text, n) { return text.length > n ? text.slice(0, n - 1) + '…' : text; }

function drawOverlays(now, t) {
  const fs = Math.max(10, Math.round(S * 3.6));
  const font = `bold ${fs}px Consolas, "Courier New", monospace`;
  const sx = (x) => OX + x * S;
  const sy = (y) => OY + y * S;
  const smallFont = `${Math.max(8, Math.round(S * 2.8))}px Consolas, "Courier New", monospace`;

  for (const a of agents.values()) {
    const pose = poseOf(a);
    const seated = pose === 'sit' || pose === 'type';
    const atDesk = a.dest === 'desk' && !a.walking && seated;
    ctx.globalAlpha = 1;

    // name tag (name + project / agent type)
    const poolSlot = a.dest === 'break' && a.slot >= 0 && !a.walking ? BREAK_SLOTS[a.slot] : null;
    const farPool = !!(poolSlot && poolSlot.pool === 1);
    const tagTop = farPool ? sy(a.y - 17) - 31 : sy(atDesk ? DESKS[a.desk].y + 25 : a.y + 4);
    const ctxFrac = a.ctx ? Math.min(1, a.ctx / (a.ctxMax || 200000)) : null;
    const tagRect = nameTag(a.name, (a.sub ? '↳ ' : '') + clip(a.project || '?', 14), sx(a.x), tagTop, a.sub ? 'rgba(36,70,120,0.92)' : 'rgba(20,18,30,0.85)', font, smallFont, ctxFrac);
    a.hit = [{ x: sx(a.x) - 7 * S, y: sy(a.y - 17), w: 14 * S, h: 21 * S }, tagRect];
    if (a.id === selectedId) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx(a.x), sy(a.y), 8 * S, 3 * S, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // talk balloon: something said out loud wins; then small talk; otherwise what a seated agent is doing
    const sayOn = a.say && now >= (a.say.from || 0) && now < a.say.until;
    const bBottom = sy(a.y - (seated ? 14 : 17)) - (farPool ? 33 : 0);
    if (sayOn) {
      const cheering = a.cheerUntil > now;
      balloon(a.say.text, sx(a.x), bBottom, cheering ? '#fff2b8' : '#f5f5ff', cheering ? '#5a3a00' : '#1c1c24', font);
    } else if (a.chat) {
      if (a.chat.speaking) balloon(a.chat.text, sx(a.x), bBottom, '#f5f5ff', '#1c1c24', font);
    } else if (!a.walking && a.dest === 'library') {
      balloon(clip(a.activity || 'reading...', 28), sx(a.x), bBottom, '#f5f5ff', '#1c1c24', font);
    } else if (!a.walking && !seated && a.dest === 'break' && a.slot >= 0 && BREAK_SLOTS[a.slot].label) {
      balloon(BREAK_SLOTS[a.slot].label, sx(a.x), bBottom, '#f5f5ff', '#4b4e5c', font);
    } else if (seated && !a.walking) {
      if (a.dest === 'desk') {
        if (a.state === 'waiting') {
          const blink = Math.floor(t / 450) % 2 === 0;
          balloon('? ' + clip(a.activity || 'I need you', 26), sx(a.x), bBottom, blink ? '#f2a93b' : '#d98f22', '#1c1408', font);
        } else {
          balloon(clip(a.activity || 'working...', 28), sx(a.x), bBottom, '#f5f5ff', '#1c1c24', font);
        }
      } else if (a.dest === 'break') {
        const sleepyAfter = a.trait && a.trait.id === 'owl' ? 20000 : 120000;
        balloon(now - a.updated > sleepyAfter ? 'zzz...' : (BREAK_SLOTS[a.slot] && BREAK_SLOTS[a.slot].label) || 'chilling', sx(a.x), bBottom, '#f5f5ff', '#4b4e5c', font);
      }
    }
  }

  // room tabs: who owns each room and how many subagents are in it
  ROOMS.forEach((rm, i) => {
    const members = [...agents.values()].filter((a) => !a.leaving && Math.floor(a.desk / DESKS_PER_ROOM) === i);
    const boss = members.find((a) => !a.sub);
    const subCount = members.filter((a) => a.sub).length;
    const overflow = boss ? boss.overflowSubs || 0 : 0;
    if (rm.h < 70) {
      // small rooms are crowded: show their tab only while the mouse is over the room or someone in it is selected
      const inRoom = mouseDev.x >= sx(0) && mouseDev.x <= sx(ROOM_W) && mouseDev.y >= sy(rm.y) && mouseDev.y <= sy(rm.y + rm.h);
      if (!inRoom && !members.some((a) => a.id === selectedId)) return;
    }
    let text = 'vacant room';
    if (boss) {
      text = boss.name + "'s room · " + clip(boss.project || '?', 14);
      if (subCount || overflow) text += ' · ' + subCount + ' sub' + (subCount === 1 ? '' : 's') + (overflow ? ' +' + overflow + ' more' : '');
      if (boss.tokens) text += ' · ' + fmtTok(freshTokens(boss)) + ' tok';
      if (boss.cost) text += ' · ' + fmtCost(boss.cost);
    }
    ctx.font = smallFont;
    const w = ctx.measureText(text).width + 12;
    const x = rm.h < 70 ? sx(ROOM_W - 4) - w : sx(6);
    const y = sy(rm.y + rm.h - 8) - 7;
    ctx.fillStyle = boss ? 'rgba(58,51,71,0.95)' : 'rgba(58,51,71,0.7)';
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = boss ? '#e6c35a' : '#9a92b0';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 6, y + 8);
  });

  // "+N" badge at the end of a room's desk row when its subagents do not all fit
  for (const boss of agents.values()) {
    if (boss.leaving || boss.sub || !boss.overflowSubs) continue;
    const d = DESKS[boss.desk];
    const cx = sx(288);
    const cy = sy(d.y - 6);
    ctx.fillStyle = '#d93a3a';
    ctx.beginPath();
    ctx.arc(cx, cy, 8 * S / 2 + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('+' + boss.overflowSubs, cx, cy + 1);
  }

  // whiteboard in each tall room shows the main agent's todo list
  const bfs = Math.max(7, Math.round(S * 2.6));
  ROOMS.forEach((rm, i) => {
    if (rm.h < 100) return;
    const boss = [...agents.values()].find((a) => !a.leaving && !a.sub && a.desk === i * DESKS_PER_ROOM);
    if (!boss) return;
    const todos = boss.todos || [];
    const done = todos.filter((t) => t.status === 'completed').length;
    const ordered = [
      ...todos.filter((t) => t.status === 'in_progress'),
      ...todos.filter((t) => t.status === 'pending'),
      ...todos.filter((t) => t.status === 'completed').reverse(),
    ].slice(0, 3);
    const left = sx(14) + 5;
    const top = sy(rm.y + 6) + S;
    const step = (22 * S) / 4;
    const maxW = 80 * S - 10;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold ' + bfs + 'px Consolas, "Courier New", monospace';
    ctx.fillStyle = '#333344';
    ctx.fillText(todos.length ? 'TODO ' + done + '/' + todos.length : 'TODO', left, top + step * 0.5);
    ctx.font = bfs + 'px Consolas, "Courier New", monospace';
    if (!ordered.length) {
      ctx.fillStyle = '#8a8fa0';
      ctx.fillText('no list yet', left, top + step * 1.5);
    }
    ordered.forEach((t, k) => {
      const mark = t.status === 'completed' ? '✓ ' : t.status === 'in_progress' ? '▶ ' : '○ ';
      let text = mark + t.text;
      while (text.length > 3 && ctx.measureText(text).width > maxW) text = text.slice(0, -2) + '…';
      ctx.fillStyle = t.status === 'completed' ? '#2a9d55' : t.status === 'in_progress' ? '#1f5fbf' : '#555566';
      ctx.fillText(text, left, top + step * (k + 1.5));
    });
  });

  // poster on the wall: today's totals
  {
    const st = dailyStatsData;
    const lines = st
      ? [st.sessions + ' sessions', st.subagents + ' subagents', st.tools + ' tool calls', fmtTok(st.tokens) + ' tok ' + fmtCost(st.cost)]
      : ['...'];
    const px = sx(234 + 25);
    const py = sy(6);
    const step = (30 * S) / 5;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = 'bold ' + bfs + 'px Consolas, "Courier New", monospace';
    ctx.fillStyle = '#7a4a1c';
    ctx.fillText('TODAY', px, py + step * 0.5);
    ctx.font = bfs + 'px Consolas, "Courier New", monospace';
    ctx.fillStyle = '#3a2a1a';
    lines.forEach((l, k) => ctx.fillText(l, px, py + step * (k + 1.5)));
  }

  // pool shooter calls their shot
  for (const a of agents.values()) {
    if (a.poolShooter && !a.walking) {
      const lines = ['my shot!', 'watch this...', 'corner pocket!', 'eight ball!'];
      const far = BREAK_SLOTS[a.slot] && BREAK_SLOTS[a.slot].pool === 1;
      balloon(lines[Math.floor(t / 3500) % lines.length], sx(a.x), sy(a.y - 17) - (far ? 33 : 0), '#f5f5ff', '#2f6f4a', font);
    }
  }

  lifeOverlay(now, t, sx, sy, font, smallFont);
  placesOverlay(now, t, sx, sy, smallFont);

  // HUD
  const all = [...agents.values()].filter((a) => !a.leaving);
  const working = all.filter((a) => a.state === 'working').length;
  const waiting = all.filter((a) => a.state === 'waiting').length;
  const hud = `${all.length} session${all.length === 1 ? '' : 's'} · ${working} working · ${waiting} waiting for you` + (hiddenCount ? ` · +${hiddenCount} hidden` : '');
  ctx.font = font;
  pill(hud, sx(8) + ctx.measureText(hud).width / 2 + 5, sy(34), 'rgba(20,18,30,0.75)', '#e8e0f5', font);

  if (sessionsLoaded && !all.length) {
    pill('No Claude Code terminals are open. Start one and it will show up here.', sx(LW / 2), sy(LH / 2), 'rgba(20,18,30,0.85)', '#e8e0f5', font);
  }
}

// ---------- main loop ----------
let appliedWorldH = LH;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  S = Math.max(1, Math.floor(Math.min((vw * dpr) / LW, (vh * dpr) / LH)));
  const cssH = Math.max(vh, Math.ceil((WORLD_H * S) / dpr));
  canvas.style.height = cssH + 'px';
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(cssH * dpr);
  OX = Math.floor((canvas.width - LW * S) / 2);
  OY = WORLD_H > LH ? 0 : Math.floor((canvas.height - LH * S) / 2);
  // a scrollbar appearing changes the usable width: settle once more
  if (!resize.again && Math.abs(document.documentElement.clientWidth - vw) > 1) {
    resize.again = true;
    resize();
    resize.again = false;
  }
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const now = Date.now();

  const maxRoom = Math.max(-1, ...[...agents.values()].map((a) => Math.floor(a.desk / DESKS_PER_ROOM)));
  const wantRooms = Math.min(MAX_ROOMS, Math.max(2, maxRoom + 1));
  if (wantRooms !== ROOM_COUNT) {
    layoutRooms(wantRooms);
    for (const a of agents.values()) {
      if (a.dest !== 'desk') continue;
      if (a.path.length) routeTo(a, { type: 'desk' });
      else { a.x = DESKS[a.desk].seatX; a.y = DESKS[a.desk].seatY; }
    }
  }
  if (WORLD_H !== appliedWorldH) { appliedWorldH = WORLD_H; resize(); }
  for (const a of agents.values()) updateAgent(a, dt, now);
  lifeUpdate(dt, now);
  const players = [...agents.values()]
    .filter((a) => a.dest === 'break' && !a.leaving && !a.path.length && a.slot >= 0 && BREAK_SLOTS[a.slot].pool)
    .sort((p, q) => p.slot - q.slot);
  const shooter = players.length >= 2 ? players[Math.floor(nowMs / 3500) % players.length] : null;
  for (const a of agents.values()) a.poolShooter = a === shooter;
  const coffeeBusy = [...agents.values()].some((a) => a.slot === 3 && !a.path.length);
  for (const [id, a] of agents) if (a.gone) agents.delete(id);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1a24';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(S, 0, 0, S, OX, OY);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, LW, WORLD_H);
  ctx.clip();

  drawBackground(nowMs, coffeeBusy);
  drawCouchBack();

  const awakeDesk = new Set();
  for (const a of agents.values()) if (a.state === 'working' && !a.leaving) awakeDesk.add(a.desk);

  // people sorted by depth, then furniture that sits in front of them
  const drawables = [...agents.values()].map((a) => ({
    y: a.y,
    fn: () => {
      const slot = (a.dest === 'break' || a.dest === 'coffee') && a.slot >= 0 && !a.walking ? BREAK_SLOTS[a.slot] : null;
      const extras = {
        cheer: a.cheerUntil > now || !!(slot && slot.lift),
        snack: !!(slot && slot.snack),
        book: a.dest === 'library' && !a.walking,
        facepalm: a.facepalmUntil > now,
        cup: !!(slot && slot.cup),
        cue: slot && slot.pool ? { dir: slot.pool, shooter: a.poolShooter } : null,
      };
      drawPerson(a.x, a.y, a.look, poseOf(a), nowMs, extras);
    },
  }));
  drawables.push({ y: pet.y, fn: () => lifeDrawPet(nowMs) });
  for (const st of staff) drawables.push({ y: st.y, fn: () => lifeDrawStaff(st, nowMs) });
  drawables.push({ y: POOL.y + 33, fn: () => drawPoolTable(nowMs, players.length >= 2) });
  drawables.push({ y: MEET.y + MEET.h, fn: () => placesDrawMeetingTable(nowMs) });
  drawables.sort((p, q) => p.y - q.y).forEach((d) => d.fn());
  drawCouchFront();
  for (let i = 0; i < ROOM_COUNT * DESKS_PER_ROOM; i++) drawDesk(DESKS[i], awakeDesk.has(i), nowMs);
  drawVacantShade();
  lifeDrawSeason(nowMs);
  lifeDrawPaper(now);
  lifeShade();
  lifeGlow(awakeDesk, nowMs);
  lifeDrawParticles();

  ctx.restore();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawOverlays(now, nowMs);
  requestAnimationFrame(frame);
}
// life.js and ui.js load after this file; a frame that fires before they do throws and the loop never re-arms.
if (document.readyState === 'complete') requestAnimationFrame(frame);
else window.addEventListener('load', () => requestAnimationFrame(frame));

window.office.onSessions((list) => { if (!window.__freeze) applySessions(list); }); // __freeze lets a test drive the agents by hand
window.office.onStats((s) => { dailyStatsData = s; });
