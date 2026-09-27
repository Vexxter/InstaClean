import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { getAuth, getConfigDir } from '../auth/cookies.js';
import { verifyProfiles } from '../api/instagram.js';
import { formatNonFollowersTable, formatError, formatWarning } from '../utils/format.js';
import type { ScanResult, VerifiedUser } from '../api/types.js';

export interface CheckOptions {
  cookies?: string;
  skipVerified?: boolean;
  input?: string;
  json?: boolean;
}

export async function checkCommand(options: CheckOptions): Promise<void> {
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

  // Filter to non-followers from scan
  const nonFollowers = scanResult.users.filter((u) => !u.follows_viewer);

  if (nonFollowers.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, verified: [], total: 0 }));
    } else {
      console.log(chalk.green('\n  Everyone you follow follows you back! 🎉\n'));
    }
    return;
  }

  if (!options.json) {
    console.log(`\n  Found ${chalk.yellow(nonFollowers.length)} potential non-followers from scan.`);
    console.log(chalk.gray('  Verifying each one via Instagram API...\n'));
  }

  const spinner = options.json ? null : ora('Verifying profiles...').start();

  try {
    const usernames = nonFollowers.map((u) => u.username);
    const profiles = await verifyProfiles(auth, usernames, {
      onProgress: (verified, total) => {
        if (spinner) {
          spinner.text = `Verifying profiles... ${verified}/${total}`;
        }
      },
    });

    spinner?.succeed('Verification complete');

    // Build verified list
    const verified: VerifiedUser[] = [];
    let skippedVerified = 0;
    let skippedDeleted = 0;
    let unresolved = 0;

    for (const user of nonFollowers) {
      if (!profiles.has(user.username)) {
        unresolved++;
        continue;
      }

      const profile = profiles.get(user.username)!;

      if (profile === null) {
        skippedDeleted++;
        continue;
      }

      if (profile.follows_viewer) {
        // Actually follows us — scan data was stale
        continue;
      }

      if (options.skipVerified && profile.is_verified) {
        skippedVerified++;
        continue;
      }

      verified.push({
        id: user.id,
        username: profile.username,
        full_name: profile.full_name,
        is_verified: profile.is_verified,
        follows_viewer: profile.follows_viewer,
        followed_by_viewer: profile.followed_by_viewer,
        exists: true,
      });
    }

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        total: verified.length,
        skipped_verified: skippedVerified,
        skipped_deleted: skippedDeleted,
        unresolved,
        users: verified,
      }));
    } else {
      if (skippedVerified > 0) {
        console.log(formatWarning(`Skipped ${skippedVerified} verified accounts`));
      }
      if (skippedDeleted > 0) {
        console.log(chalk.gray(`  Skipped ${skippedDeleted} deleted/suspended accounts\n`));
      }
      if (unresolved > 0) {
        console.log(formatWarning(`Could not verify ${unresolved} accounts (Instagram rate-limited the check) — re-run \`check\` in a few minutes to resolve them.`));
      }

      if (verified.length === 0) {
        console.log(chalk.green('\n  No confirmed non-followers after verification! 🎉\n'));
      } else {
        console.log(`\n  ${chalk.bold(`Confirmed non-followers: ${chalk.red(verified.length)}`)}\n`);
        console.log(formatNonFollowersTable(verified));
        console.log('');
        console.log(chalk.gray('  Run `instaclean unfollow` to remove them.\n'));
      }
    }
  } catch (error) {
    spinner?.fail('Verification failed');
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: (error as Error).message }));
    } else {
      console.log(formatError((error as Error).message));
    }
    process.exitCode = 1;
  }
}
