/**
 * `auth` domain (cross-cutting) — OAuth-backed web search seam.
 *
 * Owns the seam for the `WebSearch` backend. Web search needs an authenticated
 * Moonshot search provider, so it lives here beside the OAuth toolkit rather
 * than in the auth-independent `web` domain. `IWebSearchProviderService`
 * exposes the configured `WebSearchProvider`. Falls back to DuckDuckGo's free
 * public API when neither a Kimi config nor a managed OAuth provider is
 * configured, so the `WebSearch` tool is always available. Tests and hosts
 * that need a custom backend bind `IWebSearchProviderService` directly.
 * Bound at App scope.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

import type { WebSearchProvider } from './tools/web-search';

export type { WebSearchProvider, WebSearchResult } from './tools/web-search';

export interface IWebSearchProviderService {
  readonly _serviceBrand: undefined;

  getWebSearchProvider(): WebSearchProvider;
}

export const IWebSearchProviderService: ServiceIdentifier<IWebSearchProviderService> =
  createDecorator<IWebSearchProviderService>('webSearchProviderService');
