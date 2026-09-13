/*
 * Morning Drive — once-a-day launcher for a car Bluetooth trigger.
 *
 * The car opens this page every time it connects to Bluetooth. The page decides
 * whether today's launch already happened; if it did, it stays quiet, otherwise
 * it offers (or performs) a redirect to the music link.
 *
 * State lives in localStorage, so it is per-browser and per-device: whichever
 * browser the car trigger opens is the one that remembers.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Config — edit these defaults, or change them in the Settings panel. *
   * ------------------------------------------------------------------ */
  var DEFAULTS = {
    url: "https://music.youtube.com/watch?v=mavP2gTNrtg&si=pH8th9lFt2fgQuUl&t=0",
    dayStartHour: 4,   // 04:00 local time is the boundary between "days"
    autoLaunch: false, // true = redirect by itself, false = wait for one tap
    countdown: 5,      // seconds shown before an auto-launch fires
    openInApp: true    // Android only: force the YouTube/YouTube Music app instead of the browser
  };

  var STORE_KEY = "morningDrive.v1";
  var MAX_OPEN_LOG = 20;

  /* ------------------------- Android app deep link ------------------------- *
   * A plain https://music.youtube.com/... link opened by a non-interactive    *
   * trigger (Samsung Routines, Tasker, etc.) usually lands in the browser     *
   * instead of the app, because Android only hands a link to the matching    *
   * app when it trusts the tap that opened it. An intent:// URL sidesteps    *
   * that by naming the target app package directly, with the plain URL as a  *
   * fallback if the app isn't installed. This only works in Chromium-based   *
   * browsers (Chrome, Samsung Internet) — not in-app WebViews.               *
   * -------------------------------------------------------------------------- */
  var YOUTUBE_PACKAGES = {
    "music.youtube.com": "com.google.android.apps.youtube.music",
    "www.youtube.com": "com.google.android.youtube",
    "youtube.com": "com.google.android.youtube",
    "youtu.be": "com.google.android.youtube",
    "m.youtube.com": "com.google.android.youtube"
  };

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || "");
  }

  // Returns an intent:// URL for a recognized YouTube host, or null if the
  // link isn't one we know how to target (caller should use the plain URL).
  function androidIntentUrl(rawUrl) {
    var parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (e) {
      return null;
    }
    var pkg = YOUTUBE_PACKAGES[parsed.hostname.toLowerCase()];
    if (!pkg) return null;
    var rest = parsed.href.slice(parsed.protocol.length + 2); // strip "https://"
    return "intent://" + rest +
      "#Intent;scheme=" + parsed.protocol.replace(":", "") +
      ";package=" + pkg +
      ";S.browser_fallback_url=" + encodeURIComponent(parsed.href) +
      ";end";
  }

  function launchUrlFor(rawUrl, openInApp) {
    if (openInApp && isAndroid()) {
      var intentUrl = androidIntentUrl(rawUrl);
      if (intentUrl) return intentUrl;
    }
    return rawUrl;
  }

  /* --------------------------- storage --------------------------- */

  var storageOK = true;

  function readState() {
    var empty = { settings: {}, lastDay: null, lastAt: null, opens: [] };
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      return {
        settings: parsed.settings || {},
        lastDay: parsed.lastDay || null,
        lastAt: parsed.lastAt || null,
        opens: Array.isArray(parsed.opens) ? parsed.opens : []
      };
    } catch (e) {
      storageOK = false;
      return empty;
    }
  }

  function writeState(next) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch (e) {
      storageOK = false;
    }
  }

  var state = readState();

  // Every page load gets a timestamp, independent of whether it led to a
  // launch. This is the only way to tell "the phone never opened the browser"
  // (nothing new appears here) apart from "it opened but didn't redirect"
  // (an entry shows up, but lastAt / the music app didn't follow).
  state.opens.push(new Date().toISOString());
  if (state.opens.length > MAX_OPEN_LOG) state.opens = state.opens.slice(-MAX_OPEN_LOG);
  writeState(state);

  /* ------------------------ config resolution ------------------------ */

  var params = new URLSearchParams(window.location.search);

  function clampHour(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) || n < 0 || n > 23 ? fallback : n;
  }

  function clampCount(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) || n < 0 || n > 60 ? fallback : n;
  }

  function boolParam(name) {
    if (!params.has(name)) return null;
    var v = params.get(name).toLowerCase();
    return !(v === "0" || v === "false" || v === "no");
  }

  var cfg = {
    url: params.get("url") || state.settings.url || DEFAULTS.url,
    dayStartHour: clampHour(params.get("hour"),
      clampHour(state.settings.dayStartHour, DEFAULTS.dayStartHour)),
    autoLaunch: DEFAULTS.autoLaunch,
    countdown: clampCount(params.get("delay"),
      clampCount(state.settings.countdown, DEFAULTS.countdown)),
    openInApp: DEFAULTS.openInApp
  };

  if (typeof state.settings.autoLaunch === "boolean") cfg.autoLaunch = state.settings.autoLaunch;
  var autoParam = boolParam("auto");
  if (autoParam !== null) cfg.autoLaunch = autoParam;

  if (typeof state.settings.openInApp === "boolean") cfg.openInApp = state.settings.openInApp;
  var appParam = boolParam("app");
  if (appParam !== null) cfg.openInApp = appParam;

  var force = boolParam("force") === true;

  if (boolParam("reset") === true) {
    state.lastDay = null;
    state.lastAt = null;
    writeState(state);
  }

  /* ----------------------------- dates ----------------------------- */

  // A "day" runs from dayStartHour to dayStartHour. Shifting the clock back by
  // that many hours turns the custom day into a plain calendar date.
  function dayKey(date) {
    var shifted = new Date(date.getTime() - cfg.dayStartHour * 3600000);
    return shifted.getFullYear() + "-" +
      String(shifted.getMonth() + 1).padStart(2, "0") + "-" +
      String(shifted.getDate()).padStart(2, "0");
  }

  function nextReset(from) {
    var next = new Date(from);
    next.setHours(cfg.dayStartHour, 0, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  function timeText(date) {
    try {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return date.getHours() + ":" + String(date.getMinutes()).padStart(2, "0");
    }
  }

  function greeting(hour) {
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  /* ------------------------------ DOM ------------------------------ */

  var el = {
    title: document.getElementById("title"),
    subtitle: document.getElementById("subtitle"),
    pill: document.getElementById("pill"),
    pillText: document.getElementById("pillText"),
    playBtn: document.getElementById("playBtn"),
    playLabel: document.getElementById("playLabel"),
    playSub: document.getElementById("playSub"),
    againBtn: document.getElementById("againBtn"),
    cancelBtn: document.getElementById("cancelBtn"),
    note: document.getElementById("note"),
    storageWarn: document.getElementById("storageWarn"),
    urlInput: document.getElementById("urlInput"),
    hourInput: document.getElementById("hourInput"),
    autoInput: document.getElementById("autoInput"),
    delayInput: document.getElementById("delayInput"),
    appInput: document.getElementById("appInput"),
    saveBtn: document.getElementById("saveBtn"),
    resetBtn: document.getElementById("resetBtn"),
    lastPlayed: document.getElementById("lastPlayed"),
    openLog: document.getElementById("openLog")
  };

  var now = new Date();
  var today = dayKey(now);
  var playedToday = state.lastDay === today;
  var timer = null;

  /* ---------------------------- launching ---------------------------- */

  function launch() {
    stopCountdown();
    state.lastDay = dayKey(new Date());
    state.lastAt = new Date().toISOString();
    writeState(state);

    el.pill.dataset.state = "done";
    el.pillText.textContent = "Opening…";
    el.note.textContent = "If nothing happens, tap the link below.";

    var target = launchUrlFor(cfg.url, cfg.openInApp);
    var isIntent = target.indexOf("intent://") === 0;

    // intent:// isn't a real page navigation, so replace() can misbehave —
    // assign it directly. For a plain https URL, replace() keeps this page
    // out of the back stack, so backing out of the music app doesn't bounce
    // straight into the launcher again.
    if (isIntent) {
      window.location.href = target;
    } else {
      try {
        window.location.replace(target);
      } catch (e) {
        window.location.href = target;
      }
    }

    // Fallback for browsers that block the programmatic redirect, or don't
    // support intent:// (in which case this offers the plain URL instead).
    window.setTimeout(function () {
      el.note.innerHTML = '<a href="' + encodeURI(cfg.url) + '" style="color:inherit">Open the link manually</a>';
    }, 1200);
  }

  function stopCountdown() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    el.cancelBtn.hidden = true;
  }

  function startCountdown(seconds) {
    var left = seconds;

    function tick() {
      if (left <= 0) {
        launch();
        return;
      }
      el.playSub.textContent = "Starting in " + left + "s";
      left--;
    }

    el.cancelBtn.hidden = false;
    el.cancelBtn.onclick = function () {
      stopCountdown();
      el.playSub.textContent = "Auto-launch cancelled";
    };

    tick();
    timer = window.setInterval(tick, 1000);
  }

  /* ------------------------------ render ------------------------------ */

  function render() {
    el.title.textContent = greeting(now.getHours());
    el.storageWarn.style.display = storageOK ? "none" : "block";

    if (playedToday && !force) {
      var reset = nextReset(now);
      el.pill.dataset.state = "done";
      el.pillText.textContent = "Already played today";
      el.subtitle.textContent = "Nothing to do — enjoy the drive.";
      el.againBtn.hidden = false;
      el.note.textContent = "Resets at " + timeText(reset) +
        (state.lastAt ? " · played at " + timeText(new Date(state.lastAt)) : "");
      el.againBtn.onclick = launch;
      return;
    }

    el.pill.dataset.state = "ready";
    el.pillText.textContent = force ? "Forced (daily lock ignored)" : "Ready for today";
    el.subtitle.textContent = "First connection of the day.";
    el.playBtn.hidden = false;
    el.playLabel.textContent = "Play now";
    el.playSub.textContent = cfg.autoLaunch ? "" : "Tap to open your music";
    el.playBtn.onclick = launch;
    el.note.textContent = "This only offers itself once per day.";

    if (cfg.autoLaunch) {
      if (cfg.countdown > 0) startCountdown(cfg.countdown);
      else launch();
    }
  }

  /* ----------------------------- settings ----------------------------- */

  function fillSettings() {
    for (var h = 0; h < 24; h++) {
      var opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = String(h).padStart(2, "0") + ":00";
      el.hourInput.appendChild(opt);
    }
    el.urlInput.value = cfg.url;
    el.hourInput.value = String(cfg.dayStartHour);
    el.autoInput.checked = cfg.autoLaunch;
    el.delayInput.value = String(cfg.countdown);
    el.appInput.checked = cfg.openInApp;
    el.lastPlayed.textContent = state.lastAt
      ? "Last played: " + new Date(state.lastAt).toLocaleString()
      : "Last played: never";

    // Recent page loads, newest first — the only client-side way to tell
    // "the phone never opened the browser today" apart from "it opened but
    // the redirect failed", since a load that never happens can't log itself.
    el.openLog.textContent = state.opens.length
      ? state.opens.slice().reverse().map(function (iso) {
          return new Date(iso).toLocaleString();
        }).join(" · ")
      : "none yet";

    el.saveBtn.onclick = function () {
      state.settings = {
        url: el.urlInput.value.trim() || DEFAULTS.url,
        dayStartHour: clampHour(el.hourInput.value, DEFAULTS.dayStartHour),
        autoLaunch: el.autoInput.checked,
        countdown: clampCount(el.delayInput.value, DEFAULTS.countdown),
        openInApp: el.appInput.checked
      };
      writeState(state);
      el.saveBtn.textContent = storageOK ? "Saved ✓" : "Could not save";
      window.setTimeout(function () {
        window.location.href = window.location.pathname;
      }, 600);
    };

    el.resetBtn.onclick = function () {
      stopCountdown();
      state.lastDay = null;
      state.lastAt = null;
      writeState(state);
      window.location.href = window.location.pathname;
    };
  }

  fillSettings();
  render();

  // Coming back from the music app (or leaving the tab open overnight) should
  // re-evaluate the day instead of showing a stale screen.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    var fresh = readState();
    var freshDay = dayKey(new Date());
    if (fresh.lastDay === freshDay && !playedToday) window.location.reload();
    if (freshDay !== today) window.location.reload();
  });
})();
