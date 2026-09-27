import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { getAuth, getConfigDir } from '../auth/cookies.js';
import { scanFollowing } from '../api/instagram.js';
import { formatScanSummary, formatError, formatSuccess } from '../utils/format.js';
import type { ScanResult } from '../api/types.js';

export interface ScanOptions {
  cookies?: string;
  output?: string;
  json?: boolean;
}

export async function scanCommand(options: ScanOptions): Promise<void> {
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

  const spinner = options.json ? null : ora('Scanning following list...').start();

  try {
    const { users, followersCount } = await scanFollowing(auth, {
      onProgress: (fetched, total) => {
        if (spinner) {
          spinner.text = `Scanning following list... ${fetched}/${total}`;
        }
      },
    });

    spinner?.succeed(`Scanned ${users.length} accounts`);

    // Save scan results
    const scanResult: ScanResult = {
      scanned_at: new Date().toISOString(),
      user_id: auth.ds_user_id,
      following_count: users.length,
      followers_count: followersCount,
      users,
    };

    const outputPath = options.output ?? join(getConfigDir(), 'scan-results.json');
    await writeFile(outputPath, JSON.stringify(scanResult, null, 2), 'utf-8');

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        following_count: users.length,
        followers_count: followersCount,
        follows_back: users.filter((u) => u.follows_viewer).length,
        not_following_back: users.filter((u) => !u.follows_viewer).length,
        verified: users.filter((u) => u.is_verified).length,
        output_file: outputPath,
      }));
    } else {
      console.log(formatScanSummary(users, followersCount));
      console.log(formatSuccess(`Full results saved to ${chalk.gray(outputPath)}`));
    }
  } catch (error) {
    spinner?.fail('Scan failed');
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: (error as Error).message }));
    } else {
      console.log(formatError((error as Error).message));
    }
    process.exitCode = 1;
  }
}
