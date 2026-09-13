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
| Open in app (Android) | on | Deep-links into YouTube/YouTube Music instead of the browser. |

Edit the `DEFAULTS` object at the top of `app.js` to change what a fresh browser starts with.

**Why auto-launch is off by default:** phone browsers block audio that starts without a tap,
so an automatic redirect can land on YouTube Music paused. Tapping the button carries the
gesture through the redirect and plays reliably. Turn auto-launch on if your setup handles it.

### Opening the app instead of the website (Android)

A plain `https://music.youtube.com/...` link, opened by something other than a real finger-tap
(Samsung Routines, Tasker, etc.), often lands in the browser instead of the app — Android only
hands the link to the app when it trusts the gesture that opened it, and an automation-triggered
page load doesn't count.

To force it, the page rewrites recognized YouTube links (`music.youtube.com`, `youtube.com`,
`youtu.be`) into an `intent://` URL that names the YouTube/YouTube Music package directly, with
the plain link as a fallback if the app isn't installed. This is on by default and only applies
on Android; toggle it off in Settings (or `?app=0`) if you ever want the browser instead.

**Limits:** this only works in Chromium-based browsers — Chrome or Samsung Internet. If the
Bluetooth trigger opens the page inside some other in-app WebView, `intent://` won't resolve and
it'll fall back to the plain URL. Other link types (Spotify, a podcast host, etc.) aren't mapped
to a package, so they always open as a normal link — that's expected, not a bug.

### If nothing happens at all when the car connects (Samsung Routines)

This is almost always Android's **background activity start restriction**, not this page. Since
Android 10, the OS blocks apps — including Routines — from popping open a browser UI while the
screen is off or the phone is locked, unless the triggering app has a specific exemption. Samsung
Routines is a known offender here: the "Open link" / "Open app" action can silently no-op with the
screen off, even though the routine itself ran.

Things to check, roughly in order of how often they're the actual cause:

1. **Battery optimization on the Routines/Bixby engine.** Settings → Apps → find *Routines* (or
   *Bixby Routines* / *Modes and Routines*) → Battery → set to **Unrestricted**. If it's
   "Optimized" or "Restricted", Android can kill it before the action fires.
2. **Add a "Turn on screen" action before "Open link"**, if your One UI version offers it (Routine
   → Add action → Device settings → Turn on screen). Many reports say the open action only works
   reliably once the screen is already on.
3. **Confirm the Bluetooth condition is the exact car device**, not "any Bluetooth device" — pick
   it from the paired-devices list when adding the condition, and re-pick it if you ever unpaired
   and re-paired the car.
4. **Check the routine is set to run every time, not once.** Routines conditions can be
   configured to trigger only the first time they're met; if it already fired once historically,
   it may not fire again until the condition toggles off and on.
5. **Test with the phone unlocked and the screen on first.** If the routine works fine unlocked
   but not locked/screen-off, that confirms it's the background-start restriction above, not a
   problem with the link, the condition, or this page.
6. **Auto Blocker / "More security settings"** on newer One UI can further restrict background
   app launches — check there isn't an added restriction on the Routines app specifically.

None of this can be fixed from the web page itself — it's the OS deciding whether to let the
automation draw a UI at all, before the browser (and this page) ever gets a chance to run.

### Diagnosing what actually happened

The Settings panel shows **Recent page loads** — a timestamped log of every time this page has
opened, kept in `localStorage` independent of the daily lock. It's the way to tell the two
failure modes apart from the driver's seat:

- **No new entry appears** → the phone never opened the browser at all. The problem is upstream
  of this page — see the Routines checklist above.
- **A new entry appears, but the redirect didn't visibly do anything** → the page loaded and
  ran; the problem is the redirect or the target app, not the trigger. Check whether "Open in
  app" is fighting with an embedded WebView (see above), or manually tap **Play now** to see the
  actual error/fallback link.

### Test overrides

Append to the URL: `?force=1` (ignore the daily lock), `?reset=1` (clear it), `?auto=1` /
`?auto=0` (toggle auto-launch for one load), `?app=1` / `?app=0` (toggle the Android app deep
link), `?hour=6`, `?delay=3`, `?url=<encoded url>`.
