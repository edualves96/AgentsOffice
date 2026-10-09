// Tests for the session reader. They run against a throw-away fake ~/.claude folder, so they do not
// touch real Claude Code data. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-test-'));
process.env.AGENTS_OFFICE_CLAUDE_DIR = root; // must be set before the module is loaded
const sessions = require('../src/sessions');
const pricing = require('../src/pricing');

const SESSIONS = path.join(root, 'sessions');
const PROJECT = path.join(root, 'projects', 'D--DEV-demo');
let counter = 0;

function fresh() {
  fs.rmSync(SESSIONS, { recursive: true, force: true });
  fs.mkdirSync(SESSIONS, { recursive: true });
  fs.mkdirSync(PROJECT, { recursive: true });
  counter++;
  return 'sess-' + counter; // a new id per test, so cached transcript state never leaks between tests
}

function register(id, status, pid = process.pid) {
  fs.writeFileSync(path.join(SESSIONS, `${counter}${pid === process.pid ? '' : 'x'}.json`), JSON.stringify({
    pid, sessionId: id, cwd: 'D:\\DEV\\demo', status, updatedAt: Date.now(),
  }));
}

const iso = (ms = 0) => new Date(Date.now() - ms).toISOString();

function userPrompt(text = 'do the thing', ago = 0) {
  return { type: 'user', timestamp: iso(ago), message: { role: 'user', content: text } };
}

function assistant(blocks, { id = 'msg_' + Math.random(), usage, model = 'claude-sonnet-5-5', ago = 0 } = {}) {
  return { type: 'assistant', timestamp: iso(ago), message: { id, model, role: 'assistant', content: blocks, usage } };
}

const toolUse = (name, input, id = 'tu_' + Math.random()) => ({ type: 'tool_use', id, name, input });

function writeTranscript(id, entries, ageMs = 0) {
  const file = path.join(PROJECT, id + '.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(file, t, t);
  }
  return file;
}

const find = (list, id) => list.find((s) => s.id === id);

test('a busy terminal with a fresh tool call is working and shows the command', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([toolUse('Bash', { command: 'npm test' })])]);
  register(id, 'busy');
  const s = find(sessions.scan(), id);
  assert.equal(s.state, 'working');
  assert.equal(s.activity, '$ npm test');
  assert.equal(s.project, 'demo');
});

test('a tool call nobody has answered for a while means the terminal is waiting for you', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([toolUse('Edit', { file_path: 'C:\\x\\App.tsx' })])], 60000);
  register(id, 'busy');
  const s = find(sessions.scan(), id);
  assert.equal(s.state, 'waiting');
  assert.equal(s.activity, 'editing App.tsx');
});

test('an idle registry status wins over the transcript', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([toolUse('Bash', { command: 'ls' })])]);
  register(id, 'idle');
  assert.equal(find(sessions.scan(), id).state, 'idle');
});

test('terminals whose process is gone are ignored', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt()]);
  register(id, 'busy', 2147483646); // no such process
  assert.equal(find(sessions.scan(), id), undefined);
});

test('a terminal without a transcript yet still shows up', () => {
  const id = fresh();
  register(id, 'busy');
  const s = find(sessions.scan(), id);
  assert.ok(s);
  assert.equal(s.state, 'working');
});

test('tokens are counted once per message even when a message is logged twice', () => {
  const id = fresh();
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 };
  writeTranscript(id, [
    userPrompt(),
    assistant([{ type: 'text', text: 'a' }], { id: 'm1', usage }),
    assistant([toolUse('Read', { file_path: 'a.txt' })], { id: 'm1', usage }),
    assistant([{ type: 'text', text: 'b' }], { id: 'm2', usage: { ...usage, input_tokens: 20 } }),
  ]);
  register(id, 'busy');
  const s = find(sessions.scan(), id);
  assert.equal(s.tokens.input, 30);
  assert.equal(s.tokens.output, 200);
  assert.equal(s.tokens.cacheRead, 2000);
  assert.equal(s.ctx, 20 + 1000 + 50, 'context is the size of the last request');
});

test('cost is estimated from the model price and flagged when a model has no price', () => {
  const id = fresh();
  const usage = { input_tokens: 1000000, output_tokens: 1000000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  writeTranscript(id, [
    userPrompt(),
    assistant([{ type: 'text', text: 'x' }], { id: 'a', usage, model: 'claude-sonnet-5-5' }), // $2 + $10
    assistant([{ type: 'text', text: 'y' }], { id: 'b', usage, model: 'some-unknown-model' }),
  ]);
  register(id, 'idle');
  const s = find(sessions.scan(), id);
  assert.ok(Math.abs(s.cost - 12) < 1e-9);
  assert.equal(s.costPartial, true);
});

test('the context window comes from the model, and grows when a session exceeds it', () => {
  assert.equal(pricing.windowFor('claude-sonnet-5-5', 100), 1e6);
  assert.equal(pricing.windowFor('claude-haiku-4-5-20251001', 100), 200000);
  assert.equal(pricing.windowFor('claude-haiku-4-5', 300000), 1e6);
  assert.equal(pricing.windowFor('totally-new-model', 100), 200000);
});

test('pricing: cache reads, cache writes, date suffixes and the Haiku 5.5 long-prompt tier', () => {
  const none = { input: 0, output: 0, cacheRead: 0, cache5m: 0, cache1h: 0 };
  assert.equal(pricing.costOf('nope', none), null);
  // Opus 5.5 lists its own cache-read price ($0.20 / MTok)
  assert.ok(Math.abs(pricing.costOf('claude-opus-5-5', { ...none, cacheRead: 1e6 }) - 0.2) < 1e-9);
  // 5-minute cache write is 1.25x the input price
  assert.ok(Math.abs(pricing.costOf('claude-haiku-4-5-20251001', { ...none, cache5m: 1e6 }) - 1.25) < 1e-9);
  // Haiku 5.5 switches to the higher tier above 100K prompt tokens
  assert.ok(Math.abs(pricing.costOf('claude-haiku-5-5', { ...none, input: 50000 }) - 0.005) < 1e-9);
  assert.ok(Math.abs(pricing.costOf('claude-haiku-5-5', { ...none, input: 200000 }) - 0.1) < 1e-9);
});

test('TodoWrite lists become the todo board', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([toolUse('TodoWrite', { todos: [
    { content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }, { content: 'three', status: 'pending' },
  ] })])]);
  register(id, 'busy');
  const todos = find(sessions.scan(), id).todos;
  assert.deepEqual(todos.map((t) => t.status), ['completed', 'in_progress', 'pending']);
});

test('TaskCreate / TaskUpdate build the todo board too', () => {
  const id = fresh();
  writeTranscript(id, [
    userPrompt(),
    assistant([toolUse('TaskCreate', { subject: 'write code' })]),
    assistant([toolUse('TaskCreate', { subject: 'write tests' })]),
    assistant([toolUse('TaskCreate', { subject: 'drop me' })]),
    assistant([toolUse('TaskUpdate', { taskId: '1', status: 'completed' })]),
    assistant([toolUse('TaskUpdate', { taskId: '2', status: 'in_progress' })]),
    assistant([toolUse('TaskUpdate', { taskId: '3', status: 'deleted' })]),
  ]);
  register(id, 'busy');
  const todos = find(sessions.scan(), id).todos;
  assert.deepEqual(todos, [{ text: 'write code', status: 'completed' }, { text: 'write tests', status: 'in_progress' }]);
});

test('a half-written last line is picked up once it is complete', () => {
  const id = fresh();
  const file = writeTranscript(id, [userPrompt()]);
  register(id, 'busy');
  const line = JSON.stringify(assistant([toolUse('Grep', { pattern: 'needle' })]));
  fs.appendFileSync(file, line.slice(0, 40)); // cut in the middle of the JSON
  assert.equal(find(sessions.scan(), id).activity, 'thinking...');
  fs.appendFileSync(file, line.slice(40) + '\n');
  assert.equal(find(sessions.scan(), id).activity, 'searching needle');
});

test('recent actions list the latest tool calls first', () => {
  const id = fresh();
  writeTranscript(id, [
    userPrompt(),
    assistant([toolUse('Read', { file_path: 'a.js' })]),
    assistant([toolUse('Edit', { file_path: 'b.js' })]),
  ]);
  register(id, 'busy');
  assert.deepEqual(find(sessions.scan(), id).recent.map((r) => r.text), ['editing b.js', 'reading a.js']);
});

test('subagents show up while they work, and a parent waiting on them counts as working', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([toolUse('Agent', { prompt: 'go' })])], 60000); // would be "waiting"
  const subDir = path.join(PROJECT, id, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const subFile = path.join(subDir, 'agent-abc.jsonl');
  fs.writeFileSync(subFile, [userPrompt('sub task'), assistant([toolUse('Grep', { pattern: 'x' })])].map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(subDir, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look around' }));
  register(id, 'busy');
  const list = sessions.scan();
  const parent = find(list, id);
  const sub = list.find((s) => s.parent === id);
  assert.equal(parent.state, 'working');
  assert.equal(parent.activity, 'waiting for subagents');
  assert.equal(sub.project, 'Explore');
  assert.equal(sub.state, 'working');
});

test('a finished subagent leaves after a short grace period', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt()]);
  const subDir = path.join(PROJECT, id, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const subFile = path.join(subDir, 'agent-done.jsonl');
  fs.writeFileSync(subFile, [userPrompt('t'), assistant([{ type: 'text', text: 'final answer' }])].map((e) => JSON.stringify(e)).join('\n') + '\n');
  register(id, 'busy');
  assert.equal(sessions.scan().filter((s) => s.parent === id).length, 1, 'still shown right after finishing');
  const old = new Date(Date.now() - 30000);
  fs.utimesSync(subFile, old, old);
  assert.equal(sessions.scan().filter((s) => s.parent === id).length, 0, 'gone after the grace period');
});

test('hook events give instant state and win over older file data', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([{ type: 'text', text: 'done' }])], 5000);
  register(id, 'idle');
  assert.equal(find(sessions.scan(), id).state, 'idle');

  assert.ok(sessions.applyHook({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'make build' } }));
  let s = find(sessions.scan(), id);
  assert.equal(s.state, 'working');
  assert.equal(s.activity, '$ make build');

  sessions.applyHook({ session_id: id, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  s = find(sessions.scan(), id);
  assert.equal(s.state, 'waiting');
  assert.match(s.activity, /permission/);

  sessions.applyHook({ session_id: id, hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  assert.equal(find(sessions.scan(), id).state, 'working');

  sessions.applyHook({ session_id: id, hook_event_name: 'Stop' });
  assert.equal(find(sessions.scan(), id).state, 'idle');
});

test('hook events from subagents and unknown events are ignored', () => {
  const id = fresh();
  assert.equal(sessions.applyHook({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_id: 'sub1' }), false);
  assert.equal(sessions.applyHook({ session_id: id, hook_event_name: 'SomethingNew' }), false);
  assert.equal(sessions.applyHook(null), false);
});

test('a hook event older than the transcript does not override it', () => {
  const id = fresh();
  sessions.applyHook({ session_id: id, hook_event_name: 'Stop' }); // idle, "now"
  writeTranscript(id, [userPrompt(), assistant([toolUse('Bash', { command: 'later' })])]);
  const future = new Date(Date.now() + 10000); // the files moved on after the hook
  fs.utimesSync(path.join(PROJECT, id + '.jsonl'), future, future);
  register(id, 'busy');
  fs.writeFileSync(path.join(SESSIONS, `${counter}.json`), JSON.stringify({ pid: process.pid, sessionId: id, cwd: 'D:\\DEV\\demo', status: 'busy', updatedAt: Date.now() + 10000 }));
  assert.equal(find(sessions.scan(), id).state, 'working');
});

function toolResult(toolUseId, text, isError = false, ago = 0) {
  return { type: 'user', timestamp: iso(ago), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }], is_error: isError }] } };
}

test('a failing test run is reported, and a later passing run clears it', () => {
  const id = fresh();
  writeTranscript(id, [
    userPrompt(),
    assistant([toolUse('Bash', { command: 'npm test' }, 'run1')]),
    toolResult('run1', 'Tests: 3 failed, 12 passed, 15 total'),
  ]);
  register(id, 'busy');
  assert.ok(find(sessions.scan(), id).testFailTs > 0, 'failure detected');

  fs.appendFileSync(path.join(PROJECT, id + '.jsonl'), [
    assistant([toolUse('Bash', { command: 'npx vitest run' }, 'run2')]),
    toolResult('run2', 'Test Files  4 passed (4)\n     Tests  15 passed (15)'),
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  assert.equal(find(sessions.scan(), id).testFailTs, 0, 'the latest run passed');
});

test('only test commands count, and a non-zero exit code is a failure', () => {
  const id = fresh();
  writeTranscript(id, [
    userPrompt(),
    assistant([toolUse('Bash', { command: 'ls -la' }, 'ls1')]),
    toolResult('ls1', '2 failed to parse FAIL', true), // not a test command: ignored
    assistant([toolUse('Bash', { command: 'pytest' }, 'py1')]),
    toolResult('py1', 'Exit code 1\nsomething broke', true),
  ]);
  register(id, 'busy');
  assert.ok(find(sessions.scan(), id).testFailTs > 0);

  const id2 = fresh();
  writeTranscript(id2, [
    userPrompt(),
    assistant([toolUse('Bash', { command: 'ls -la' }, 'ls2')]),
    toolResult('ls2', 'FAIL everywhere', true),
  ]);
  register(id2, 'busy');
  assert.equal(find(sessions.scan(), id2).testFailTs, 0);
});

test('a build or test command is "building" until its result arrives', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([toolUse('Bash', { command: 'npm run build' }, 'b1')])]);
  register(id, 'busy');
  assert.equal(find(sessions.scan(), id).building, true, 'running');

  fs.appendFileSync(path.join(PROJECT, id + '.jsonl'), JSON.stringify(toolResult('b1', 'done')) + '\n');
  assert.equal(find(sessions.scan(), id).building, false, 'finished');
});

test('a command started in the background keeps the servers busy after its first result', () => {
  const id = fresh();
  writeTranscript(id, [
    userPrompt(),
    assistant([toolUse('Bash', { command: 'sleep 30', run_in_background: true }, 'bg1')]),
    toolResult('bg1', 'Command running in background'),
  ]);
  register(id, 'busy');
  assert.equal(find(sessions.scan(), id).building, true);
});

test('plain shell commands are not builds', () => {
  const id = fresh();
  writeTranscript(id, [userPrompt(), assistant([toolUse('Bash', { command: 'ls -la' }, 'ls9')])]);
  register(id, 'busy');
  assert.equal(find(sessions.scan(), id).building, false);
});

test('reading many files or browsing the web sends an agent to the library', () => {
  const id = fresh();
  writeTranscript(id, [
    userPrompt(),
    ...['a.js', 'b.js', 'c.js', 'd.js'].map((f) => assistant([toolUse('Read', { file_path: '/x/' + f })])),
  ]);
  register(id, 'busy');
  assert.equal(find(sessions.scan(), id).research, true, 'four reads in a row');

  const id2 = fresh();
  writeTranscript(id2, [userPrompt(), assistant([toolUse('Read', { file_path: '/x/a.js' })]), assistant([toolUse('Edit', { file_path: '/x/a.js' })])]);
  register(id2, 'busy');
  assert.equal(find(sessions.scan(), id2).research, false, 'a single read is not research');

  const id3 = fresh();
  writeTranscript(id3, [userPrompt(), assistant([toolUse('WebSearch', { query: 'electron occlusion' })])]);
  register(id3, 'busy');
  assert.equal(find(sessions.scan(), id3).research, true, 'a web search counts at once');
});

test('research ends when the reading stops being recent', () => {
  const id = fresh();
  writeTranscript(id, ['a', 'b', 'c', 'd'].map((f) => assistant([toolUse('Read', { file_path: '/x/' + f })], { ago: 5 * 60 * 1000 })));
  register(id, 'busy');
  assert.equal(find(sessions.scan(), id).research, false);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
