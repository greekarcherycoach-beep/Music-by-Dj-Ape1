# Dj Ape1 — Windows 10/11 desktop app

Builds two files into `dist`: **DjApe1-Setup-2.1.0.exe** (installer) and **DjApe1-Portable-2.1.0.exe** (no install; data in `DjApe1-data` next to the exe).

## What's inside
- Native folders: no permission prompts, fast scanning, tags and durations read by the system, new files detected automatically.
- Library on disk (`library\library.json`) with atomic writes and automatic backups (last 5); a damaged file falls back to the newest healthy backup. Restore: Manage → Data → "Restore…".
- Windows integration: media keys, taskbar buttons, tray icon, close-to-tray, start with Windows, "Open with Dj Ape1".
- Full screen: the ⛶ button in the top bar (and F11) for the whole program; separate from the track full screen.
- Audio: sound card selection and Audiophile mode in the 🔊 Audio menu.
- **Smart playlists with rules** (✨ in the sidebar): genre, artist, title, album, year, BPM, key (incl. harmonic match), duration, play count, last played, file; "all" or "any" rule. Edit with ⚙ Rules.
- **🔮 Next-track suggestion** (top bar): scores your library by harmonic key (Camelot), BPM, genre and recent plays; ▶ play, ⏭ queue next, ➕ add. Optional **Auto DJ** when the queue ends. Run key/BPM analysis for better suggestions.
- **⧉ Mini player** (top bar, Ctrl+Shift+M or tray): small always-on-top window.
- **🎨 Themes:** 9 themes (Dark, Light, Midnight, Forest, Crimson, Violet, AMOLED, Sunset, Mint).

## Build
**GitHub:** create a private repository, upload *all* files including the hidden `.github` folder, then Actions -> **Build Windows** -> Run workflow; download the `.exe` files from **Artifacts**. Push a tag like `v2.1.0` to also create a Release.
**Locally:** install Node.js LTS, double-click `build.bat` (or `npm install` + `npm run dist`). `npm start` runs without building, `npm test` runs the tests.

## Troubleshooting
- "Cannot create symbolic link … privilege": Windows blocks symlinks. `build.bat` retries automatically without exe icon editing. For your own icon turn on Developer Mode, delete `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign`, and rebuild.
- `dist\win-unpacked\Dj Ape1.exe` is a working app even if packaging fails.
