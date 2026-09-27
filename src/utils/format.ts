import chalk from 'chalk';
import type { VerifiedUser, IGUserNode, AccountStats } from '../api/types.js';

/** Format a table of non-followers for terminal display */
export function formatNonFollowersTable(users: VerifiedUser[], startIndex = 0): string {
  const lines: string[] = [];
  const header = `  ${chalk.gray('#')}   ${chalk.gray('Username'.padEnd(25))} ${chalk.gray('Full Name'.padEnd(30))} ${chalk.gray('Verified')}`;
  lines.push(header);
  lines.push(chalk.gray('  ' + '─'.repeat(75)));

  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    const idx = chalk.white(String(startIndex + i + 1).padStart(3));
    const username = chalk.cyan(`@${u.username}`.padEnd(25));
    const fullName = (u.full_name || chalk.gray('—')).toString().padEnd(30).slice(0, 30);
    const verified = u.is_verified ? chalk.blue('✓ Verified') : chalk.gray('—');
    lines.push(`  ${idx}  ${username} ${fullName} ${verified}`);
  }

  return lines.join('\n');
}

/** Format a scan result user list */
export function formatScanSummary(users: IGUserNode[], followersCount?: number): string {
  const total = users.length;
  const followBack = users.filter((u) => u.follows_viewer).length;
  const notFollowBack = total - followBack;
  const verified = users.filter((u) => u.is_verified).length;

  const lines = [
    '',
    chalk.bold('Scan Results'),
    chalk.gray('─'.repeat(40)),
    `  Following:          ${chalk.white(total)}`,
  ];
  if (followersCount !== undefined) {
    lines.push(`  Followers:          ${chalk.white(followersCount)}`);
  }
  lines.push(
    `  Follow you back:    ${chalk.green(followBack)}`,
    `  Don't follow back:  ${chalk.red(notFollowBack)}`,
    `  Verified accounts:  ${chalk.blue(verified)}`,
    '',
  );
  return lines.join('\n');
}

/** Format account stats */
export function formatStats(stats: AccountStats): string {
  return [
    '',
    chalk.bold('Account Stats'),
    chalk.gray('─'.repeat(40)),
    `  Following:              ${chalk.white(stats.following)}`,
    `  Followers:              ${chalk.white(stats.followers)}`,
    `  Mutual:                 ${chalk.green(stats.mutual)}`,
    `  Don't follow back:      ${chalk.red(stats.not_following_back)}`,
    `  Follow-back ratio:      ${chalk.yellow(stats.ratio.toFixed(1) + '%')}`,
    '',
  ].join('\n');
}

/** Format unfollow result */
export function formatUnfollowResult(username: string, success: boolean): string {
  if (success) {
    return `  ${chalk.green('✓')} Unfollowed ${chalk.cyan('@' + username)}`;
  }
  return `  ${chalk.red('✗')} Failed to unfollow ${chalk.cyan('@' + username)}`;
}

/** Format offline analysis results */
export function formatOfflineResults(
  notFollowingBack: string[],
  totalFollowers: number,
  totalFollowing: number,
): string {
  const lines: string[] = [
    '',
    chalk.bold('Offline Analysis'),
    chalk.gray('─'.repeat(40)),
    `  Followers:              ${chalk.white(totalFollowers)}`,
    `  Following:              ${chalk.white(totalFollowing)}`,
    `  Don't follow back:      ${chalk.red(notFollowingBack.length)}`,
    '',
    chalk.bold(`Accounts not following you back (${notFollowingBack.length}):`),
    chalk.gray('─'.repeat(40)),
  ];

  for (let i = 0; i < notFollowingBack.length; i++) {
    lines.push(`  ${chalk.gray(String(i + 1).padStart(4))}  ${chalk.cyan('@' + notFollowingBack[i])}`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Simple error formatting */
export function formatError(message: string): string {
  return chalk.red(`\n  ✗ ${message}\n`);
}

/** Success message */
export function formatSuccess(message: string): string {
  return chalk.green(`\n  ✓ ${message}\n`);
}

/** Warning message */
export function formatWarning(message: string): string {
  return chalk.yellow(`\n  ⚠ ${message}\n`);
}
