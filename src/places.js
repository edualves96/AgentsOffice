// The extra rooms and corners of the office: reception, server racks, kitchen and vending machine,
// library, meeting table and gym. Loaded after renderer.js and shares its globals (r, hash, agents,
// LIB, MEET, BREAK_SLOTS, ...). Where agents stand lives in renderer.js (BREAK_SLOTS, LIB_SLOTS, MEET_SLOTS).

// ---------- reception (next to the front door) ----------
function drawReception() {
  r(307, 48, 7, 6, '#2b2f3a'); // visitor monitor
  r(308, 49, 5, 4, '#1d2a44');
  r(309, 50, 3, 1, '#5fd96a');
  r(304, 54, 13, 3, '#b8814f');
  r(304, 57, 13, 10, '#7a4f2e');
  r(306, 59, 4, 6, '#5e3d26');
  r(312, 59, 4, 6, '#5e3d26');
  r(315, 52, 2, 2, '#e6c35a'); // service bell
}

// ---------- server racks (hall): blink while a build, test run or server is going ----------
const RACK_COLORS = ['#5fd96a', '#5fd96a', '#f2a93b', '#6ab8ff', '#14161d', '#5fd96a'];

function drawRack(x, y, idx, t, busy) {
  r(x, y, 14, 24, '#14161d');
  r(x + 1, y + 1, 12, 22, '#2b2f3c');
  for (let k = 0; k < 4; k++) {
    const by = y + 3 + k * 5;
    r(x + 2, by, 10, 3, '#14161d');
    for (let j = 0; j < 2; j++) {
      let c;
      if (busy) c = RACK_COLORS[hash(String(idx * 31 + k * 5 + j) + ':' + Math.floor(t / (90 + j * 40))) % RACK_COLORS.length];
      else c = hash(String(idx * 7 + k + j) + ':' + Math.floor(t / 1100)) % 6 === 0 ? '#5fd96a' : '#24462c';
      r(x + 3 + j * 2, by + 1, 1, 1, c);
    }
    r(x + 7, by + 1, 4, 1, '#3b4050'); // drive slot
  }
  r(x + 3, y + 21, 8, 1, '#3b4050'); // vent
  if (busy) r(x - 1, y - 1, 16, 26, 'rgba(95,217,106,0.10)');
}

function drawServerRoom(t) {
  const busy = [...agents.values()].some((a) => !a.leaving && a.building);
  r(302, 142, 16, 88, '#232733');
  for (let i = 0; i < 3; i++) drawRack(303, 146 + i * 28, i, t, busy);
}

// ---------- kitchen: vending machine, fridge, microwave counter ----------
const SNACKS = ['#f2c94c', '#d93a3a', '#4a90d9', '#5fd96a', '#e8832a', '#e07fb0'];

function drawKitchen() {
  // vending machine
  r(474, 36, 14, 38, '#c0392b');
  r(474, 36, 14, 3, '#d9534a');
  r(476, 40, 10, 18, '#1d2a44');
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) r(477 + col * 3, 42 + row * 5, 2, 3, SNACKS[(row * 3 + col) % SNACKS.length]);
  }
  r(476, 60, 10, 5, '#8a8fa0');
  r(477, 61, 2, 1, '#2b2f3a'); r(480, 61, 2, 1, '#2b2f3a'); r(483, 61, 2, 1, '#2b2f3a');
  r(477, 67, 8, 5, '#14110f');
  // fridge
  r(491, 30, 14, 44, '#dfe3ec');
  r(491, 30, 14, 2, '#f4f6fa');
  r(491, 46, 14, 1, '#9aa0b0');
  r(502, 34, 1, 8, '#8a8fa0');
  r(502, 50, 1, 10, '#8a8fa0');
  r(494, 36, 2, 2, '#d93a3a');
  r(497, 52, 2, 2, '#4a90d9');
  r(491, 72, 14, 2, '#9aa0b0');
  // counter with a microwave
  r(507, 46, 13, 28, '#6b4a32');
  r(507, 46, 13, 3, '#8a6244');
  r(509, 51, 4, 21, '#5e3d26'); r(514, 51, 4, 21, '#5e3d26');
  r(509, 37, 10, 9, '#2b2f3a');
  r(510, 38, 6, 7, '#14161d');
  r(517, 39, 1, 5, '#8a8fa0');
}

// ---------- library ----------
const BOOKS = ['#c0392b', '#2f6fd9', '#2a9d55', '#e6a83a', '#9b6ad9', '#d9d9e0', '#3cb8b2', '#e07fb0'];

function drawLibrary() {
  r(LIB.x, LIB.y + LIB.h + 4, LIB.w, 24, '#2f4f6e'); // reading rug
  r(LIB.x, LIB.y + LIB.h + 4, LIB.w, 1, '#4a6f94');
  r(LIB.x, LIB.y + LIB.h + 27, LIB.w, 1, '#4a6f94');
  r(LIB.x, LIB.y, LIB.w, LIB.h, '#5a3d26');
  r(LIB.x + 1, LIB.y + 1, LIB.w - 2, 6, '#7a5232'); // header board (the label is drawn in the overlay)
  r(LIB.x + 2, LIB.y + 8, LIB.w - 4, 18, '#3a2616');
  for (let row = 0; row < 3; row++) {
    const top = LIB.y + 9 + row * 6;
    let x = LIB.x + 3;
    let i = 0;
    while (x < LIB.x + LIB.w - 4) {
      const h = hash('book' + row + ':' + i);
      const w = 2 + (h % 2);
      const bh = 4 + ((h >> 3) % 2);
      r(x, top + 5 - bh, w, bh, BOOKS[(h >> 5) % BOOKS.length]);
      x += w;
      i++;
    }
    r(LIB.x + 2, top + 5, LIB.w - 4, 1, '#7a5232'); // plank
  }
  r(LIB.x + 2, LIB.y + LIB.h - 2, 3, 2, '#3a2616'); // feet
  r(LIB.x + LIB.w - 5, LIB.y + LIB.h - 2, 3, 2, '#3a2616');
}

// ---------- meeting room: carpet and chairs here, the table in depth order ----------
function drawMeetingFloor() {
  r(480, 198, 40, 70, '#2b3a5c');
  r(482, 200, 36, 66, '#34456b');
  r(MEET.x - 5, MEET.y + 3, 4, 9, '#7a3b4f');
  r(MEET.x + MEET.w + 1, MEET.y + 3, 4, 9, '#7a3b4f');
}

function placesDrawMeetingTable(t) {
  const { x, y, w } = MEET;
  r(x + 2, y + 16, 2, 3, '#5e3d26');
  r(x + w - 4, y + 16, 2, 3, '#5e3d26');
  r(x, y, w, 8, '#c9a06a');
  r(x, y, w, 1, '#dcb87f');
  r(x, y + 8, w, 8, '#8a6244');
  r(x + 6, y + 2, 4, 3, '#ffffff'); r(x + 7, y + 3, 2, 1, '#8a8fa0');
  r(x + 16, y + 2, 4, 3, '#ffffff'); r(x + 17, y + 3, 2, 1, '#8a8fa0');
  r(x + 12, y + 3, 2, 2, '#f4f4f4'); // mug
}

// ---------- gym corner ----------
function drawGym(t) {
  const runner = [...agents.values()].some((a) => !a.leaving && a.dest === 'break' && a.slot >= 0 && BREAK_SLOTS[a.slot].run && !a.walking);
  // treadmill
  r(448, 160, 20, 5, '#2b2f3a');
  r(449, 161, 18, 3, '#4b4e5c');
  if (runner) for (let k = 0; k < 5; k++) r(450 + ((k * 4 + Math.floor(t / 60)) % 16), 162, 2, 1, '#6a6f80');
  r(448, 144, 3, 17, '#6a6f80');
  r(445, 140, 10, 6, '#2b2f3a');
  r(446, 141, 8, 4, runner ? '#2b5a96' : '#1d2a44');
  r(451, 150, 9, 1, '#8a8fa0');
  // sign
  r(444, 169, 22, 9, '#5a3d26');
  r(445, 170, 20, 7, '#7a5232');
  // dumbbell rack
  r(460, 184, 10, 14, '#3a3d4a');
  r(461, 190, 8, 1, '#6a6f80');
  for (const dy of [186, 192]) {
    r(461, dy, 2, 2, '#14110f'); r(463, dy + 1, 4, 1, '#8a8fa0'); r(467, dy, 2, 2, '#14110f');
  }
  // yoga mat
  r(442, 222, 28, 12, '#d95763');
  r(442, 222, 28, 1, '#e8808a');
  r(443, 233, 26, 1, '#a8404b');
}

function placesDrawBack(t) {
  drawMeetingFloor();
  drawLibrary();
  drawKitchen();
  drawGym(t);
  drawReception();
  drawServerRoom(t);
}

// ---------- text in screen space ----------
function placesOverlay(now, t, sx, sy, smallFont) {
  ctx.font = smallFont;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // visitor counter above the front door: live terminals
  const live = [...agents.values()].filter((a) => !a.leaving && !a.sub).length;
  const label = '👥 ' + live + ' live';
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = 'rgba(43,34,49,0.9)';
  ctx.fillRect(Math.round(sx(DOOR_X) - w / 2), sy(30), w, 13);
  ctx.fillStyle = '#e6c35a';
  ctx.fillText(label, Math.round(sx(DOOR_X)), sy(30) + 7);

  ctx.fillStyle = '#f0d9a8';
  ctx.fillText('LIBRARY', Math.round(sx(LIB.x + LIB.w / 2)), sy(LIB.y + 4));
  ctx.fillText('GYM', Math.round(sx(455)), sy(173.5));

  const standing = [...agents.values()].some((a) => !a.leaving && a.dest === 'meeting' && !a.walking);
  ctx.fillStyle = '#4a3520';
  ctx.fillText(standing ? 'STAND-UP' : 'MEETING', Math.round(sx(MEET.x + MEET.w / 2)), sy(MEET.y + 4));
}
