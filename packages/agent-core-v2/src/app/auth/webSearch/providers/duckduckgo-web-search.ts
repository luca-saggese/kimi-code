/**
 * DuckDuckGo Instant Answer provider — free, no API key required.
 *
 * Uses the public `api.duckduckgo.com` endpoint. The JSON response includes
 * an Abstract + RelatedTopics (each with Text / FirstURL). This is not a
 * full-text web index but provides enough signal for the agent to find
 * relevant links and summaries.
 */

import type { WebSearchProvider, WebSearchResult } from '../tools/web-search';

interface DuckDuckGoRelatedTopic {
    Text?: string;
    FirstURL?: string;
}

interface DuckDuckGoResponse {
    Abstract?: string;
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    Heading?: string;
    RelatedTopics?: (DuckDuckGoRelatedTopic | { Name?: string; Topics?: DuckDuckGoRelatedTopic[] })[];
    Results?: DuckDuckGoRelatedTopic[];
}

export class DuckDuckGoWebSearchProvider implements WebSearchProvider {
    private readonly fetchImpl: typeof fetch;

    constructor(fetchImpl?: typeof fetch) {
        this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
    }

    async search(
        query: string,
        options?: { toolCallId?: string; signal?: AbortSignal },
    ): Promise<WebSearchResult[]> {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

        const response = await this.fetchImpl(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: options?.signal,
        });

        if (response.status !== 200) {
            const detail = await safeReadText(response);
            throw new Error(
                `DuckDuckGo search request failed: HTTP ${String(response.status)}. ${detail}`.trim(),
            );
        }

        const json = (await response.json()) as DuckDuckGoResponse;
        const results: WebSearchResult[] = [];

        // Main abstract
        if (json.AbstractText && json.AbstractText.trim().length > 0) {
            results.push({
                title: json.Heading ?? json.AbstractSource ?? 'Abstract',
                url: json.AbstractURL ?? '',
                snippet: json.AbstractText,
            });
        }

        // Related topics (flatten disambiguation groups)
        for (const entry of json.RelatedTopics ?? []) {
            if ('Topics' in entry && Array.isArray(entry.Topics)) {
                for (const topic of entry.Topics) {
                    if (topic.Text && topic.FirstURL) {
                        results.push({
                            title: entry.Name ?? topic.Text.slice(0, 60),
                            url: topic.FirstURL,
                            snippet: topic.Text,
                        });
                    }
                }
            } else if ('Text' in entry && entry.Text && entry.FirstURL) {
                results.push({
                    title: entry.Text.slice(0, 60),
                    url: entry.FirstURL,
                    snippet: entry.Text,
                });
            }
        }

        // External results when available
        for (const r of json.Results ?? []) {
            if (r.Text && r.FirstURL) {
                results.push({
                    title: r.Text.slice(0, 60),
                    url: r.FirstURL,
                    snippet: r.Text,
                });
            }
        }

        if (results.length === 0) {
            results.push({
                title: `Search: ${query}`,
                url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                snippet: 'No instant answer found. Try the web link for full results.',
            });
        }

        return results;
    }
}

async function safeReadText(response: Response): Promise<string> {
    try {
        return await response.text();
    } catch {
        return '';
    }
}
