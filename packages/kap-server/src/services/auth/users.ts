/**
 * Multi-user credential store.
 *
 * Reads a `users.json` file from the Kimi home directory containing
 * bcrypt-hashed passwords for registered users:
 *
 * ```json
 * {
 *   "alice": "$2a$12$...",
 *   "bob": "$2a$12$..."
 * }
 * ```
 *
 * Passwords are hashed with bcryptjs (pure JS, no native deps).
 * The file is re-read on every validation so adding/removing users
 * takes effect immediately without a server restart.
 */

import bcrypt from 'bcryptjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface UserEntry {
  readonly username: string;
  readonly hash: string;
}

export interface UserStore {
  /** Validate username + password. Returns true if credentials match. */
  validate(username: string, password: string): Promise<boolean>;
  /** List all registered usernames. */
  listUsers(): string[];
}

export function createUserStore(homeDir: string): UserStore {
  const usersPath = join(homeDir, 'users.json');

  function readUsers(): Record<string, string> {
    if (!existsSync(usersPath)) return {};
    try {
      const raw = readFileSync(usersPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > 0) {
          result[key] = value;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  return {
    async validate(username: string, password: string): Promise<boolean> {
      const users = readUsers();
      const hash = users[username];
      if (hash === undefined) return false;
      return bcrypt.compare(password, hash);
    },

    listUsers(): string[] {
      return Object.keys(readUsers());
    },
  };
}

/** CLI helper to hash a password for users.json. */
export async function hashUserPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
