import type { ActivatePluginCommandPayload, ActivateSkillPayload, PromptPayload } from '#/rpc';
import { log as rootLog } from '#/logging/logger';
import type { Logger } from '#/logging/types';
import { extractImageCompressionCaptions } from '#/tools/support/image-compress';
import {
  createProvider,
  extractText,
  generate,
  createUserMessage,
  type ContentPart,
} from '@moonshot-ai/kosong';
import type { ModelProvider } from './provider-manager';

const MAX_TITLE_LENGTH = 200;
const MAX_LAST_PROMPT_LENGTH = 4000;
const MAX_PROMPT_FOR_TITLE = 1000;
const LLM_TITLE_SYSTEM_PROMPT =
  'You are a title generator. Given the first message of a conversation, generate a concise, descriptive title in 5-8 words. Respond with ONLY the title — no quotes, periods, or extra text.';

export function titleFromPromptMetadataText(text: string): string {
  return text.slice(0, MAX_TITLE_LENGTH);
}

/**
 * Generate a session title via an LLM call instead of trivially
 * truncating the user's first prompt. Falls back to truncation on
 * any error so title generation is never a hard failure.
 */
export async function titleFromPromptViaLLM(
  modelProvider: ModelProvider,
  model: string,
  text: string,
  log?: Logger,
): Promise<string> {
  const logg = log ?? rootLog;
  logg.info('[title:llm] titleFromPromptViaLLM called', {
    model,
    textLen: text.length,
    textPreview: text.slice(0, 80),
  });
  try {
    const resolved = modelProvider.resolveProviderConfig(model);
    const provider = createProvider(resolved.provider);
    const authResolver = modelProvider.resolveAuth?.(model, { log: logg });
    const trimmed = text.slice(0, MAX_PROMPT_FOR_TITLE);
    const userMessage = createUserMessage(trimmed);

    logg.info('[title:llm] sending generate request', {
      model,
      promptLen: trimmed.length,
      hasAuth: authResolver !== undefined,
    });

    const result = authResolver
      ? await authResolver((auth) =>
          generate(provider, LLM_TITLE_SYSTEM_PROMPT, [], [userMessage], undefined, { auth }),
        )
      : await generate(provider, LLM_TITLE_SYSTEM_PROMPT, [], [userMessage]);

    const rawTitle = extractText(result.message);
    const title = rawTitle.trim().slice(0, MAX_TITLE_LENGTH);
    logg.info('[title:llm] LLM response', {
      rawTitle,
      rawTitleLen: rawTitle.length,
      finalTitle: title,
      finishReason: result.finishReason,
    });

    if (title.length === 0) {
      logg.warn('[title:llm] empty title from LLM, falling back to truncation');
      return text.slice(0, MAX_TITLE_LENGTH);
    }
    return title;
  } catch (err) {
    logg.warn('[title:llm] LLM call failed, falling back to truncation', { err });
    return text.slice(0, MAX_TITLE_LENGTH);
  }
}

export function promptMetadataTextFromPayload(payload: PromptPayload): string | undefined {
  const parts: string[] = [];
  for (const part of payload.input) {
    const text = promptPartText(part);
    if (text !== undefined) parts.push(text);
  }
  return sanitizeAndTruncatePromptText(parts.join('\n'), MAX_LAST_PROMPT_LENGTH);
}

export function promptMetadataTextFromSkill(payload: ActivateSkillPayload): string | undefined {
  const args = payload.args?.trim();
  return sanitizeAndTruncatePromptText(
    args === undefined || args.length === 0 ? `/${payload.name}` : `/${payload.name} ${args}`,
    MAX_LAST_PROMPT_LENGTH,
  );
}

export function promptMetadataTextFromPluginCommand(
  payload: ActivatePluginCommandPayload,
): string | undefined {
  const args = payload.args?.trim();
  const command = `/${payload.pluginId}:${payload.commandName}`;
  return sanitizeAndTruncatePromptText(
    args === undefined || args.length === 0 ? command : `${command} ${args}`,
    MAX_LAST_PROMPT_LENGTH,
  );
}

function promptPartText(part: ContentPart): string | undefined {
  switch (part.type) {
    case 'text': {
      // Prompt ingestion may have annotated a compressed image with an inline
      // caption (see buildImageCompressionCaption). It is harness metadata,
      // not something the user typed, so keep it out of titles/lastPrompt.
      const { text } = extractImageCompressionCaptions(part.text);
      return text.trim().length === 0 ? undefined : text;
    }
    case 'image_url':
      return '[image]';
    case 'audio_url':
      return '[audio]';
    case 'video_url':
      return '[video]';
    case 'think':
      return undefined;
  }
}

function sanitizeAndTruncatePromptText(text: string, maxLength: number): string | undefined {
  const sanitized = text
    .replaceAll(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      '[redacted]',
    )
    .replaceAll(/\b(authorization)\s*:\s*bearer\s+\S+/gi, '$1: Bearer [redacted]')
    .replaceAll(
      /\b(api[_-]?key|token|secret|password|passwd|pwd)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      '$1=[redacted]',
    )
    .replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replaceAll(/\b[A-Za-z0-9][A-Za-z0-9+/=_-]{39,}\b/g, '[redacted]')
    .replaceAll(/\p{Cc}+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  if (sanitized.length === 0) return undefined;
  return sanitized.slice(0, maxLength);
}
