// Reads Claude Code state from disk and turns every live terminal into an "agent":
//   ~/.claude/sessions/<pid>.json        -> which terminals are alive and busy/idle
//   ~/.claude/projects/*/<id>.jsonl      -> transcript: current tool, tokens, context, todos
//   .../<id>/subagents/agent-*.jsonl     -> subagent transcripts
const fs = require('fs');
const os = require('os');
const path = require('path');

const pricing = require('./pricing');

const CLAUDE_DIR = process.env.AGENTS_OFFICE_CLAUDE_DIR || path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const VISIBLE_MS = 30 * 60 * 1000; // fallback mode only: hide transcripts untouched for longer
const WORKING_FRESH_MS = 20 * 1000; // tool call newer than this = running, older = waiting on you
const THINKING_MS = 90 * 1000;
const TAIL_BYTES = 128 * 1024;
const HEAD_BYTES = 16 * 1024;
const SUB_STALE_MS = 120 * 1000;
const SUB_DONE_GRACE_MS = 6 * 1000;

function readRange(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift(); // probably a partial line
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* partial / garbage */ }
  }
  return out;
}

function describeTool(block) {
  const i = block.input || {};
  const base = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
  switch (block.name) {
    case 'Bash':
    case 'PowerShell': return `$ ${String(i.command || '').split('\n')[0].slice(0, 120)}`;
    case 'Read': return `reading ${base(i.file_path)}`;
    case 'Edit':
    case 'Write': return `editing ${base(i.file_path)}`;
    case 'Grep':
    case 'Glob': return `searching ${String(i.pattern || '').slice(0, 60)}`;
    case 'Agent':
    case 'Task': return 'delegating to subagent';
    case 'WebSearch':
    case 'WebFetch': return 'browsing the web';
    case 'AskUserQuestion': return 'asking you a question';
    case 'TodoWrite': return 'updating the todo list';
    default: return block.name.replace(/^mcp__/, '').slice(0, 60);
  }
}

// ---------- incremental transcript tracker ----------
// Each transcript is parsed once; afterwards only the bytes appended since the last call are read.
const trackers = new Map(); // file -> state

function dayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// A test run is a shell command that looks like one; its result decides pass or fail.
const TEST_CMD = /\b(test|tests|jest|vitest|pytest|mocha|rspec|phpunit|go test|cargo test|dotnet test|npm t)\b/i;
// Shell commands that build, install, serve or deploy: the server room lights up while one is running.
const RUN_CMD = /\b(build|compile|tsc|webpack|vite|rollup|esbuild|make|cmake|msbuild|gradle|mvn|docker|electron-builder|deploy|publish|migrate|npm (run|install|ci|start)|npx|dotnet (run|watch|publish)|cargo run|pip install|yarn|pnpm)\b/i;
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const BG_WINDOW_MS = 2 * 60 * 1000; // a command started in the background keeps the servers busy this long
const PENDING_MAX_MS = 10 * 60 * 1000; // ignore a shell command that never got an answer for this long

// What kind of work a tool call is: 'run' (a shell command that builds, tests or serves), 'read' (looking
// through files), 'web' (browsing) or '' (anything else).
function toolKind(b) {
  const i = b.input || {};
  if (b.name === 'Bash' || b.name === 'PowerShell') {
    const cmd = String(i.command || '');
    return i.run_in_background || RUN_CMD.test(cmd) || TEST_CMD.test(cmd) ? 'run' : '';
  }
  if (READ_TOOLS.has(b.name)) return 'read';
  if (b.name === 'WebSearch' || b.name === 'WebFetch' || /^mcp__(firecrawl|playwright)/.test(b.name)) return 'web';
  return '';
}

const FAIL_TEXT =/(\b[1-9]\d*\s+(failed|failing)\b|✖|\bFAIL\b|AssertionError|Tests?:\s+.*\b[1-9]\d*\s+failed)/;

function resultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && x.text) || '').join('\n');
  return '';
}

function newState() {
  return {
    offset: 0,
    usageById: new Map(),
    toolIds: new Set(),
    totals: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    byDay: {},
    ctx: 0,
    model: '',
    testRuns: new Set(),
    testFailTs: 0,
    testPassTs: 0,
    kinds: [], // { ts, kind } of the latest tool calls
    pendingRun: new Map(), // tool id -> ts of shell commands still running
    bgTs: 0,
    todos: null,
    tasks: [],
    todoKind: '',
    cost: 0,
    unpriced: 0,
    recent: [],
    firstTs: 0,
    promptTs: 0,
  };
}

function dayOf(st, key) {
  return st.byDay[key] || (st.byDay[key] = { tokens: 0, tools: 0, cost: 0, active: false });
}

function ingest(st, e) {
  const msg = e.message;
  const ts = Date.parse(e.timestamp) || 0;
  if (ts && !st.firstTs) st.firstTs = ts;
  if (!msg || (e.type !== 'user' && e.type !== 'assistant')) return;
  const dk = dayKey(ts || Date.now());
  dayOf(st, dk).active = true;

  if (e.type === 'user') {
    const c = msg.content;
    if (Array.isArray(c) && st.testRuns.size) {
      for (const b of c) {
        if (b.type !== 'tool_result' || !st.testRuns.has(b.tool_use_id)) continue;
        st.testRuns.delete(b.tool_use_id);
        const text = resultText(b).slice(0, 20000);
        const failed = b.is_error === true || /\bexit code [1-9]/i.test(text) || FAIL_TEXT.test(text);
        if (failed) st.testFailTs = ts; else st.testPassTs = ts;
      }
    }
    if (Array.isArray(c) && st.pendingRun.size) {
      for (const b of c) if (b.type === 'tool_result') st.pendingRun.delete(b.tool_use_id);
    }
    const isPrompt = typeof c === 'string' || (Array.isArray(c) && c.some((b) => b.type === 'text') && !c.some((b) => b.type === 'tool_result'));
    if (isPrompt && ts) st.promptTs = ts;
    return;
  }

  const u = msg.usage;
  if (u && msg.id) {
    const cc = u.cache_creation || {};
    const cacheCreate = u.cache_creation_input_tokens || 0;
    const cache1h = cc.ephemeral_1h_input_tokens || 0;
    const cur = {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheCreate,
      dk,
      cost: null,
    };
    cur.cost = pricing.costOf(msg.model, {
      input: cur.input,
      output: cur.output,
      cacheRead: cur.cacheRead,
      cache5m: Math.max(0, cacheCreate - cache1h),
      cache1h,
    });
    const prev = st.usageById.get(msg.id);
    if (prev) {
      st.totals.input -= prev.input; st.totals.output -= prev.output;
      st.totals.cacheRead -= prev.cacheRead; st.totals.cacheCreate -= prev.cacheCreate;
      dayOf(st, prev.dk).tokens -= prev.input + prev.output + prev.cacheCreate;
      if (prev.cost === null) st.unpriced--;
      else { st.cost -= prev.cost; dayOf(st, prev.dk).cost -= prev.cost; }
    }
    st.usageById.set(msg.id, cur);
    st.totals.input += cur.input; st.totals.output += cur.output;
    st.totals.cacheRead += cur.cacheRead; st.totals.cacheCreate += cur.cacheCreate;
    dayOf(st, dk).tokens += cur.input + cur.output + cur.cacheCreate;
    if (cur.cost === null) st.unpriced++;
    else { st.cost += cur.cost; dayOf(st, dk).cost += cur.cost; }
    st.ctx = cur.input + cur.cacheRead + cur.cacheCreate;
    if (msg.model) st.model = msg.model;
  }

  const blocks = Array.isArray(msg.content) ? msg.content : [];
  for (const b of blocks) {
    if (b.type !== 'tool_use' || st.toolIds.has(b.id)) continue;
    st.toolIds.add(b.id);
    dayOf(st, dk).tools++;
    st.recent.push({ ts, text: describeTool(b) });
    if ((b.name === 'Bash' || b.name === 'PowerShell') && b.input && TEST_CMD.test(String(b.input.command || ''))) st.testRuns.add(b.id);
    if (st.recent.length > 12) st.recent.shift();
    const kind = toolKind(b);
    st.kinds.push({ ts, kind });
    if (st.kinds.length > 6) st.kinds.shift();
    if (kind === 'run') {
      if (b.input && b.input.run_in_background) st.bgTs = ts;
      else st.pendingRun.set(b.id, ts);
    }
    const input = b.input || {};
    if (b.name === 'TodoWrite' && Array.isArray(input.todos)) {
      st.todos = input.todos.map((t) => ({ text: String(t.content || t.activeForm || ''), status: t.status || 'pending' }));
      st.todoKind = 'todos';
    } else if (b.name === 'TaskCreate') {
      // Task ids are assumed to be sequential per session (1, 2, 3...), in creation order.
      st.tasks.push({ id: String(st.tasks.length + 1), text: String(input.subject || input.activeForm || input.description || ''), status: 'pending' });
      st.todoKind = 'tasks';
    } else if (b.name === 'TaskUpdate' && input.taskId !== undefined) {
      const i = st.tasks.findIndex((t) => t.id === String(input.taskId));
      if (i >= 0) {
        if (input.status === 'deleted') st.tasks.splice(i, 1);
        else {
          if (input.status) st.tasks[i].status = input.status;
          if (input.subject) st.tasks[i].text = String(input.subject);
        }
      }
      st.todoKind = 'tasks';
    }
  }
}

function track(file) {
  let st = trackers.get(file);
  if (!st) { st = newState(); trackers.set(file, st); }
  let size;
  try { size = fs.statSync(file).size; } catch { return st; }
  if (size < st.offset) { st = newState(); trackers.set(file, st); } // file was rewritten
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return st; }
  try {
    while (st.offset < size) {
      const len = Math.min(size - st.offset, 8 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, st.offset);
      if (n <= 0) break;
      const lastNl = buf.lastIndexOf(10, n - 1);
      if (lastNl < 0) {
        if (st.offset + n >= size) break; // a partial last line, wait for the rest
        st.offset += n; // a single line longer than the chunk: skip it
        continue;
      }
      for (const line of buf.toString('utf8', 0, lastNl + 1).split('\n')) {
        if (!line) continue;
        try { ingest(st, JSON.parse(line)); } catch { /* garbage */ }
      }
      st.offset += lastNl + 1;
    }
  } finally {
    fs.closeSync(fd);
  }
  return st;
}

// Reading many files or browsing the web: the agent heads for the library.
function isResearching(st, now) {
  const last = st.kinds[st.kinds.length - 1];
  if (!last || now - last.ts > 45 * 1000) return false;
  if (last.kind === 'web') return true;
  const reads = st.kinds.filter((k) => k.kind === 'read' || k.kind === 'web').length;
  return st.kinds.length >= 4 && reads >= 4;
}

function isBuilding(st, now) {
  if (st.bgTs && now - st.bgTs < BG_WINDOW_MS) return true;
  for (const ts of st.pendingRun.values()) if (now - ts < PENDING_MAX_MS) return true;
  return false;
}

function statsFields(st) {
  const now = Date.now();
  const list = st.todoKind === 'tasks' ? st.tasks : st.todos;
  return {
    tokens: { ...st.totals },
    research: isResearching(st, now),
    building: isBuilding(st, now),
    ctx: st.ctx,
    ctxMax: pricing.windowFor(st.model, st.ctx),
    model: st.model,
    cost: st.cost,
    costPartial: st.unpriced > 0,
    todos: list && list.length ? list.map((t) => ({ text: t.text, status: t.status })) : null,
    recent: st.recent.slice(-8).reverse(),
    firstTs: st.firstTs,
    turnStart: st.promptTs,
    testFailTs: st.testFailTs > st.testPassTs ? st.testFailTs : 0, // the latest test run failed
  };
}

// ---------- one session ----------
function inspect(file, stat, now) {
  const size = stat.size;
  const tailStart = Math.max(0, size - TAIL_BYTES);
  const tail = parseLines(readRange(file, tailStart, size - tailStart), tailStart > 0);
  const head = parseLines(readRange(file, 0, Math.min(size, HEAD_BYTES)), false);

  const title = (head.find((e) => e.type === 'ai-title') || tail.find((e) => e.type === 'ai-title') || {}).aiTitle;
  const cwd = (head.find((e) => e.cwd) || tail.find((e) => e.cwd) || {}).cwd;

  let last = null;
  for (let i = tail.length - 1; i >= 0; i--) {
    const e = tail[i];
    if ((e.type === 'user' || e.type === 'assistant') && e.message) { last = e; break; }
  }

  const age = now - stat.mtimeMs;
  let state = 'idle';
  let activity = '';
  if (last && last.type === 'assistant') {
    const blocks = Array.isArray(last.message.content) ? last.message.content : [];
    const tool = [...blocks].reverse().find((b) => b.type === 'tool_use');
    if (tool) {
      activity = describeTool(tool);
      state = age < WORKING_FRESH_MS ? 'working' : 'waiting';
      if (tool.name === 'AskUserQuestion') state = 'waiting';
    } else if (age < 3000) {
      state = 'working';
      activity = 'typing a reply';
    }
  } else if (last && last.type === 'user' && age < THINKING_MS) {
    state = 'working';
    activity = 'thinking...';
  }

  const id = path.basename(file, '.jsonl');
  const project = cwd ? path.basename(cwd) : path.basename(path.dirname(file));
  return { id, project, title: title || '', state, activity, updated: stat.mtimeMs, ...statsFields(track(file)) };
}

function inspectSubagents(sessionFile, sessionId, now) {
  const dir = path.join(path.dirname(sessionFile), sessionId, 'subagents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const subs = [];
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const stat = fs.statSync(full);
      const age = now - stat.mtimeMs;
      if (age > SUB_STALE_MS) continue;
      const start = Math.max(0, stat.size - 64 * 1024);
      const tail = parseLines(readRange(full, start, stat.size - start), start > 0);
      let last = null;
      for (let i = tail.length - 1; i >= 0; i--) {
        const e = tail[i];
        if ((e.type === 'user' || e.type === 'assistant') && e.message) { last = e; break; }
      }
      let activity = 'thinking...';
      let done = false;
      if (last && last.type === 'assistant') {
        const blocks = Array.isArray(last.message.content) ? last.message.content : [];
        const tool = [...blocks].reverse().find((b) => b.type === 'tool_use');
        if (tool) activity = describeTool(tool);
        else done = true; // final text answer
      }
      if (done && age > SUB_DONE_GRACE_MS) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(full.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* optional */ }
      subs.push({
        id: sessionId + ':' + path.basename(f, '.jsonl'),
        parent: sessionId,
        project: meta.agentType || 'subagent',
        title: meta.description || '',
        state: done ? 'idle' : 'working',
        activity: done ? 'done!' : activity,
        updated: stat.mtimeMs,
        ...statsFields(track(full)),
      });
    } catch { /* vanished */ }
  }
  return subs;
}

// ---------- instant state from Claude Code hooks ----------
// hook.js forwards every hook event to the app, which calls applyHook(). A hook event is newer and more
// precise than anything we can infer from files, so it wins while it is fresher than the files.
const hookState = new Map(); // sessionId -> { state, activity, ts }

function applyHook(p) {
  if (!p || !p.session_id || p.agent_id) return false; // ignore subagent events
  const id = p.session_id;
  const now = Date.now();
  switch (p.hook_event_name) {
    case 'PreToolUse':
      hookState.set(id, {
        state: p.tool_name === 'AskUserQuestion' ? 'waiting' : 'working',
        activity: describeTool({ name: p.tool_name || 'tool', input: p.tool_input || {} }),
        ts: now,
      });
      return true;
    case 'PostToolUse':
    case 'UserPromptSubmit':
      hookState.set(id, { state: 'working', activity: 'thinking...', ts: now });
      return true;
    case 'Stop':
      hookState.set(id, { state: 'idle', activity: '', ts: now });
      return true;
    case 'Notification':
      hookState.set(id, p.notification_type === 'idle_prompt'
        ? { state: 'idle', activity: '', ts: now }
        : { state: 'waiting', activity: String(p.message || 'needs your attention').slice(0, 120), ts: now });
      return true;
    case 'SessionEnd':
      hookState.delete(id);
      return true;
    default:
      return false;
  }
}

function mergeHook(sess, files) {
  const h = hookState.get(sess.id);
  if (!h) return;
  if (h.ts + 1500 < Math.max(sess.updated, files || 0)) return; // the files moved on after the hook
  sess.state = h.state;
  sess.activity = h.activity;
}

// ---------- live terminals ----------
const fileCache = new Map(); // sessionId -> transcript path

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function findTranscript(sessionId, cwd) {
  const cached = fileCache.get(sessionId);
  if (cached && fs.existsSync(cached)) return cached;
  const guess = cwd ? path.join(PROJECTS_DIR, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId + '.jsonl') : null;
  if (guess && fs.existsSync(guess)) { fileCache.set(sessionId, guess); return guess; }
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(PROJECTS_DIR, d.name, sessionId + '.jsonl');
      if (fs.existsSync(p)) { fileCache.set(sessionId, p); return p; }
    }
  } catch { /* no projects dir */ }
  return null;
}

function withSubagents(sess, file, now, result) {
  const subs = file ? inspectSubagents(file, sess.id, now) : [];
  // a session blocked on its subagents is working, not waiting for the user
  if (subs.some((x) => x.state === 'working') && sess.state === 'waiting') {
    sess.state = 'working';
    sess.activity = 'waiting for subagents';
  }
  result.push(sess, ...subs);
}

function scanRegistry() {
  let names = [];
  try { names = fs.readdirSync(SESSIONS_DIR).filter((f) => /^\d+\.json$/.test(f)); } catch { return null; }
  const now = Date.now();
  const result = [];
  for (const n of names) {
    let reg;
    try { reg = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, n), 'utf8')); } catch { continue; }
    if (!reg.sessionId || !isAlive(reg.pid)) continue;
    const file = findTranscript(reg.sessionId, reg.cwd);
    let sess = null;
    if (file) {
      try { sess = inspect(file, fs.statSync(file), now); } catch { sess = null; }
    }
    if (!sess) {
      sess = { id: reg.sessionId, project: reg.cwd ? path.basename(reg.cwd) : 'claude', title: '', state: 'idle', activity: '', updated: reg.updatedAt || now };
    }
    if (reg.cwd) sess.project = path.basename(reg.cwd); // the terminal's real folder
    // the registry knows whether the terminal is busy; the transcript tells us what it is doing
    if (reg.status === 'idle') { sess.state = 'idle'; sess.activity = ''; }
    else if (reg.status === 'busy' && sess.state === 'idle') { sess.state = 'working'; sess.activity = 'thinking...'; }
    sess.updated = Math.max(sess.updated, reg.updatedAt || 0);
    mergeHook(sess, reg.updatedAt);
    withSubagents(sess, file, now, result);
  }
  return result;
}

// Fallback when the registry directory is missing: any transcript touched recently.
function scanByTranscripts() {
  const now = Date.now();
  const result = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return result; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d.name);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > VISIBLE_MS) continue;
        withSubagents(inspect(full, stat, now), full, now, result);
      } catch { /* file vanished or locked */ }
    }
  }
  return result;
}

function scan() {
  return scanRegistry() || scanByTranscripts();
}

// ---------- today's totals for the wall poster ----------
function dailyStats() {
  const key = dayKey(Date.now());
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const out = { sessions: 0, subagents: 0, tools: 0, tokens: 0, cost: 0 };
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d.name);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < midnight.getTime()) continue;
        const day = track(full).byDay[key];
        if (day && day.active) { out.sessions++; out.tools += day.tools; out.tokens += day.tokens; out.cost += day.cost; }
        const subDir = path.join(dir, path.basename(f, '.jsonl'), 'subagents');
        let subs = [];
        try { subs = fs.readdirSync(subDir).filter((s) => s.endsWith('.jsonl')); } catch { /* none */ }
        for (const s of subs) {
          const sp = path.join(subDir, s);
          try {
            if (fs.statSync(sp).mtimeMs < midnight.getTime()) continue;
            const sd = track(sp).byDay[key];
            if (sd && sd.active) { out.subagents++; out.tools += sd.tools; out.tokens += sd.tokens; out.cost += sd.cost; }
          } catch { /* vanished */ }
        }
      } catch { /* vanished */ }
    }
  }
  return out;
}

module.exports = { scan, dailyStats, applyHook, HOOK_PORT: 47831 };
