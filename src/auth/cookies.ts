import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { AuthConfig } from '../api/types.js';

const CONFIG_DIR = join(homedir(), '.instaclean');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');

/**
 * Prompt user for Instagram cookies interactively.
 *
 * v1 approach: user copies cookies from Chrome DevTools manually.
 * No Chrome cookie decryption needed (complex and OS-specific).
 */
export async function promptForCookies(): Promise<AuthConfig> {
  const rl = readline.createInterface({ input, output });

  console.log('');
  console.log('  To get your Instagram cookies:');
  console.log('  1. Open Chrome → go to instagram.com (make sure you\'re logged in)');
  console.log('  2. Press F12 → Application tab → Cookies → https://www.instagram.com');
  console.log('  3. Copy the values for: ds_user_id, csrftoken, sessionid');
  console.log('');

  try {
    const ds_user_id = (await rl.question('  ds_user_id: ')).trim();
    const csrftoken = (await rl.question('  csrftoken:  ')).trim();
    const sessionid = (await rl.question('  sessionid:  ')).trim();

    if (!ds_user_id || !csrftoken || !sessionid) {
      throw new Error('All three cookie values are required.');
    }

    return {
      ds_user_id,
      csrftoken,
      sessionid,
      saved_at: new Date().toISOString(),
    };
  } finally {
    rl.close();
  }
}

/** Save auth config to disk with restricted permissions (600) */
export async function saveAuth(auth: AuthConfig): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }

  await writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf-8');
  await chmod(AUTH_FILE, 0o600);
}

/** Load auth config from disk */
export async function loadAuth(): Promise<AuthConfig | null> {
  if (!existsSync(AUTH_FILE)) {
    return null;
  }

  try {
    const raw = await readFile(AUTH_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AuthConfig;

    if (!parsed.ds_user_id || !parsed.csrftoken || !parsed.sessionid) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** Build the cookie header string from auth config */
export function buildCookieHeader(auth: AuthConfig): string {
  return `ds_user_id=${auth.ds_user_id}; csrftoken=${auth.csrftoken}; sessionid=${auth.sessionid}`;
}

/** Parse cookies from a raw cookie string (e.g., from --cookies flag or env var) */
export function parseCookieString(cookieStr: string): AuthConfig | null {
  const cookies = new Map<string, string>();

  for (const part of cookieStr.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key && rest.length > 0) {
      cookies.set(key.trim(), rest.join('=').trim());
    }
  }

  const ds_user_id = cookies.get('ds_user_id');
  const csrftoken = cookies.get('csrftoken');
  const sessionid = cookies.get('sessionid');

  if (!ds_user_id || !csrftoken || !sessionid) {
    return null;
  }

  return { ds_user_id, csrftoken, sessionid, saved_at: new Date().toISOString() };
}

/** Get auth from multiple sources in priority order */
export async function getAuth(cookiesFlag?: string): Promise<AuthConfig> {
  // 1. --cookies flag
  if (cookiesFlag) {
    const auth = parseCookieString(cookiesFlag);
    if (auth) return auth;
    throw new Error('Invalid cookie string format. Expected: ds_user_id=XXX; csrftoken=XXX; sessionid=XXX');
  }

  // 2. INSTACLEAN_COOKIES env var
  const envCookies = process.env['INSTACLEAN_COOKIES'];
  if (envCookies) {
    const auth = parseCookieString(envCookies);
    if (auth) return auth;
  }

  // 3. Config file
  const saved = await loadAuth();
  if (saved) return saved;

  throw new Error(
    'No credentials found. Run `instaclean login` first, or pass --cookies flag, or set INSTACLEAN_COOKIES env var.',
  );
}

/** Get the config directory path */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/** Get the auth file path */
export function getAuthFile(): string {
  return AUTH_FILE;
}
