/**
 * `rpc` domain (L4) — registers the `llm-session-title` experimental flag.
 *
 * Gates LLM-based session title generation: when enabled, the first user prompt
 * is sent to the default model to produce a concise descriptive title instead
 * of truncating the prompt text. Off by default; enable via
 * `KIMI_CODE_EXPERIMENTAL_LLM_SESSION_TITLE`, the master
 * `KIMI_CODE_EXPERIMENTAL_FLAG`, or the `[experimental]` config section.
 * Imported for its side effect (registers the definition) from the package
 * barrel.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const LLM_SESSION_TITLE_FLAG_ID = 'llm-session-title';
export const LLM_SESSION_TITLE_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_LLM_SESSION_TITLE';

export const llmSessionTitleFlag: FlagDefinitionInput = {
  id: LLM_SESSION_TITLE_FLAG_ID,
  title: 'LLM-generated session titles',
  description:
    'Use a small LLM call to generate a descriptive session title from the first user prompt instead of truncating the prompt text directly.',
  env: LLM_SESSION_TITLE_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(llmSessionTitleFlag);
