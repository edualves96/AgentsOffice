# Agents Office

A pixel-art office that shows your [Claude Code](https://claude.com/claude-code) sessions as little people.

Every live Claude Code terminal becomes a person in the office. You can tell at a glance who is working, who is thinking and who is waiting for you, without switching windows.

## What it shows

- **One person per terminal.** Each person is labelled with the project folder and its current activity (the tool being run, a permission prompt, a question for you).
- **Subagents.** Subagents spawned by a terminal appear as extra people next to their parent.
- **Idle agents wander.** They go to the kitchen and vending machine, the library, the meeting table, the gym, the server racks and reception.
- **Office staff.** Two cleaners mop the rooms and the break area all day, and two more join them when no terminal is open. Every hour a delivery guy comes in to swap the water cooler's gallon.
- **Usage details.** Token counts, an estimated cost, a context-window gauge and the session's todo list. Cost is only shown for models that have a known price.
- **Notifications.** A Windows toast and a taskbar flash when a terminal starts waiting for you. Notifications can be turned off in the app.

## How it works

Agents Office is an Electron app that only reads local files and listens on localhost:

- `~/.claude/sessions/<pid>.json` tells it which terminals are alive and whether they are busy or idle.
- `~/.claude/projects/*/<id>.jsonl` transcripts give the current tool, tokens, context use and todos. Subagent transcripts are read the same way.
- **Optional Claude Code hooks** (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `Notification`, `SessionEnd`) send events to the app on `127.0.0.1:47831`. This makes state changes instant instead of inferred from transcripts. The hook never blocks Claude Code: if the app isn't running, it exits silently.

Nothing leaves your machine.

## Getting started

Requires [Node.js](https://nodejs.org) and Windows (the build and notifications target Windows).

```sh
npm install
npm start          # run the app
npm run demo       # run with fake agents, no Claude Code needed
npm test           # run the tests
npm run dist       # build an unpacked Windows app into dist/
```

### Enabling the hooks

```sh
npm run hooks                          # add the hooks to ~/.claude/settings.json
node scripts/install-hooks.js --remove # remove them again
```

The hook entries contain the absolute path to `src/hook.js`, so run the command again if you move the project.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.js` | Electron main process, hook server, notifications |
| `src/sessions.js` | Reads Claude Code state from disk and builds the agent list |
| `src/pricing.js` | Model prices and context windows |
| `src/hook.js` | Hook forwarder called by Claude Code |
| `src/renderer.js`, `src/places.js`, `src/life.js`, `src/ui.js` | Canvas drawing, office rooms, agent behaviour and UI |
| `src/demo.js` | Fake agents for `--demo` mode |
| `scripts/install-hooks.js` | Installs or removes the hooks |
| `test/` | Tests (`node --test`) |

See [IDEAS.md](IDEAS.md) for planned features.
