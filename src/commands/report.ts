import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { getAuth, getConfigDir } from '../auth/cookies.js';
import { verifyProfiles } from '../api/instagram.js';
import { formatError, formatSuccess, formatWarning } from '../utils/format.js';
import type { ScanResult } from '../api/types.js';

export interface ReportOptions {
  cookies?: string;
  skipVerified?: boolean;
  verify?: boolean;
  input?: string;
  output?: string;
  json?: boolean;
}

export async function reportCommand(options: ReportOptions): Promise<void> {
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

  // Get non-followers from scan
  let nonFollowers = scanResult.users.filter((u) => !u.follows_viewer);

  if (options.skipVerified) {
    const before = nonFollowers.length;
    nonFollowers = nonFollowers.filter((u) => !u.is_verified);
    if (!options.json && before !== nonFollowers.length) {
      console.log(formatWarning(`Skipped ${before - nonFollowers.length} verified accounts`));
    }
  }

  if (nonFollowers.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, file: null, total: 0 }));
    } else {
      console.log(chalk.green('\n  Everyone you follow follows you back! 🎉\n'));
    }
    return;
  }

  // Optionally verify each one via API
  let users: Array<{
    username: string;
    full_name: string;
    is_verified: boolean;
    id: string;
  }>;

  if (options.verify) {
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

    const spinner = options.json ? null : ora('Verifying profiles...').start();

    try {
      const profiles = await verifyProfiles(
        auth,
        nonFollowers.map((u) => u.username),
        {
          onProgress: (done, total) => {
            if (spinner) spinner.text = `Verifying profiles... ${done}/${total}`;
          },
        },
      );
      spinner?.succeed('Verification complete');

      users = [];
      let unresolved = 0;
      for (const user of nonFollowers) {
        if (!profiles.has(user.username)) {
          unresolved++; // still rate-limited after retry, not confirmed deleted
          continue;
        }
        const profile = profiles.get(user.username)!;
        if (profile === null) continue; // confirmed deleted/suspended (404)
        if (profile.follows_viewer) continue; // actually follows us now

        users.push({
          id: user.id,
          username: profile.username,
          full_name: profile.full_name,
          is_verified: profile.is_verified,
        });
      }
      if (unresolved > 0 && !options.json) {
        console.log(formatWarning(`Could not verify ${unresolved} accounts (Instagram rate-limited the check) — they're left out of this report.`));
      }
    } catch (error) {
      spinner?.fail('Verification failed');
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (error as Error).message }));
      } else {
        console.log(formatError((error as Error).message));
      }
      process.exitCode = 1;
      return;
    }
  } else {
    users = nonFollowers.map((u) => ({
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      is_verified: u.is_verified,
    }));
  }

  if (users.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, file: null, total: 0 }));
    } else {
      console.log(chalk.green('\n  No confirmed non-followers after verification! 🎉\n'));
    }
    return;
  }

  // Build markdown report
  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').slice(0, 16);
  const totalFollowing = scanResult.users.length;
  const totalFollowBack = scanResult.users.filter((u) => u.follows_viewer).length;

  const lines: string[] = [
    '# Instagram Non-Followers Report',
    '',
    `> **Generated:** ${dateStr} UTC | **Following:** ${totalFollowing} | **Follow back:** ${totalFollowBack} | **Don't follow back:** ${users.length}`,
    '',
    '| # | Username | Name | Verified |',
    '|--:|----------|------|:--------:|',
  ];

  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    const username = `[@${u.username}](https://instagram.com/${u.username})`;
    const name = escapeMarkdown(u.full_name || '—');
    const verified = u.is_verified ? '✅' : '';
    lines.push(`| ${i + 1} | ${username} | ${name} | ${verified} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('*Generated by instaclean*');
  lines.push('');

  const markdown = lines.join('\n');

  // Write to file
  const outputPath =
    options.output ?? `non-followers-${now.toISOString().slice(0, 10)}.md`;
  await writeFile(outputPath, markdown, 'utf-8');

  if (options.json) {
    console.log(
      JSON.stringify({
        success: true,
        file: outputPath,
        total: users.length,
        verified: options.verify ?? false,
      }),
    );
  } else {
    console.log(formatSuccess(`Report saved to ${chalk.white(outputPath)}`));
    console.log(
      chalk.gray(`  ${users.length} non-followers listed with profile links\n`),
    );
  }
}

/** Escape pipe characters in markdown table cells */
function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|');
}
