// apps/kimi-web/src/api/daemon/serverAuth.ts
// Minimal server-transport credential store for the Web UI.
//
// The local server requires a bearer credential on every non-bypass API
// and WebSocket call (the persistent server token, or the KIMI_CODE_PASSWORD
// password). The Web UI obtains that credential in one of three ways:
//   1. From the URL fragment (`#token=<...>`) that `kimi web` appends when it
//      opens the browser.
//   2. From a token the user types into the ServerAuthDialog modal.
//   3. From a username + password pair (Basic auth) the user enters, stored
//      as base64(username:password).
//
// The credential is held in memory and mirrored to localStorage for up to 7
// days so it survives tab close and browser restarts.

const STORAGE_KEY = 'kimi-web.server-credential';
const STORAGE_KEY_BASIC = 'kimi-web.server-credential-basic';
const FRAGMENT_PARAM = 'token';
const CREDENTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredCredential {
  version: 1;
  credential: string;
  expiresAt: number;
}

export interface AuthHeader {
  readonly header: 'Authorization';
  readonly value: string;
}

let memory: StoredCredential | undefined;
let basicMemory: StoredCredential | undefined;

type AuthRequiredListener = () => void;
const listeners = new Set<AuthRequiredListener>();

function readFragmentToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const hash = window.location.hash ?? '';
  if (!hash.startsWith('#')) return undefined;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get(FRAGMENT_PARAM);
  if (!token) return undefined;
  // Scrub the fragment (keep path + query) so the token is not left in the
  // address bar, browser history, or any screenshot of the window.
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}`,
  );
  return token;
}

function createStoredCredential(credential: string): StoredCredential {
  return {
    version: 1,
    credential,
    expiresAt: Date.now() + CREDENTIAL_TTL_MS,
  };
}

function encodeStoredCredential(stored: StoredCredential): string {
  return JSON.stringify(stored);
}

function decodeStoredCredential(raw: string): StoredCredential | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      record['version'] !== 1 ||
      typeof record['credential'] !== 'string' ||
      record['credential'].length === 0 ||
      typeof record['expiresAt'] !== 'number' ||
      !Number.isFinite(record['expiresAt'])
    ) {
      return undefined;
    }
    return {
      version: 1,
      credential: record['credential'],
      expiresAt: record['expiresAt'],
    };
  } catch {
    return undefined;
  }
}

function persistCredential(stored: StoredCredential, key: string): void {
  globalThis.localStorage?.setItem(key, encodeStoredCredential(stored));
}

function loadStored(key: string): StoredCredential | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw) {
      const stored = decodeStoredCredential(raw);
      if (stored === undefined) {
        const migrated = createStoredCredential(raw);
        try { persistCredential(migrated, key); } catch { /* ignore */ }
        return migrated;
      }
      if (stored.expiresAt > Date.now()) return stored;
      globalThis.sessionStorage?.removeItem(key);
      if (globalThis.localStorage?.getItem(key) === raw) {
        globalThis.localStorage?.removeItem(key);
      }
      return undefined;
    }
    const legacy = globalThis.sessionStorage?.getItem(key);
    if (legacy) {
      const migrated = createStoredCredential(legacy);
      try { persistCredential(migrated, key); globalThis.sessionStorage?.removeItem(key); } catch { /* ignore */ }
      return migrated;
    }
    return undefined;
  } catch { return undefined; }
}

/**
 * Initialize the credential store. Call once at app boot (before the first
 * API/WS call). Prefers a fragment token over stored ones. Returns true if a
 * credential is available afterwards.
 */
export function initServerAuth(): boolean {
  const fragment = readFragmentToken();
  if (fragment) {
    setCredential(fragment);
    return true;
  }
  memory = loadStored(STORAGE_KEY);
  basicMemory = loadStored(STORAGE_KEY_BASIC);
  return memory !== undefined || basicMemory !== undefined;
}

/** Current unexpired Bearer token credential, or undefined. */
export function getCredential(): string | undefined {
  if (memory === undefined) return undefined;
  if (memory.expiresAt <= Date.now()) {
    clearExpiredCredential(memory, STORAGE_KEY, 'memory');
    return undefined;
  }
  return memory.credential;
}

/** Current unexpired Basic auth credential, or undefined. */
export function getBasicCredential(): string | undefined {
  if (basicMemory === undefined) return undefined;
  if (basicMemory.expiresAt <= Date.now()) {
    clearExpiredCredential(basicMemory, STORAGE_KEY_BASIC, 'basicMemory');
    return undefined;
  }
  return basicMemory.credential;
}

/**
 * Return the Authorization header to attach to every REST/WS request.
 * If Basic auth is present, uses `Authorization: Basic <base64>`.
 * If Bearer token is present, uses `Authorization: Bearer <token>`.
 */
export function getAuthHeader(): AuthHeader | undefined {
  const basic = getBasicCredential();
  if (basic !== undefined) {
    return { header: 'Authorization', value: `Basic ${basic}` };
  }
  const bearer = getCredential();
  if (bearer !== undefined) {
    return { header: 'Authorization', value: `Bearer ${bearer}` };
  }
  return undefined;
}

/** Whether a Basic auth (user+password) credential is currently active. */
export function hasBasicAuth(): boolean {
  return getBasicCredential() !== undefined;
}

function clearExpiredCredential(expired: StoredCredential, key: string, slot: 'memory' | 'basicMemory'): void {
  if (slot === 'memory') memory = undefined;
  else basicMemory = undefined;
  try {
    globalThis.sessionStorage?.removeItem(key);
    const raw = globalThis.localStorage?.getItem(key);
    const stored = raw === null || raw === undefined ? undefined : decodeStoredCredential(raw);
    const matchesExpired = stored === undefined
      ? raw === expired.credential
      : stored.credential === expired.credential && stored.expiresAt === expired.expiresAt;
    if (matchesExpired) globalThis.localStorage?.removeItem(key);
  } catch { /* ignore */ }
}

/** Store a Bearer token credential. */
export function setCredential(value: string): void {
  const stored = createStoredCredential(value);
  memory = stored;
  try { persistCredential(stored, STORAGE_KEY); } catch { /* ignore */ }
}

/** Store a Basic auth credential (base64(user:password)). */
export function setBasicCredential(value: string): void {
  const stored = createStoredCredential(value);
  basicMemory = stored;
  try { persistCredential(stored, STORAGE_KEY_BASIC); } catch { /* ignore */ }
}

/** Store both username + password as Basic auth. */
export function setUserPass(username: string, password: string): void {
  const encoded = btoa(`${username}:${password}`);
  setBasicCredential(encoded);
}

/** Drop all credentials (memory + localStorage). */
export function clearCredential(): void {
  clearSlot(memory, STORAGE_KEY);
  clearSlot(basicMemory, STORAGE_KEY_BASIC);
  memory = undefined;
  basicMemory = undefined;
}

function clearSlot(rejected: StoredCredential | undefined, key: string): void {
  if (rejected === undefined) return;
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const stored = raw === null || raw === undefined ? undefined : decodeStoredCredential(raw);
    const persistedCredential = stored?.credential ?? raw;
    const matchesRejected = persistedCredential === rejected.credential;
    if (matchesRejected) globalThis.localStorage?.removeItem(key);
    globalThis.sessionStorage?.removeItem(key);
  } catch { /* ignore */ }
}

export function onAuthRequired(listener: AuthRequiredListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function markAuthRequired(): void {
  clearCredential();
  for (const listener of listeners) {
    try { listener(); } catch { /* ignore */ }
  }
}
