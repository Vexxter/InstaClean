import 'dotenv/config';
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { scanCommand } from './commands/scan.js';
import { checkCommand } from './commands/check.js';
import { unfollowCommand } from './commands/unfollow.js';
import { offlineCommand } from './commands/offline.js';
import { statsCommand } from './commands/stats.js';
import { reportCommand } from './commands/report.js';

const program = new Command();

program
  .name('instaclean')
  .description('Instagram following/followers analytics for your terminal — scan, verify, report, and optionally clean up who you follow.')
  .version('1.1.0');

// Login command
program
  .command('login')
  .description('Save your Instagram session cookies for API access')
  .option('--cookies <string>', 'Cookie string: "ds_user_id=XXX; csrftoken=XXX; sessionid=XXX"')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await loginCommand(options);
  });

// Scan command
program
  .command('scan')
  .description('Scan your following and followers lists via Instagram\'s friendships API')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('-o, --output <path>', 'Output file path (default: ~/.instaclean/scan-results.json)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await scanCommand(options);
  });

// Check command
program
  .command('check')
  .description('Verify non-followers in real-time via Instagram\'s profile API')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('--skip-verified', 'Skip verified accounts (celebrities, brands)')
  .option('-i, --input <path>', 'Scan results file to use')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await checkCommand(options);
  });

// Unfollow command
program
  .command('unfollow')
  .description('Unfollow accounts that don\'t follow you back')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('-b, --batch <number>', 'Batch size for interactive approval', '10')
  .option('--interactive', 'Prompt for approval per batch (default: true)')
  .option('--no-interactive', 'Skip approval prompts (use with caution)')
  .option('--skip-verified', 'Skip verified accounts')
  .option('--skip-verify', 'Skip the live re-verification pass and unfollow straight from scan results')
  .option('--limit <number>', 'Max accounts to unfollow in this run')
  .option('--interval <seconds>', 'Seconds between unfollows (drip mode; e.g. 180 for ~20/hour)')
  .option('--dry-run', 'Show what would be unfollowed without doing it')
  .option('-i, --input <path>', 'Scan results file to use')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await unfollowCommand({
      ...options,
      batch: parseInt(options.batch, 10) || 10,
      limit: options.limit ? parseInt(options.limit, 10) : undefined,
      interval: options.interval ? parseInt(options.interval, 10) : undefined,
    });
  });

// Offline command
program
  .command('offline')
  .description('Analyze Instagram data export (no API calls needed)')
  .argument('<followers>', 'Path to followers JSON file (e.g., followers_1.json)')
  .argument('<following>', 'Path to following JSON file (e.g., following.json)')
  .option('--json', 'Output as JSON')
  .action(async (followers, following, options) => {
    await offlineCommand(followers, following, options);
  });

// Report command
program
  .command('report')
  .description('Generate a Markdown report of non-followers with profile links')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('--skip-verified', 'Skip verified accounts (celebrities, brands)')
  .option('--verify', 'Verify each account via API before including (slower but accurate)')
  .option('-i, --input <path>', 'Scan results file to use')
  .option('-o, --output <path>', 'Output file path (default: non-followers-YYYY-MM-DD.md)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await reportCommand(options);
  });

// Stats command
program
  .command('stats')
  .description('Show account stats summary from last scan')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await statsCommand(options);
  });

program.parse();
