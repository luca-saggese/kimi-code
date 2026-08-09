/**
 * Slash command `/agent`: switch the active agent profile.
 *
 * With no argument it opens a searchable picker of the available agent
 * profiles (name + description / when-to-use); with a profile name it applies
 * that profile directly. The chosen profile is applied immediately (the new
 * system prompt and tool set take effect from the next turn) and reflected in
 * the welcome panel.
 */

import { AgentSelectorComponent } from '#/tui/components/dialogs/agent-selector';
import { NO_ACTIVE_SESSION_MESSAGE } from '#/tui/constant/kimi-tui';
import { formatErrorMessage } from '#/tui/utils/event-payload';
import type { SlashCommandHost } from './dispatch';

const DEFAULT_AGENT = 'agent';

function hasConversationHistory(host: SlashCommandHost): boolean {
  return host.state.transcriptEntries.some(
    (entry) => entry.kind === 'user' && entry.bullet !== '',
  );
}

/** Warn that re-rendering the system prompt invalidates the prompt cache. */
function profileSwitchWarning(host: SlashCommandHost): string | undefined {
  return hasConversationHistory(host)
    ? 'Note: Switching agent re-renders the system prompt and invalidates the existing prompt cache. Use /new to avoid extra token costs.'
    : undefined;
}

async function applyAgentSwitch(
  host: SlashCommandHost,
  profile: string,
): Promise<void> {
  if (host.state.appState.streamingPhase !== 'idle') {
    host.showError('Cannot switch agent while streaming — press Esc or Ctrl-C first.');
    return;
  }
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const previous = host.state.appState.agentProfile ?? DEFAULT_AGENT;
  if (profile === previous) {
    host.showStatus(`Already using agent profile "${profile}".`);
    return;
  }

  try {
    const result = await session.setProfile(profile);
    host.setAppState({ agentProfile: result.name });
    if (!result.set) {
      host.showStatus(`Already using agent profile "${result.name}".`);
      return;
    }
    await saveDefaultAgentProfile(host, result.name);
    host.showStatus(
      `Switched to agent profile "${result.name}" and saved it as default. The new system prompt applies from the next turn.`,
      'success',
    );
  } catch (error) {
    host.showError(`Failed to switch agent: ${formatErrorMessage(error)}`);
  }
}

/** Persist the chosen agent profile as the default in `config.toml`. */
async function saveDefaultAgentProfile(host: SlashCommandHost, profile: string): Promise<void> {
  try {
    const config = await host.harness.getConfig({ reload: true });
    if (config.defaultAgentProfile === profile) return;
    await host.harness.setConfig({ defaultAgentProfile: profile });
  } catch (error) {
    host.showStatus(
      `Switched agent but failed to save default: ${formatErrorMessage(error)}`,
      'warning',
    );
  }
}

export async function handleAgentCommand(host: SlashCommandHost, args: string): Promise<void> {
  const profile = args.trim();
  if (profile.length > 0) {
    await applyAgentSwitch(host, profile);
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  let profiles;
  try {
    profiles = await session.listAgentProfiles();
  } catch (error) {
    host.showError(`Failed to list agents: ${formatErrorMessage(error)}`);
    return;
  }

  host.mountEditorReplacement(
    new AgentSelectorComponent({
      profiles,
      currentValue: host.state.appState.agentProfile ?? DEFAULT_AGENT,
      warning: profileSwitchWarning(host),
      onSelect: (name) => {
        host.restoreEditor();
        void applyAgentSwitch(host, name);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}