/*
 * Morning Drive — serverless once-a-day redirect.
 *
 * Why this exists: a static webpage (GitHub Pages) that runs JavaScript to
 * decide whether to redirect turned out to be unreliable when opened by a
 * Samsung Routine while the phone is locked — likely because Android has to
 * launch a full browser Activity, render a page, and run JS before anything
 * happens, and that whole sequence can get cut short while backgrounded.
 *
 * A direct https://music.youtube.com/... link, by contrast, worked instantly
 * even locked, because that domain is a verified Android App Link: Android
 * hands it straight to the YouTube Music app without ever needing a browser
 * to render anything.
 *
 * This Worker is the middle ground: the Routine points here instead of at a
 * webpage. On each hit it makes the once-per-day decision with a single KV
 * read, then immediately returns an HTTP redirect — no HTML, no JavaScript,
 * nothing to render. Whatever browser Android launches to process the request
 * has the least possible amount of work to do before handing off to
 * music.youtube.com's own verified app link, same as the original working
 * setup. It is NOT a 100% guarantee: Android still has to launch a browser to
 * make the request at all, which is the same first step that failed before —
 * this just minimizes everything that has to happen after that step.
 */

const DEFAULT_TARGET_URL =
  "https://music.youtube.com/watch?v=mavP2gTNrtg&si=pH8th9lFt2fgQuUl&t=0";
const MAX_OPEN_LOG = 20;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const params = url.searchParams;

    const targetUrl = env.TARGET_URL || DEFAULT_TARGET_URL;
    const timezone = env.TIMEZONE || "UTC";
    const dayStartHour = clampHour(env.DAY_START_HOUR, 4);

    // Best-effort diagnostic log of every hit — deferred so it never slows
    // down the redirect itself.
    ctx.waitUntil(recordOpen(env));

    if (params.get("reset") === "1") {
      await env.MORNING_DRIVE.delete("state");
      return new Response("Reset OK\n", { status: 200 });
    }

    if (url.pathname === "/status" || url.pathname === "/") {
      return renderStatus(env, targetUrl, timezone, dayStartHour);
    }

    // Anything else (including the expected "/launch") is the automated hit.
    const force = params.get("force") === "1";
    const now = new Date();
    const today = dayKeyInZone(now, timezone, dayStartHour);

    const state = (await env.MORNING_DRIVE.get("state", "json")) || {
      day: null,
      at: null
    };

    if (state.day === today && !force) {
      return new Response(
        "Already played today" +
          (state.at
            ? " (since " + formatInZone(new Date(state.at), timezone) + ").\n"
            : ".\n"),
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    // Update state in the background — the redirect itself doesn't need to
    // wait on the write completing.
    ctx.waitUntil(
      env.MORNING_DRIVE.put(
        "state",
        JSON.stringify({ day: today, at: now.toISOString() })
      )
    );

    return Response.redirect(targetUrl, 302);
  }
};

function clampHour(value, fallback) {
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 || n > 23 ? fallback : n;
}

// Same trick as the original client-side code: shift the instant back by the
// day-start-hour offset, then read off the calendar date in the target zone.
// "en-CA" is a convenient way to get Intl to hand back YYYY-MM-DD directly.
function dayKeyInZone(date, timeZone, dayStartHour) {
  const shifted = new Date(date.getTime() - dayStartHour * 3600000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(shifted);
}

function formatInZone(date, timeZone) {
  try {
    return date.toLocaleString("en-US", { timeZone });
  } catch (e) {
    return date.toISOString();
  }
}

async function recordOpen(env) {
  try {
    const list = (await env.MORNING_DRIVE.get("opens", "json")) || [];
    list.push(new Date().toISOString());
    while (list.length > MAX_OPEN_LOG) list.shift();
    await env.MORNING_DRIVE.put("opens", JSON.stringify(list));
  } catch (e) {
    // Diagnostics are best-effort; never let a logging failure affect the
    // actual redirect.
  }
}

async function renderStatus(env, targetUrl, timezone, dayStartHour) {
  const state = (await env.MORNING_DRIVE.get("state", "json")) || {
    day: null,
    at: null
  };
  const opens = (await env.MORNING_DRIVE.get("opens", "json")) || [];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Morning Drive — status</title>
<style>
  :root{--bg:#0b0f14;--card:#131a23;--line:#223042;--text:#e8eef6;--muted:#8da2ba;--accent:#ff2d55}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;padding:24px 16px;display:flex;flex-direction:column;align-items:center;gap:16px}
  main{width:100%;max-width:480px}
  h1{font-size:22px;margin:0 0 4px}
  .muted{color:var(--muted);font-size:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:16px 0}
  a.btn{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:16px;border-radius:14px;margin-top:8px}
  code{background:#0d131b;padding:2px 6px;border-radius:6px;font-size:13px}
  ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}
  @media (prefers-color-scheme: light){:root{--bg:#f4f6fa;--card:#fff;--line:#dde3ec;--text:#101720;--muted:#5d6b7f}code{background:#f0f2f6}}
</style>
</head>
<body>
<main>
  <h1>Morning Drive</h1>
  <p class="muted">Serverless once-a-day redirect status.</p>
  <div class="card">
    <div><strong>Target link:</strong><br><code>${escapeHtml(targetUrl)}</code></div>
    <div style="margin-top:10px"><strong>Day boundary:</strong> ${dayStartHour}:00 (${escapeHtml(timezone)})</div>
    <div style="margin-top:10px"><strong>Played today (${escapeHtml(state.day || "—")}):</strong> ${
      state.day ? "yes" : "no"
    }${state.at ? " · " + escapeHtml(formatInZone(new Date(state.at), timezone)) : ""}</div>
  </div>
  <a class="btn" href="/launch?force=1">Play now (ignores the daily lock)</a>
  <div class="card">
    <strong>Recent hits</strong>
    <ul>${
      opens.length
        ? opens
            .slice()
            .reverse()
            .map((iso) => "<li>" + escapeHtml(formatInZone(new Date(iso), timezone)) + "</li>")
            .join("")
        : "<li>none yet</li>"
    }</ul>
  </div>
  <p class="muted">Point the car automation's "Open website" action at <code>${escapeHtml(
    "/launch"
  )}</code> on this Worker's URL. <code>?reset=1</code> clears today's lock.</p>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
