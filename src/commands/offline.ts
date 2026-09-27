import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { formatOfflineResults, formatError } from '../utils/format.js';

export interface OfflineOptions {
  json?: boolean;
}

/**
 * Instagram data export JSON formats:
 *
 * followers_1.json (or followers_and_following/followers_1.json):
 * [
 *   {
 *     "title": "",
 *     "media_list_data": [],
 *     "string_list_data": [
 *       { "href": "https://www.instagram.com/username", "value": "username", "timestamp": 1234567890 }
 *     ]
 *   }
 * ]
 *
 * following.json (or followers_and_following/following.json):
 * {
 *   "relationships_following": [
 *     {
 *       "title": "username",
 *       "media_list_data": [],
 *       "string_list_data": [
 *         { "href": "https://www.instagram.com/username", "value": "username", "timestamp": 1234567890 }
 *       ]
 *     }
 *   ]
 * }
 */

interface FollowerEntry {
  title?: string;
  string_list_data?: Array<{
    href?: string;
    value: string;
    timestamp?: number;
  }>;
}

interface FollowingJson {
  relationships_following?: FollowerEntry[];
}

function extractUsernames(entries: FollowerEntry[]): string[] {
  const usernames: string[] = [];

  for (const entry of entries) {
    // Try string_list_data first (standard format)
    if (entry.string_list_data && entry.string_list_data.length > 0) {
      const value = entry.string_list_data[0]?.value;
      if (value) {
        usernames.push(value.toLowerCase());
      }
    }
    // Fallback to title field
    else if (entry.title) {
      usernames.push(entry.title.toLowerCase());
    }
  }

  return usernames;
}

export async function offlineCommand(
  followersPath: string,
  followingPath: string,
  options: OfflineOptions,
): Promise<void> {
  // Parse followers file
  let followerUsernames: string[];
  try {
    const raw = await readFile(followersPath, 'utf-8');
    const parsed = JSON.parse(raw) as FollowerEntry[] | FollowingJson;

    if (Array.isArray(parsed)) {
      // Direct array format (followers_1.json)
      followerUsernames = extractUsernames(parsed);
    } else if (parsed && typeof parsed === 'object' && 'relationships_following' in parsed) {
      // Following-style format (shouldn't be followers but handle it)
      followerUsernames = extractUsernames(parsed.relationships_following ?? []);
    } else {
      throw new Error('Unrecognized format');
    }
  } catch (error) {
    const msg = `Failed to parse followers file: ${(error as Error).message}`;
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: msg }));
    } else {
      console.log(formatError(msg));
      console.log(chalk.gray('  Expected Instagram data export format (followers_1.json)\n'));
    }
    process.exitCode = 1;
    return;
  }

  // Parse following file
  let followingUsernames: string[];
  try {
    const raw = await readFile(followingPath, 'utf-8');
    const parsed = JSON.parse(raw) as FollowerEntry[] | FollowingJson;

    if (Array.isArray(parsed)) {
      // Direct array format
      followingUsernames = extractUsernames(parsed);
    } else if (parsed && typeof parsed === 'object' && 'relationships_following' in parsed) {
      // Standard following.json format
      followingUsernames = extractUsernames(parsed.relationships_following ?? []);
    } else {
      throw new Error('Unrecognized format');
    }
  } catch (error) {
    const msg = `Failed to parse following file: ${(error as Error).message}`;
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: msg }));
    } else {
      console.log(formatError(msg));
      console.log(chalk.gray('  Expected Instagram data export format (following.json)\n'));
    }
    process.exitCode = 1;
    return;
  }

  // Compute difference: following - followers = not following back
  const followerSet = new Set(followerUsernames);
  const notFollowingBack = followingUsernames
    .filter((u) => !followerSet.has(u))
    .sort();

  // Also compute mutual
  const followingSet = new Set(followingUsernames);
  const mutual = followerUsernames.filter((u) => followingSet.has(u));

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      followers: followerUsernames.length,
      following: followingUsernames.length,
      mutual: mutual.length,
      not_following_back: notFollowingBack.length,
      ratio: followingUsernames.length > 0
        ? Math.round((mutual.length / followingUsernames.length) * 1000) / 10
        : 0,
      users: notFollowingBack,
    }));
  } else {
    console.log(formatOfflineResults(notFollowingBack, followerUsernames.length, followingUsernames.length));
    console.log(chalk.gray(`  Mutual followers: ${mutual.length}`));
    console.log(chalk.gray(`  Follow-back ratio: ${followingUsernames.length > 0 ? ((mutual.length / followingUsernames.length) * 100).toFixed(1) : 0}%\n`));
  }
}
