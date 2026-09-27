import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { getAuth, getConfigDir } from '../auth/cookies.js';
import { unfollowUser, verifyProfiles, THROTTLED } from '../api/instagram.js';
import { createRateLimiter, RATE_LIMITS, sleep, sleepWithTicks } from '../utils/rate-limit.js';
import { formatNonFollowersTable, formatUnfollowResult, formatError, formatWarning } from '../utils/format.js';
import type { ScanResult, VerifiedUser } from '../api/types.js';

/** Escalating waits when Instagram soft-throttles, in minutes. */
const BACKOFFS_MIN = [5, 15, 30, 60];

/** Ceiling the adaptive interval will not exceed. */
const MAX_INTERVAL_MS = 300_000;

/** Consecutive successes before the interval tightens again. */
const CLEAN_STREAK_TO_SPEED_UP = 20;

function formatCountdown(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}

export interface UnfollowOptions {
  cookies?: string;
  batch?: number;
  interactive?: boolean;
  skipVerified?: boolean;
  skipVerify?: boolean;
  limit?: number;
  interval?: number;
  dryRun?: boolean;
  input?: string;
  json?: boolean;
}

export async function unfollowCommand(options: UnfollowOptions): Promise<void> {
  const batchSize = options.batch ?? 10;
  const interactive = options.interactive !== false; // default true

  let auth;
  try {
    auth = await getAuth(options.cookies);
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: (error as Error).message }));
    } else {
      console.log(formatError((error as Error).message));
    }
    process.exitCode = 1;
    return;
  }

  // Load scan results
  const scanFile = options.input ?? join(getConfigDir(), 'scan-results.json');
  if (!existsSync(scanFile)) {
    const msg = 'No scan results found. Run `instaclean scan` first.';
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: msg }));
    } else {
      console.log(formatError(msg));
    }
    process.exitCode = 1;
    return;
  }

  let scanResult: ScanResult;
  try {
    scanResult = JSON.parse(await readFile(scanFile, 'utf-8')) as ScanResult;
  } catch {
    const msg = `Failed to parse scan results from ${scanFile}`;
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: msg }));
    } else {
      console.log(formatError(msg));
    }
    process.exitCode = 1;
    return;
  }

  // Get non-followers
  let candidates = scanResult.users.filter((u) => !u.follows_viewer);
  if (options.skipVerified) {
    const before = candidates.length;
    candidates = candidates.filter((u) => !u.is_verified);
    if (!options.json && before !== candidates.length) {
      console.log(formatWarning(`Skipped ${before - candidates.length} verified accounts`));
    }
  }

  // Instagram meters unfollow *attempts*, not just successes, so re-trying
  // accounts already unfollowed in a previous run would waste the daily budget.
  const progressFile = join(getConfigDir(), 'unfollowed.json');
  const alreadyDone = new Set<string>(
    existsSync(progressFile)
      ? (JSON.parse(await readFile(progressFile, 'utf-8')) as string[])
      : [],
  );
  if (alreadyDone.size > 0) {
    const before = candidates.length;
    candidates = candidates.filter((u) => !alreadyDone.has(u.id));
    if (!options.json && before !== candidates.length) {
      console.log(chalk.gray(`  Skipping ${before - candidates.length} already unfollowed in previous runs.`));
    }
  }

  if (options.limit && candidates.length > options.limit) {
    candidates = candidates.slice(0, options.limit);
    if (!options.json) {
      console.log(chalk.gray(`  Limited to ${options.limit} this run.`));
    }
  }

  if (candidates.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, unfollowed: 0 }));
    } else {
      console.log(chalk.green('\n  No non-followers to unfollow! 🎉\n'));
    }
    return;
  }

  if (!options.json) {
    console.log(`\n  Found ${chalk.yellow(candidates.length)} non-followers.`);
    if (options.dryRun) {
      console.log(chalk.yellow('  DRY RUN — no accounts will be unfollowed.\n'));
    }
  }

  let verified: VerifiedUser[];

  if (options.skipVerify) {
    // Trust the scan results as-is, no live re-check per account.
    verified = candidates.map((user) => ({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      is_verified: user.is_verified,
      follows_viewer: false,
      followed_by_viewer: false,
      exists: true,
    }));
  } else {
    // Verify before unfollowing
    if (!options.json) {
      console.log(chalk.gray('  Verifying accounts before unfollowing...\n'));
    }

    const verifyBar = options.json
      ? null
      : new cliProgress.SingleBar(
          { format: '  Verifying  |{bar}| {value}/{total}', hideCursor: true },
          cliProgress.Presets.shades_classic,
        );
    verifyBar?.start(candidates.length, 0);

    const profiles = await verifyProfiles(auth, candidates.map((u) => u.username), {
      onProgress: (done) => {
        verifyBar?.update(done);
      },
    });
    verifyBar?.stop();
    if (!options.json) console.log(chalk.green('  Verification complete\n'));

    // Build verified non-followers list
    verified = [];
    for (const user of candidates) {
      const profile = profiles.get(user.username);
      if (!profile) continue;
      if (profile.follows_viewer) continue; // Actually follows now

      verified.push({
        id: user.id,
        username: profile.username,
        full_name: profile.full_name,
        is_verified: profile.is_verified,
        follows_viewer: false,
        followed_by_viewer: profile.followed_by_viewer,
        exists: true,
      });
    }
  }

  if (verified.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, unfollowed: 0, message: 'No confirmed non-followers' }));
    } else {
      console.log(chalk.green('\n  All accounts verified — no confirmed non-followers! 🎉\n'));
    }
    return;
  }

  const rl = interactive && !options.json
    ? readline.createInterface({ input, output })
    : null;

  let totalUnfollowed = 0;
  let totalFailed = 0;
  let processedCount = 0;
  let throttledOut = false;
  const results: Array<{ username: string; success: boolean }> = [];
  // In drip mode the spacing between actions is itself the rate limit, so the
  // burst pause is unnecessary. The interval adapts to whatever Instagram is
  // actually tolerating: slower after a throttle, faster after a clean streak.
  const wait = createRateLimiter(RATE_LIMITS.unfollow);
  const floorMs = (options.interval ?? 0) * 1000;
  let intervalMs = floorMs;
  let cleanStreak = 0;

  const slowDown = () => {
    intervalMs = Math.min(MAX_INTERVAL_MS, Math.round(intervalMs * 1.5));
    cleanStreak = 0;
  };
  const speedUp = () => {
    if (++cleanStreak < CLEAN_STREAK_TO_SPEED_UP) return;
    intervalMs = Math.max(floorMs, Math.round(intervalMs * 0.85));
    cleanStreak = 0;
  };

  const unfollowBar = options.json || interactive
    ? null
    : new cliProgress.SingleBar(
        {
          format: '  Unfollowing |{bar}| {value}/{total} | ok {ok} fail {fail} | pace {pace} | ETA {eta_formatted} | {status}',
          etaBuffer: 20,
          barsize: 24,
          hideCursor: true,
        },
        cliProgress.Presets.shades_classic,
      );
  unfollowBar?.start(verified.length, 0, {
    ok: 0,
    fail: 0,
    pace: intervalMs ? `${Math.round(intervalMs / 1000)}s` : 'auto',
    status: '',
  });

  try {
    // Process in batches
    for (let batchStart = 0; batchStart < verified.length; batchStart += batchSize) {
      const batch = verified.slice(batchStart, batchStart + batchSize);

      if (!options.json && interactive) {
        console.log(`\n${chalk.bold(`Batch ${Math.floor(batchStart / batchSize) + 1} (${batch.length} accounts):`)}`);
        console.log(formatNonFollowersTable(batch, batchStart));
      }

      if (interactive && rl) {
        console.log('');
        const answer = await rl.question(
          chalk.yellow('  Unfollow all in this batch? (y/n/quit): '),
        );

        if (answer.toLowerCase() === 'quit' || answer.toLowerCase() === 'q') {
          console.log(chalk.gray('\n  Stopped by user.\n'));
          break;
        }

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log(chalk.gray('  Skipped this batch.\n'));
          continue;
        }
      }

      // Execute unfollows
      for (const user of batch) {
        if (options.dryRun) {
          if (!options.json && interactive) {
            console.log(`  ${chalk.gray('[DRY RUN]')} Would unfollow ${chalk.cyan('@' + user.username)}`);
          }
          results.push({ username: user.username, success: true });
          totalUnfollowed++;
          processedCount++;
          unfollowBar?.increment(1, { ok: totalUnfollowed, fail: totalFailed, status: `[dry-run] @${user.username}` });
          continue;
        }

        const tick = (remainingMs: number) => {
          unfollowBar?.update(processedCount, {
            ok: totalUnfollowed,
            fail: totalFailed,
            pace: `${Math.round(intervalMs / 1000)}s`,
            status: `next @${user.username} in ${formatCountdown(remainingMs)}`,
          });
        };

        if (intervalMs > 0) {
          if (processedCount > 0) {
            await sleepWithTicks(intervalMs + Math.random() * intervalMs * 0.25, tick);
          }
        } else {
          await wait(tick);
        }

        // Instagram soft-throttles by answering 200 with an HTML shell. Back
        // off and retry the same account rather than burning through the list
        // marking everyone failed.
        let result = await unfollowUser(auth, user.id, user.username);
        for (let attempt = 0; result.error === THROTTLED && attempt < BACKOFFS_MIN.length; attempt++) {
          const mins = BACKOFFS_MIN[attempt]!;
          unfollowBar?.update(processedCount, {
            ok: totalUnfollowed,
            fail: totalFailed,
            status: `throttled, waiting ${mins}m (try ${attempt + 1}/${BACKOFFS_MIN.length})`,
          });
          if (!options.json && interactive) {
            console.log(formatWarning(`Throttled — waiting ${mins} minutes...`));
          }
          slowDown();
          await sleepWithTicks(mins * 60_000, (remainingMs) => {
            unfollowBar?.update(processedCount, {
              ok: totalUnfollowed,
              fail: totalFailed,
              pace: `${Math.round(intervalMs / 1000)}s`,
              status: `@${user.username} throttled, retry in ${formatCountdown(remainingMs)} (${attempt + 1}/${BACKOFFS_MIN.length})`,
            });
          });
          result = await unfollowUser(auth, user.id, user.username);
        }

        results.push({ username: result.username, success: result.success });

        if (!options.json && interactive) {
          console.log(formatUnfollowResult(result.username, result.success));
        }

        if (result.success) {
          totalUnfollowed++;
          speedUp();
          alreadyDone.add(user.id);
          await writeFile(progressFile, JSON.stringify([...alreadyDone]), 'utf-8');
        } else {
          totalFailed++;
        }
        processedCount++;
        unfollowBar?.increment(1, {
          ok: totalUnfollowed,
          fail: totalFailed,
          pace: `${Math.round(intervalMs / 1000)}s`,
          status: `@${result.username} ${result.success ? 'ok' : 'FAILED'}`,
        });

        if (result.error === THROTTLED) {
          unfollowBar?.stop();
          console.log(formatError(`\n  Still throttled after ${BACKOFFS_MIN.length} backoffs — stopping so the account cools down.`));
          console.log(chalk.gray(`  Unfollowed ${totalUnfollowed} before stopping. Re-run later to continue.\n`));
          throttledOut = true;
          break;
        }
      }

      if (throttledOut) break;

      // Pause between batches if there are more
      if (batchStart + batchSize < verified.length && !options.dryRun) {
        if (!options.json && interactive) {
          console.log(chalk.gray('\n  Pausing between batches...\n'));
        }
        await sleep(5_000);
      }
    }
  } finally {
    rl?.close();
    unfollowBar?.stop();
  }

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      total_unfollowed: totalUnfollowed,
      total_candidates: verified.length,
      dry_run: options.dryRun ?? false,
      results,
    }));
  } else {
    console.log(`\n  ${chalk.bold('Done!')} Unfollowed ${chalk.green(totalUnfollowed)} accounts.\n`);
  }
}
