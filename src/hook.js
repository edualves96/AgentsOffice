// Claude Code hook forwarder: reads the hook event JSON from stdin and hands it to the running Agents
// Office app on localhost. It never fails and never blocks: if the app is not running, it just exits.
const http = require('http');

const PORT = 47831;
let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { body += c; });
process.stdin.on('end', () => {
  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/hook', method: 'POST', timeout: 400, headers: { 'Content-Type': 'application/json' } },
    (res) => { res.resume(); res.on('end', () => process.exit(0)); },
  );
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(body.replace(/^﻿/, '').trim()); // PowerShell pipes add a BOM
});
process.stdin.on('error', () => process.exit(0));
setTimeout(() => process.exit(0), 1500).unref();
