import chalk from 'chalk';
import ora from 'ora';
import { promptForCookies, saveAuth, parseCookieString, getAuthFile } from '../auth/cookies.js';
import { validateAuth } from '../api/instagram.js';
import { formatError, formatSuccess } from '../utils/format.js';

export interface LoginOptions {
  cookies?: string;
  json?: boolean;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  let auth;

  if (options.cookies) {
    // Parse cookies from flag
    const parsed = parseCookieString(options.cookies);
    if (!parsed) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: 'Invalid cookie format' }));
      } else {
        console.log(formatError('Invalid cookie format. Expected: ds_user_id=XXX; csrftoken=XXX; sessionid=XXX'));
      }
      process.exitCode = 1;
      return;
    }
    auth = parsed;
  } else {
    // Interactive prompt
    auth = await promptForCookies();
  }

  // Validate credentials
  const spinner = options.json ? null : ora('Validating credentials...').start();

  const validation = await validateAuth(auth);

  if (!validation.valid) {
    spinner?.fail('Invalid credentials');
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: 'Credentials validation failed' }));
    } else {
      console.log(formatError('Could not validate credentials. Check that your cookies are correct and your session is active.'));
    }
    process.exitCode = 1;
    return;
  }

  // Save to config
  await saveAuth(auth);
  spinner?.succeed(`Logged in as ${chalk.cyan('@' + (validation.username ?? auth.ds_user_id))}`);

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      username: validation.username ?? null,
      user_id: auth.ds_user_id,
      config_file: getAuthFile(),
    }));
  } else {
    console.log(formatSuccess(`Credentials saved to ${chalk.gray(getAuthFile())}`));
    console.log(chalk.gray('  File permissions set to 600 (owner-only read/write).\n'));
  }
}
