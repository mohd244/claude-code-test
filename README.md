# claude-code-test

## Morning Drive — once-a-day car launcher

A tiny static page (`index.html` + `app.js`) for car head units that can "open a URL when a
Bluetooth device connects". Every connection opens the page, but the page only offers the
music link **once per day** — the rest of the day's connections show a quiet "already played"
screen and do nothing.

### Files

| File | What it does |
| --- | --- |
| `index.html` | The screen: status pill, one big tap target, settings panel. No external assets. |
| `app.js` | The logic: day boundary, `localStorage` lock, countdown, redirect. |

### How the daily lock works

- On load, the page computes today's key (`YYYY-MM-DD`) using a configurable day boundary,
  default **04:00 local time** — so a 1 a.m. drive still counts as the previous day.
- If `localStorage` already holds that key, the page shows "Already played today" plus the
  time it reset. A "Play anyway" button is still there for a manual override.
- If it doesn't, the page shows **Play now**. Tapping it records the day and redirects.
- The lock is written *before* the redirect, so it holds even if the music app takes over
  immediately.

State is per browser and per device — whichever browser the car trigger opens is the one that
remembers. Clearing site data resets it.

### Setup

1. Enable GitHub Pages for this repo (Settings → Pages → Deploy from branch → `main` / root).
2. Point the car's Bluetooth-connect action at `https://<user>.github.io/<repo>/`.
3. Open the page once on the phone, expand **Settings**, and set the link and preferences.

### Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Link to open | the YouTube Music link | Any URL works — playlist, radio, podcast. |
| New day starts at | `04:00` | The boundary between "days". |
| Auto-launch | off | On = redirect by itself after a countdown. |
| Countdown | `5` s | `0` with auto-launch = redirect instantly. |

Edit the `DEFAULTS` object at the top of `app.js` to change what a fresh browser starts with.

**Why auto-launch is off by default:** phone browsers block audio that starts without a tap,
so an automatic redirect can land on YouTube Music paused. Tapping the button carries the
gesture through the redirect and plays reliably. Turn auto-launch on if your setup handles it.

### Test overrides

Append to the URL: `?force=1` (ignore the daily lock), `?reset=1` (clear it), `?auto=1` /
`?auto=0` (toggle auto-launch for one load), `?hour=6`, `?delay=3`, `?url=<encoded url>`.
