// Fake sessions so the office can be previewed without Claude Code running.
const NAMES = ['WEB-GGS', 'VibeWork', 'AgentsOffice', 'api-gateway', 'docs-site', 'mobile-app', 'infra', 'data-pipeline'];
const TOOLS = ['editing App.tsx', '$ npm test', 'reading schema.sql', 'searching useAuth', 'thinking...', 'browsing the web', 'delegating to subagent'];
const SUB_TYPES = ['Explore', 'Plan', 'general-purpose', 'code-reviewer'];
const TODOS = [
  { text: 'Read the existing auth module', status: 'completed' },
  { text: 'Add refresh token endpoint', status: 'in_progress' },
  { text: 'Write unit tests for the endpoint', status: 'pending' },
  { text: 'Update the API docs', status: 'pending' },
];

const rnd = (n) => Math.floor(Math.random() * n);
const extras = (seed) => ({
  tokens: { input: 900 + seed * 40, output: 40000 + seed * 9000, cacheRead: 2000000 + seed * 700000, cacheCreate: 120000 + seed * 30000 },
  ctx: 20000 + seed * 21000,
  ctxMax: 200000,
  model: 'claude-sonnet-5-5',
  todos: seed % 2 ? TODOS : null,
  recent: TOOLS.slice(0, 5).map((t, i) => ({ ts: Date.now() - (i + 1) * 47000, text: t })),
  firstTs: Date.now() - (20 + seed * 7) * 60000,
  turnStart: Date.now() - (30 + seed * 25) * 1000,
});

// What the current activity means for the office: reading or browsing sends an agent to the library,
// a shell command lights up the server racks.
const workFlags = (a) => ({
  research: a.state === 'working' && /^(reading|searching|browsing)/.test(a.activity),
  building: a.state === 'working' && a.activity.startsWith('$'),
});

const agents = NAMES.slice(0, Number(process.env.DEMO_PARENTS || 3)).map((p, i) => ({
  id: 'demo-' + i, project: p, title: 'Demo task ' + (i + 1), state: 'idle', activity: '', updated: Date.now(), ...extras(i + 1),
}));
const subs = [];

function tick() {
  const now = Date.now();
  if (process.env.DEMO_IDLE) {
    for (const a of agents) { a.state = 'idle'; a.activity = ''; a.updated = now; }
    return agents.map((a) => ({ ...a, ...workFlags(a) }));
  }
  for (const a of agents) {
    if (Math.random() < 0.3) {
      const r = Math.random();
      a.state = r < 0.55 ? 'working' : r < 0.7 ? 'waiting' : 'idle';
      a.activity = a.state === 'idle' ? '' : a.state === 'waiting' ? 'asking you a question' : TOOLS[rnd(TOOLS.length)];
      if (a.state === 'working') a.turnStart = now - 150000; // a long job: finishing it earns confetti
      if (a.state === 'working' && Math.random() < 0.15) a.testFailTs = now; // a failed test run: facepalm
    }
    a.ctx = Math.min(190000, a.ctx + rnd(4000));
    a.tokens.output += rnd(900);
    a.updated = now;
  }
  if (process.env.DEMO_MANY_SUBS) {
    // a single terminal with more subagents than its room has desks (tests the "+N more" badge)
    const a = agents[0];
    a.state = 'working';
    a.activity = 'delegating to subagent';
    if (!subs.length) for (let i = 0; i < 6; i++) subs.push({ id: a.id + ':many' + i, parent: a.id, project: SUB_TYPES[i % SUB_TYPES.length], title: '', state: 'working', activity: TOOLS[i % TOOLS.length], updated: now, ...extras(1), todos: null });
    return [...agents.map((x) => ({ ...x })), ...subs.map((s) => ({ ...s, updated: now }))];
  }
  // spawn / retire subagents under working parents
  for (let i = subs.length - 1; i >= 0; i--) if (Math.random() < 0.35) subs.splice(i, 1);
  for (const a of agents) {
    if (a.state === 'working' && subs.length < 4 && Math.random() < 0.5) {
      subs.push({ id: a.id + ':sub' + rnd(1e6), parent: a.id, project: SUB_TYPES[rnd(SUB_TYPES.length)], title: '', state: 'working', activity: TOOLS[rnd(TOOLS.length)], updated: now, ...extras(1), todos: null, ctx: 8000 + rnd(30000) });
    }
  }
  return [...agents.map((a) => ({ ...a, ...workFlags(a) })), ...subs.map((s) => ({ ...s, updated: now, ...workFlags(s) }))];
}

function stats() {
  return { sessions: 12, subagents: 7, tools: 431, tokens: 2140000, cost: 9.4 };
}

module.exports = { tick, stats };
