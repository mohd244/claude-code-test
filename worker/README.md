# Morning Drive — serverless redirect (Cloudflare Worker)

Replaces the GitHub Pages page as the automation's target. Point the car
automation's "Open website" action straight at this Worker instead of the
static page — it makes the once-per-day decision with a single fast lookup
and immediately returns an HTTP redirect, no page to render and no
JavaScript to run. That mirrors the previously-reliable setup (a direct
`music.youtube.com` link in the Routine) far more closely than a full
webpage does.

**This isn't a 100% guarantee.** Android still has to launch some browser to
make the request in the first place — the same first step that failed with
the plain webpage. This just minimizes everything that has to happen
*after* that step, so it's much less likely to get cut short while the
phone is locked. If it's still unreliable after deploying this, the
underlying blocker is Android/Samsung preventing that browser from launching
at all while locked — see the root README's troubleshooting section, in
particular the "Sleeping apps / Deep sleeping apps" check.

## What it does

- `GET /launch` (or any path other than `/` and `/status`) — the automated
  endpoint. Looks up the last-played date in Workers KV; if today (in your
  configured timezone and day-start-hour) hasn't been played yet, it records
  today and responds with a `302` redirect to `TARGET_URL`. Otherwise it
  responds `200 Already played today` and does nothing further.
- `GET /status` (or `/`) — a small status page: whether today has been
  played, a manual "Play now" button (`?force=1`), and a log of recent hits
  for diagnostics.
- `?reset=1` on any path clears the daily lock.
- `?force=1` on `/launch` ignores the daily lock and redirects anyway.

## One-time setup

You'll need a free Cloudflare account (cloudflare.com → sign up) and Node.js
installed wherever you run these commands (your own computer — this doesn't
need to run continuously anywhere, `wrangler deploy` just uploads the code).

```sh
cd worker

# Log in once — opens a browser tab to authorize.
npx wrangler login

# Create the KV namespace that stores the daily lock state.
npx wrangler kv namespace create MORNING_DRIVE
```

That last command prints something like:

```
[[kv_namespaces]]
binding = "MORNING_DRIVE"
id = "abcd1234..."
```

Copy that `id` value into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

Then edit the `[vars]` block in `wrangler.toml`:

- `TARGET_URL` — the link to redirect to (defaults to the YouTube Music link
  already in this repo).
- `TIMEZONE` — your IANA timezone, e.g. `"Asia/Riyadh"`, `"Europe/London"`,
  `"America/New_York"`. This matters — it's how the Worker knows what
  "today" means for you; the default `"UTC"` is almost certainly wrong.
- `DAY_START_HOUR` — the boundary between "days", default `4` (4 a.m.), same
  as the webpage.

## Deploy

```sh
npx wrangler deploy
```

This prints your Worker's URL, something like:

```
https://morning-drive.<your-subdomain>.workers.dev
```

Open `https://morning-drive.<your-subdomain>.workers.dev/status` to confirm
it's live.

## Point the automation at it

In the Samsung Routine (or whichever automation), change the "Open website"
action's URL to:

```
https://morning-drive.<your-subdomain>.workers.dev/launch
```

## Redeploying after a change

Edit `wrangler.toml` or `src/index.js`, then run `npx wrangler deploy` again
— it updates the same URL in place.

## Testing from a terminal

```sh
curl -i https://morning-drive.<your-subdomain>.workers.dev/launch
# First hit of the day: HTTP/2 302, Location: https://music.youtube.com/...
# Later hits the same day: HTTP/2 200, "Already played today ..."

curl -i "https://morning-drive.<your-subdomain>.workers.dev/launch?reset=1"
# Clears the lock so the next /launch acts like the first hit again.
```

## Cost

Cloudflare's free tier covers this easily — Workers' free plan includes
100,000 requests/day and Workers KV includes generous free daily read/write
limits, both far beyond what a single daily car connection needs.
