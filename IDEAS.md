# Agents Office: ideas

Rough effort: **S** = an hour or less, **M** = a few hours, **L** = a day or more.
Implemented ideas are removed from this file once they are done.

## App and platform

- **Tray icon and background mode (M).** Keep the app in the system tray, show the number of agents on the icon, and open the window on click. This avoids having a window open all the time.
- **Always-on-top mini mode (M).** A small borderless window that shows only the office, so it can sit in a corner of the screen.
- **Settings screen (M).** Choose how long an idle terminal stays visible, the maximum number of rooms, sound on or off, and start with Windows.
- **Sound effects (S).** Soft keyboard clicks while typing, a ping when an agent needs you, a chime when a task finishes. Off by default.
- **Installer and auto-update (M).** An installer instead of a loose folder, so moving the project doesn't break the Claude hook path.
- **Real sprite sheet (L).** Replace the code-drawn people with hand-drawn pixel art with more animations, outfits and hairstyles.
- **Custom avatars (S).** Let the user pick the look and name for a project folder, so the same project always has the same person.
- **Support more tools (L).** Show Codex, Gemini CLI or other terminal agents next to Claude Code if they write readable logs.
- **Screenshot and GIF export (M).** A button that saves the current office as an image to share.

## Suggested next two

1. Tray icon and background mode, so the app is pleasant to leave running all day.
2. Installer, so the exe, the hooks and the settings entry stop depending on this folder's path.
