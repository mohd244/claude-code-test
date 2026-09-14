# claude-code-test

## Morning Drive — once-a-day car launcher

A once-a-day music launcher for a car/phone automation that can "open a URL when a Bluetooth
device connects". Two implementations live here — **use the Worker for the automated trigger;
the webpage is the fallback/manual option**:

| | Where | When to use it |
| --- | --- | --- |
| [`worker/`](worker/) | Cloudflare Worker (serverless) | **Point the car automation here.** A single instant HTTP redirect, no page render, no JavaScript — the closest match to a plain direct link, which is what proved reliable even with the phone locked. See [`worker/README.md`](worker/README.md) for setup. |
| `index.html` + `app.js` | Static page (GitHub Pages) | A tap-to-play page for manual use, testing, or a phone shortcut/bookmark. Kept for that purpose — **not** what the automation should target after seeing it fail while locked (see below). |

### Why two implementations

The static page below was the original design, but testing surfaced a real limitation: it
requires Android to launch a full browser, render HTML, and run JavaScript before anything can
redirect — and that whole sequence turned out to be unreliable while the phone was locked. A
plain `https://music.youtube.com/...` link, by contrast, worked instantly even locked, because
that domain is a verified Android App Link — Android hands it straight to the YouTube Music app,
no browser needed at all.

The Worker in `worker/` is the fix: it moves the once-per-day decision server-side, so the
automation gets a single fast HTTP redirect instead of a page to run. See
[`worker/README.md`](worker/README.md) to deploy it — that's now the recommended target for the
car automation. **This isn't a mathematical guarantee** — Android still has to launch some
browser to make that first request, same as before, this just minimizes everything that has to
happen after. If it's still unreliable locked, see "If nothing happens at all" below.

## The static page (`index.html` + `app.js`)

Every load of the page offers the music link **once per day** — later loads the same day show a
quiet "already played" screen and do nothing.

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

To force it, the page rewrites recognized YouTube links into an `intent://` URL that names a
package directly. For a `music.youtube.com` link specifically, it's a **chain**: try the YouTube
Music app first; if that's not installed, try the regular YouTube app next (same video, just
without the Music UI); only if neither is installed does it fall back to the plain link in the
browser. Plain `youtube.com`/`youtu.be` links just target the regular YouTube app. This is on by
default and only applies on Android; toggle it off in Settings (or `?app=0`) if you ever want the
browser instead.

**If you're still landing on the website after this fix**, the near-certain cause is that neither
app is installed (or signed in) on that phone — check the YouTube Music app icon is actually
there, not just YouTube. That's not a bug in the page; there's no app left to hand the link to.

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

**Confirming test:** unlocking the phone *after* the fact doesn't retest anything — once the
action has already failed silently, it doesn't retry. To actually isolate the cause, turn the
screen on and unlock the phone yourself, keep it that way, then trigger the Bluetooth connection
(reconnect, or toggle Bluetooth off/on on the car). If the browser opens fine with the screen
already on but never does with the screen off, that's a confirmed background-start block, not a
problem with the routine's link/condition/action itself.

**A key data point:** a direct `music.youtube.com` link in the same Routine action worked
seamlessly, even locked. That domain is a verified Android App Link, so Android hands it straight
to the YouTube Music app — no browser ever gets involved. Anything that requires an actual
browser window (the static page, or the Worker's own domain before it redirects) is a heavier
action than that, which is exactly why it's worth checking whether the *browser itself* is being
blocked from launching at all, independent of what page it's being sent to:

Things to check, roughly in order of how often they're the actual cause:

1. **Check Settings → Battery and device care → Background usage limits → Sleeping apps / Deep
   sleeping apps.** If your browser (Samsung Internet or Chrome) is on either list, Samsung
   actively prevents it from doing anything in the background — including being launched by a
   Routine — until you open it manually. Remove it from both lists. This would explain the exact
   pattern seen here (YouTube Music: fine, browser: nothing at all) regardless of what URL the
   Routine points at, so it's worth checking before anything else, including before troubleshooting
   the Worker in `worker/`.
2. **Grant "Display over other apps" to that same browser.** Settings → Apps → [browser] →
   Advanced → Display over other apps → **Allow**. This is one of the specific permissions Android
   exempts from the general background-activity-start block.
3. **Battery optimization on the Routines/Bixby engine.** Settings → Apps → find *Routines* (or
   *Bixby Routines* / *Modes and Routines*) → Battery → set to **Unrestricted**. If it's
   "Optimized" or "Restricted", Android can kill it before the action fires.
4. **Add a "Turn on screen" / "Wake screen" action before "Open link"**, if your One UI version
   offers it (Routine → Add action → Device settings). Put it first in the action list.
5. **Confirm the Bluetooth condition is the exact car device**, not "any Bluetooth device" — pick
   it from the paired-devices list when adding the condition, and re-pick it if you ever unpaired
   and re-paired the car.
6. **Check the routine is set to run every time, not once.** Routines conditions can be
   configured to trigger only the first time they're met; if it already fired once historically,
   it may not fire again until the condition toggles off and on.
7. **Auto Blocker / "More security settings"** on newer One UI can further restrict background
   app launches — check there isn't an added restriction on the Routines app specifically.

None of this can be fixed from the web page itself — it's the OS deciding whether to let the
automation draw a UI at all, before the browser (and this page) ever gets a chance to run.

**If none of that works:** this is a known, somewhat unreliable corner of Samsung Routines on
newer One UI/Android versions — some phones simply won't let it draw a screen from a locked
state no matter what's granted. The common escape hatch is switching this specific automation to
**Tasker** or **MacroDroid** instead of Routines; both use a foreground-service/accessibility-based
launch path that survives the lock screen far more reliably. That's phone-side setup, not
something this page can do, but it's worth knowing if Routines turns out to be a dead end.

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
