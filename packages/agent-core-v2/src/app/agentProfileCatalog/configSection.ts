/**
 * `agentProfileCatalog` domain (L3) — registers the `defaultAgentProfile` config
 * section into `config`.
 *
 * Lets users override the default agent profile via `~/.kimi-code/config.toml`:
 *
 * ```toml
 * defaultAgentProfile = "brassicolo"
 * ```
 *
 * When absent, the hardcoded `DEFAULT_AGENT_PROFILE_NAME` (`agent`) is used.
 * Self-registers at module load via `registerConfigSection`.
 */

import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const DEFAULT_AGENT_PROFILE_SECTION = 'defaultAgentProfile';

export const DefaultAgentProfileSchema = z.string();

registerConfigSection(DEFAULT_AGENT_PROFILE_SECTION, DefaultAgentProfileSchema);
