// Adds the Agents Office hooks to ~/.claude/settings.json (idempotent) so the app learns about tool calls,
// permission prompts and finished turns instantly instead of inferring them from transcript files.
//   node scripts/install-hooks.js            install
//   node scripts/install-hooks.js --remove   remove again
const fs = require('fs');
const os = require('os');
const path = require('path');

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const hookScript = path.resolve(__dirname, '..', 'src', 'hook.js').replace(/\\/g, '/');
const command = 'node "' + hookScript + '"';
const EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd'];

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
settings.hooks = settings.hooks || {};
const isOurs = (h) => typeof h.command === 'string' && h.command.includes('src/hook.js') && h.command.includes('node ');

if (process.argv.includes('--remove')) {
  for (const ev of EVENTS) {
    const groups = (settings.hooks[ev] || []).filter((g) => !(g.hooks || []).some(isOurs));
    if (groups.length) settings.hooks[ev] = groups; else delete settings.hooks[ev];
  }
} else {
  for (const ev of EVENTS) {
    const groups = settings.hooks[ev] || (settings.hooks[ev] = []);
    if (groups.some((g) => (g.hooks || []).some(isOurs))) continue;
    groups.push({ hooks: [{ type: 'command', command, async: true, timeout: 3 }] });
  }
}

fs.copyFileSync(settingsPath, settingsPath + '.bak-agentsoffice-hooks');
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log((process.argv.includes('--remove') ? 'Removed' : 'Installed') + ' hooks for: ' + EVENTS.join(', '));
