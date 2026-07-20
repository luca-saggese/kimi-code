/**
 * Unified credential validator.
 *
 * One persistent bearer token (held by {@link IAuthTokenService}) protects every
 * route. An optional `rpcToken` may be accepted as an *additional* credential
 * for the `/api/v2` RPC surface (REST + WebSocket); it is never required and
 * never the only gate. The validator returns true when the presented candidate
 * matches the persistent token / password (via {@link IAuthTokenService.isValid})
 * OR, when configured, the `rpcToken` (compared timing-safely).
 *
 * Shared by the global HTTP auth hook, the WebSocket upgrade handler, and the
 * post-connect handshakes so the same credential is accepted everywhere (no
 * "passes upgrade with the bearer then fails the handshake on rpcToken"
 * mismatch).
 */

import { timingSafeEqual } from 'node:crypto';

import type { IAuthTokenService } from './authTokenService';
import type { UserStore } from './users';

export type CredentialValidator = (candidate: string) => Promise<boolean>;

function timingSafeMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCredentialValidator(
  authTokenService: IAuthTokenService,
  rpcToken?: string,
  userStore?: UserStore,
): CredentialValidator {
  return async (candidate) => {
    if (await authTokenService.isValid(candidate)) return true;
    if (rpcToken !== undefined && candidate.length > 0 && timingSafeMatch(candidate, rpcToken)) {
      return true;
    }
    // Multi-user Basic Auth support: candidate is "base64(username:password)"
    if (userStore !== undefined && candidate.length > 0) {
      return validateBasicAuth(candidate, userStore);
    }
    return false;
  };
}

async function validateBasicAuth(candidate: string, store: UserStore): Promise<boolean> {
  const decoded = decodeBasicAuth(candidate);
  if (decoded === null) return false;
  const { username, password } = decoded;
  return store.validate(username, password);
}

export interface BasicAuthCredentials {
  readonly username: string;
  readonly password: string;
}

/** Decode "base64(username:password)" into { username, password }. Returns null on failure. */
function decodeBasicAuth(credentials: string): BasicAuthCredentials | null {
  let decoded: string;
  try {
    decoded = Buffer.from(credentials, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon <= 0 || colon === decoded.length - 1) return null;
  return {
    username: decoded.substring(0, colon),
    password: decoded.substring(colon + 1),
  };
}
