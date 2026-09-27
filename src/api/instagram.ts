import type {
  AuthConfig,
  IGProfileInfo,
  IGUserNode,
  UnfollowResult,
} from './types.js';
import { buildCookieHeader } from '../auth/cookies.js';
import { createRateLimiter, RATE_LIMITS, sleep } from '../utils/rate-limit.js';

const IG_APP_ID = '936619743392459';
const GRAPHQL_QUERY_HASH = '3dec7e2c57367ef3da3d987d89f9dbc8';

/** Common headers for all Instagram requests */
function baseHeaders(auth: AuthConfig): Record<string, string> {
  return {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cookie': buildCookieHeader(auth),
    'x-ig-app-id': IG_APP_ID,
    'x-csrftoken': auth.csrftoken,
    'x-requested-with': 'XMLHttpRequest',
    'referer': 'https://www.instagram.com/',
    'origin': 'https://www.instagram.com',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  };
}

interface IGFriendshipUser {
  pk_id?: string;
  pk?: string;
  id?: string;
  username: string;
  full_name: string;
  is_verified: boolean;
  is_private: boolean;
}

interface IGFriendshipListResponse {
  users: IGFriendshipUser[];
  next_max_id?: string;
  has_more?: boolean;
  status?: string;
}

/**
 * Fetches a full friendship list (following or followers) via Instagram's
 * internal friendships API, paginating with `max_id` until exhausted.
 *
 * The legacy GraphQL `edge_follow` query still returns a `count` but no
 * longer returns `edges` data (Instagram deprecated the payload while
 * leaving the count as a decoy). This endpoint is what the web app itself
 * now uses to render the following/followers lists.
 */
async function fetchFriendshipList(
  auth: AuthConfig,
  kind: 'following' | 'followers',
  options: {
    onProgress?: (fetched: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<IGFriendshipUser[]> {
  const users: IGFriendshipUser[] = [];
  const seenIds = new Set<string>();
  let maxId: string | undefined;
  let hasMore = true;
  const wait = createRateLimiter(RATE_LIMITS.scan);

  while (hasMore) {
    if (options.signal?.aborted) break;

    await wait();

    const url = new URL(`https://www.instagram.com/api/v1/friendships/${auth.ds_user_id}/${kind}/`);
    url.searchParams.set('count', '50');
    if (maxId) url.searchParams.set('max_id', maxId);

    const response = await fetch(url, {
      headers: baseHeaders(auth),
      signal: options.signal,
    });

    if (response.status === 429) {
      await sleep(60_000);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentication failed (HTTP ${response.status}). Your session may have expired. Run \`instaclean login\` again.`,
      );
    }

    if (!response.ok) {
      throw new Error(`Instagram API error: HTTP ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as IGFriendshipListResponse;

    if (json.status !== 'ok' || !Array.isArray(json.users)) {
      throw new Error('Unexpected API response format. Your session may have expired.');
    }

    // Instagram's cursor pagination is inclusive at the boundary: the last
    // item of a page can reappear as the first item of the next one.
    for (const user of json.users) {
      const id = user.pk_id ?? user.pk ?? user.id;
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      users.push(user);
    }
    hasMore = json.has_more === true && !!json.next_max_id;
    maxId = json.next_max_id;

    options.onProgress?.(users.length);
  }

  return users;
}

/** Result of a following/followers scan. */
export interface ScanFollowingResult {
  users: IGUserNode[];
  followersCount: number;
}

/**
 * Scan the user's following list.
 *
 * Fetches both the following and followers lists (paginated 50 at a time via
 * the friendships API) and cross-references them to tag each followed
 * account with `follows_viewer`. Also returns the followers count directly,
 * since it's already fetched for that cross-reference.
 */
export async function scanFollowing(
  auth: AuthConfig,
  options: {
    onProgress?: (fetched: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ScanFollowingResult> {
  const following = await fetchFriendshipList(auth, 'following', {
    signal: options.signal,
    onProgress: (fetched) => options.onProgress?.(fetched, fetched),
  });

  const followers = await fetchFriendshipList(auth, 'followers', {
    signal: options.signal,
    onProgress: (fetched) => options.onProgress?.(following.length, following.length + fetched),
  });

  const followerIds = new Set(followers.map((u) => u.pk_id ?? u.pk ?? u.id));

  const users = following.map((u) => {
    const id = u.pk_id ?? u.pk ?? u.id ?? '';
    return {
      id,
      username: u.username,
      full_name: u.full_name,
      is_verified: u.is_verified,
      is_private: u.is_private,
      follows_viewer: followerIds.has(id),
    };
  });

  return { users, followersCount: followers.length };
}

/**
 * Verify a single user's profile via the web_profile_info API.
 *
 * Returns full profile info including follow relationship.
 */
export async function verifyProfile(
  auth: AuthConfig,
  username: string,
): Promise<IGProfileInfo | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: baseHeaders(auth),
  });

  if (response.status === 404) {
    return null; // Account deleted/suspended
  }

  if (response.status === 429) {
    throw new Error('Rate limited by Instagram. Wait a few minutes and try again.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('Authentication failed. Run `instaclean login` again.');
  }

  if (!response.ok) {
    throw new Error(`Instagram API error: HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: {
      user?: {
        username: string;
        full_name: string;
        is_verified: boolean;
        is_private: boolean;
        follows_viewer: boolean;
        followed_by_viewer: boolean;
        edge_followed_by?: { count: number };
        edge_follow?: { count: number };
      };
    };
  };

  const user = json?.data?.user;
  if (!user) return null;

  return {
    username: user.username,
    full_name: user.full_name,
    is_verified: user.is_verified,
    is_private: user.is_private,
    follows_viewer: user.follows_viewer,
    followed_by_viewer: user.followed_by_viewer,
    follower_count: user.edge_followed_by?.count ?? 0,
    following_count: user.edge_follow?.count ?? 0,
  };
}

/**
 * Verify multiple users with rate limiting.
 *
 * The returned map only has entries for usernames that were actually
 * resolved: `null` means Instagram confirmed the account is gone (404),
 * while a missing key means verification couldn't be completed (e.g. still
 * rate-limited after the retry). Callers should treat "missing" and "null"
 * differently — collapsing them mislabels an unresolved account as deleted.
 */
export async function verifyProfiles(
  auth: AuthConfig,
  usernames: string[],
  options: {
    onProgress?: (verified: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<Map<string, IGProfileInfo | null>> {
  const results = new Map<string, IGProfileInfo | null>();
  const wait = createRateLimiter(RATE_LIMITS.verify);

  for (let i = 0; i < usernames.length; i++) {
    if (options.signal?.aborted) break;

    const username = usernames[i]!;
    await wait();

    try {
      const profile = await verifyProfile(auth, username);
      results.set(username, profile);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Rate limited')) {
        // Wait and retry once
        await sleep(60_000);
        try {
          const profile = await verifyProfile(auth, username);
          results.set(username, profile);
        } catch {
          // Still failing (most likely still rate-limited) — leave
          // unresolved rather than mislabeling as a confirmed-deleted account.
        }
      } else {
        throw error;
      }
    }

    options.onProgress?.(i + 1, usernames.length);
  }

  return results;
}

/** Marker error for Instagram's soft anti-automation throttle. */
export const THROTTLED = 'throttled';

/**
 * Unfollow a single user.
 *
 * Uses /web/friendships/{id}/unfollow/. The /api/v1/friendships/destroy/
 * endpoint is not a live route on www.instagram.com — it answers with the
 * HTML app shell rather than JSON, which made every unfollow look like a
 * failure.
 *
 * When Instagram soft-throttles, it answers 200 with that same HTML shell
 * instead of an error status, so content-type is what distinguishes a
 * throttle from a real response.
 */
export async function unfollowUser(
  auth: AuthConfig,
  userId: string,
  username: string,
): Promise<UnfollowResult> {
  const url = `https://www.instagram.com/web/friendships/${userId}/unfollow/`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...baseHeaders(auth),
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.status === 429) {
      return { username, user_id: userId, success: false, error: THROTTLED };
    }

    if (response.status === 401 || response.status === 403) {
      return { username, user_id: userId, success: false, error: 'Session expired. Run login again.' };
    }

    if (!response.ok) {
      return { username, user_id: userId, success: false, error: `HTTP ${response.status}` };
    }

    if (!(response.headers.get('content-type') ?? '').includes('json')) {
      return { username, user_id: userId, success: false, error: THROTTLED };
    }

    const body = (await response.json()) as { status?: string };
    if (body?.status === 'ok') {
      return { username, user_id: userId, success: true };
    }

    return { username, user_id: userId, success: false, error: `Unexpected response: ${JSON.stringify(body).slice(0, 80)}` };
  } catch (error) {
    return {
      username,
      user_id: userId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate that the current auth credentials are still working.
 *
 * Calls the profile API for the logged-in user.
 */
export async function validateAuth(auth: AuthConfig): Promise<{ valid: boolean; username?: string }> {
  try {
    // Use the same GraphQL endpoint as scanFollowing to validate — the
    // /api/v1/users/{id}/info/ endpoint has started returning an HTML
    // anti-bot checkpoint page instead of JSON even for valid sessions.
    const variables = { id: auth.ds_user_id, include_reel: true, fetch_mutual: false, first: 1 };
    const url = `https://www.instagram.com/graphql/query/?query_hash=${GRAPHQL_QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
    const response = await fetch(url, {
      headers: baseHeaders(auth),
    });

    if (!response.ok) {
      return { valid: false };
    }

    const json = (await response.json()) as { status?: string };
    if (json?.status !== 'ok') {
      return { valid: false };
    }

    return { valid: true };
  } catch {
    return { valid: false };
  }
}
