# instaclean

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

An all-in-one Instagram following/followers analytics tool for your terminal — scan your account, get real follow-back ratios and mutual counts, export shareable Markdown reports, analyze an offline data export with zero login, and (optionally) clean up who you follow. Every command speaks `--json`, so it's as easy to pipe into a script or a dashboard as it is to read on screen.

Uses Instagram's internal API directly (the same endpoints instagram.com itself calls). No scraping, no browser automation, no Selenium, no Puppeteer.

## What You Actually Get

This isn't a one-trick unfollow script — `unfollow` is one command out of seven. The rest is read-only analytics:

- **Full account audit** (`scan`) — your complete following *and* followers lists, cross-referenced. On a real test account: 153 following, 172 followers, 146 mutual, a 95.4% follow-back ratio, 4 verified accounts — computed from two API calls' worth of paginated data, not estimated.
- **Live re-verification** (`check`) — catches drift between when you scanned and now (someone followed back, deleted their account, etc.), and is explicit about it when Instagram won't answer (reports "unresolved," never guesses "deleted").
- **Shareable reports** (`report`) — a Markdown table with clickable profile links, so you or anyone else can review the list without touching the CLI.
- **Offline mode** (`offline`) — full following/follower diffing from Instagram's own data export, no cookies, no network calls at all.
- **Scriptable output** (`--json` on every command) — pipe straight into `jq`, a cron job, or your own dashboard.
- **Cleanup, when you want it** (`unfollow`) — interactive by default, with a dry-run mode, per-run limits, and adaptive rate-limit backoff if you do decide to act on what the analytics turned up.

## Do You Need to Log In?

No, not for everything. Two of the seven commands need nothing but files you already have:

- **`offline`** — reads an Instagram data export (`followers_1.json` + `following.json`) and diffs them. Zero network calls, zero cookies.
- **`report`** (without `--verify`) — builds its Markdown report straight from a saved `scan` file, so once you've scanned once, regenerating the report doesn't need a session either.

Everything else (`login`, `scan`, `check`, `unfollow`, `report --verify`, `stats`) talks to Instagram's API and needs your session cookies, because that's the only way to know who's *currently* following you back.

## Installation

```bash
# Install globally
npm install -g instaclean

# Or use directly with npx
npx instaclean
```

**Requirements:** Node.js 18+ (uses native `fetch`)

## Quick Start

```bash
# 1. Save your Instagram cookies (skip this if you're only using offline/report)
instaclean login

# 2. Scan your following list
instaclean scan

# 3. Check who doesn't follow you back
instaclean check --skip-verified

# 4. Generate a Markdown report with profile links to review
instaclean report

# 5. Unfollow them (interactive, 10 at a time)
instaclean unfollow --batch 10
```

## Getting Your Cookies (Login Tutorial)

Instagram doesn't have a public API for this, so the CLI reuses the session cookies your browser already has after you log in normally. There's nothing to install or authorize — you're just copying three values out of DevTools.

1. Open Chrome (or any Chromium/Firefox browser) and go to [instagram.com](https://instagram.com), logged in as usual.
2. Open DevTools (`F12`, or `Ctrl+Shift+I` / `Cmd+Option+I`).
3. Go to the **Application** tab (Chrome) or **Storage** tab (Firefox) → **Cookies** → `https://www.instagram.com`.
4. Find and copy the values for these three cookies:
   - `ds_user_id` — your numeric Instagram user ID
   - `csrftoken` — CSRF token for authenticated requests
   - `sessionid` — your actual session token (treat this like a password)
5. Feed them to the CLI, either interactively:
   ```bash
   instaclean login
   # prompts for each value one at a time
   ```
   or in one shot:
   ```bash
   instaclean login --cookies "ds_user_id=12345678; csrftoken=AbCdEfGh...; sessionid=12345678%3AMnOpQr..."
   ```
   or via environment variable, so nothing touches disk beyond your own shell config:
   ```bash
   export INSTACLEAN_COOKIES="ds_user_id=12345678; csrftoken=AbCdEfGh...; sessionid=12345678%3AMnOpQr..."
   instaclean scan
   ```
   or via a `.env` file in the project directory, if you're running from a clone rather than a global install — copy `.env.sample` to `.env` and fill in the same cookie string:
   ```bash
   cp .env.sample .env
   # edit .env, fill in INSTACLEAN_COOKIES=
   instaclean scan
   ```
   `.env` is git-ignored, so it never gets committed even if you `git add -A`.

Cookies are saved to `~/.instaclean/auth.json` with `600` permissions (owner-only). They expire when your Instagram session does — logging out elsewhere or a long period of inactivity means running `login` again.

**`sessionid` is equivalent to your password** while it's valid. Don't paste it anywhere but this CLI, and don't commit it.

## Commands

### `login` — Save Credentials

```bash
instaclean login                          # interactive prompt
instaclean login --cookies "ds_user_id=..."  # one-shot from a cookie string
```

Validates the cookies against Instagram before saving, so a typo or an expired session fails immediately instead of silently breaking a later command.

### `scan` — Scan Following + Followers

Fetches your full following list and full followers list via Instagram's friendships API (paginated, 50 accounts per page), then cross-references them so every followed account is tagged with whether they follow back.

```bash
instaclean scan
instaclean scan --output ./my-scan.json
```

Real output, on an account following 153 accounts:

```
✓ Scanned 153 accounts

Scan Results
────────────────────────────────────
  Following:          153
  Followers:          172
  Follow you back:    146
  Don't follow back:  7
  Verified accounts:  4

✓ Full results saved to ~/.instaclean/scan-results.json
```

Results are saved to `~/.instaclean/scan-results.json` (or `--output`) and are what every other command reads from — you only need to re-scan when you want fresh data.

### `check` — Verify Non-Followers Live

Takes the non-followers from your last `scan` and re-checks each one individually via the profile API. Useful because a scan can go stale — someone may have followed you back, unfollowed you, or deleted their account since you scanned.

```bash
instaclean check
instaclean check --skip-verified
```

If Instagram is currently rate-limiting your session, `check` says so rather than guessing — accounts it couldn't confirm are reported as unresolved, never silently counted as deleted:

```
⚠ Could not verify 7 accounts (Instagram rate-limited the check) — re-run `check` in a few minutes to resolve them.
```

### `report` — Markdown Report with Profile Links

Generates a Markdown file listing non-followers with clickable links to their profiles, so you can review who each account is before deciding to unfollow.

```bash
instaclean report                      # from last scan, no API calls
instaclean report --verify             # re-verify each one live first (slower, catches stale data)
instaclean report --skip-verified
instaclean report --output my-report.md
```

Real output (`--skip-verified`, same account as above — 4 verified accounts excluded from the 7 non-followers, leaving 3):

```markdown
# Instagram Non-Followers Report

> **Generated:** 2026-09-27 13:29 UTC | **Following:** 153 | **Follow back:** 146 | **Don't follow back:** 3

| # | Username | Name | Verified |
|--:|----------|------|:--------:|
| 1 | [@someuser](https://instagram.com/someuser) | Some Person | |
| 2 | [@brand](https://instagram.com/brand) | Brand Name | ✅ |
```

### `unfollow` — Unfollow Non-Followers

Presents non-followers in batches for your approval, then unfollows them with rate limiting. Two ways to run it:

**Interactive (default)** — verifies each batch live, shows a table, asks `y/n/quit` before acting:

```bash
instaclean unfollow                    # batches of 10, asks before each
instaclean unfollow --batch 5
instaclean unfollow --skip-verified
instaclean unfollow --dry-run          # see what would happen, unfollow nothing
```

Real `--dry-run --skip-verify --limit 3 --json` output — capped to 3 candidates, nothing actually touched:

```json
{"success":true,"total_unfollowed":3,"total_candidates":3,"dry_run":true,"results":[{"username":"...","success":true},{"username":"...","success":true},{"username":"...","success":true}]}
```

**Drip mode (`--no-interactive` + `--interval`)** — no prompts, spreads unfollows out over time at a fixed pace instead of firing them in bursts. The interval self-adjusts: it backs off after Instagram throttles a request and gradually speeds back up (never past your floor) after a long clean streak.

```bash
# ~20/hour, unattended
instaclean unfollow --no-interactive --interval 180

# Cap how many get unfollowed in this run — good for a nightly cron job
instaclean unfollow --no-interactive --interval 180 --limit 50
```

Other flags:

| Flag | Effect |
|------|--------|
| `--skip-verify` | Trust the scan results as-is; skip the live re-verification pass entirely (fastest, riskiest) |
| `--limit <n>` | Unfollow at most `n` accounts this run |
| `--interval <seconds>` | Fixed spacing between unfollows instead of the default burst-and-pause pattern |

If Instagram soft-throttles (answers with an HTML shell instead of JSON), the CLI backs off in escalating waits — 5, 15, 30, then 60 minutes — retrying the same account each time, rather than marking the whole run failed. Accounts already unfollowed in a previous run are tracked in `~/.instaclean/unfollowed.json` and automatically skipped, so a `--limit`-capped or interrupted run can just be re-run to continue where it left off.

### `offline` — Offline Analysis (No Login Needed)

Analyzes your Instagram data export without any API calls or saved cookies.

```bash
instaclean offline followers_1.json following.json
```

Real output, on a small sample export (2 followers, 2 following, 1 mutual):

```json
{"success":true,"followers":2,"following":2,"mutual":1,"not_following_back":1,"ratio":50,"users":["carol"]}
```

**How to get your data export:**
1. Instagram → Settings → Your Activity → Download Your Information
2. Select JSON format
3. Download and extract
4. Find `followers_1.json` and `following.json` in the `followers_and_following` folder

### `stats` — Account Summary

```bash
instaclean stats
```

Real output, from the same scan as above:

```
Account Stats
────────────────────────────────────
  Following:              153
  Followers:              172
  Mutual:                 146
  Don't follow back:      7
  Follow-back ratio:      95.4%
```

Reads straight from your last `scan` — no network calls, so it's instant.

## JSON Output

Every command supports `--json` for scriptable output:

```bash
instaclean scan --json | jq '.not_following_back'
instaclean check --json | jq '.users[].username'
instaclean offline followers.json following.json --json | jq '.users'
```

## Environment Variables

| Variable | Description |
|----------|--------------|
| `INSTACLEAN_COOKIES` | Cookie string, alternative to `--cookies` flag or `login` command |

Set it directly in your shell, or drop it in a `.env` file in the project root (loaded automatically via `dotenv`). Copy `.env.sample` to `.env` as a starting point — `.env` itself is git-ignored so your cookies never get committed.

## Rate Limiting

Conservative, tuned-by-testing defaults (see `src/utils/rate-limit.ts` for the exact numbers):

| Operation | Delay | Burst Pause |
|-----------|-------|-------------|
| Scan (friendships API) | ~1-1.2s between requests | ~10s every 6 requests |
| Verify (profile API) | ~0.8-1s between requests | ~15s every 80 requests |
| Unfollow (default mode) | ~2-3s between unfollows | ~60s every 30 unfollows |
| Unfollow (`--interval` drip mode) | fixed, adaptive around your floor | none — spacing *is* the limiter |

If Instagram returns a 429 or soft-throttles a request, the tool backs off automatically rather than hammering the endpoint.

**Going faster risks temporary blocks from Instagram.** The built-in limits exist to avoid that — loosen them at your own risk.

## Security

### Zero External Servers

Every network request goes to `instagram.com`. No telemetry, no analytics, no tracking, nothing sent anywhere else. Fully open source — read every line.

### Local Credential Storage

Cookies are stored in `~/.instaclean/auth.json` with `600` file permissions (owner-only read/write). They never leave your machine.

### What the Code Does

1. Reads your existing Instagram session cookies
2. Makes the same API calls Instagram's own web app makes
3. Shows you the results
4. Only unfollows when you explicitly confirm (or explicitly opt into unattended `--no-interactive` mode)

## Instagram Terms of Service

⚠️ **Disclaimer:** Using automated tools with Instagram may violate their [Terms of Service](https://help.instagram.com/581066165581870). Use this tool at your own risk. Nobody is responsible for any account restrictions that result from using it.

## Development

```bash
npm install

# Build
npm run build

# Watch mode
npm run dev

# Type check
npm run typecheck
```

## Tech Stack

- **TypeScript** (strict mode)
- **Node.js 18+** (native `fetch`, no HTTP libraries)
- [commander](https://github.com/tj/commander.js) (CLI), [chalk](https://github.com/chalk/chalk) (colors), [ora](https://github.com/sindresorhus/ora) (spinners), [cli-progress](https://github.com/npkgz/cli-progress) (progress bars)
- **tsup** for building (single ESM bundle)

## License

[MIT](LICENSE)
