/** Instagram user, as returned for one account in the following/followers list */
export interface IGUserNode {
  id: string;
  username: string;
  full_name: string;
  is_verified: boolean;
  is_private: boolean;
  follows_viewer: boolean;
  profile_pic_url?: string;
}

/** Scan result stored to disk */
export interface ScanResult {
  scanned_at: string;
  user_id: string;
  following_count: number;
  /** Absent in scan files saved before this field was added. */
  followers_count?: number;
  users: IGUserNode[];
}

/** Profile info from web_profile_info API */
export interface IGProfileInfo {
  username: string;
  full_name: string;
  is_verified: boolean;
  is_private: boolean;
  follows_viewer: boolean;
  followed_by_viewer: boolean;
  follower_count: number;
  following_count: number;
}

/** Verification result for a single user */
export interface VerifiedUser {
  id: string;
  username: string;
  full_name: string;
  is_verified: boolean;
  follows_viewer: boolean;
  followed_by_viewer: boolean;
  /** null if account was deleted/suspended */
  exists: boolean;
}

/** Auth credentials stored in config */
export interface AuthConfig {
  ds_user_id: string;
  csrftoken: string;
  sessionid: string;
  saved_at: string;
}

/** Offline analysis user entry */
export interface OfflineUser {
  username: string;
  /** URL from the export */
  profile_url?: string;
  /** Timestamp from the export */
  timestamp?: number;
}

/** Stats summary */
export interface AccountStats {
  following: number;
  followers: number;
  mutual: number;
  not_following_back: number;
  ratio: number;
}

/** Unfollow result */
export interface UnfollowResult {
  username: string;
  user_id: string;
  success: boolean;
  error?: string;
}
