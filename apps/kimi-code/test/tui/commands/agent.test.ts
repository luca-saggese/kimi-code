import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSelectorComponent } from '#/tui/components/dialogs/agent-selector';
import { handleAgentCommand } from '#/tui/commands/agent';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

type MountedPanel = {
  handleInput: (data: string) => void;
  render: (width: number) => string[];
};

function makeHost() {
  const state = {
    appState: {
      streamingPhase: 'idle',
      agentProfile: 'agent',
    },
    transcriptEntries: [],
  };
  let mountedPanel: MountedPanel | null = null;
  const session = {
    id: 'session-1',
    setProfile: vi.fn(async (profile: string) => ({
      name: profile,
      description: undefined,
      whenToUse: undefined,
      set: true,
    })),
    listAgentProfiles: vi.fn(async () => [
      { name: 'agent', description: 'General-purpose agent' },
      { name: 'coder', description: 'Coding-focused agent' },
    ]),
  };
  const harness = {
    getConfig: vi.fn(async () => ({ defaultAgentProfile: 'agent' })),
    setConfig: vi.fn(async () => ({ defaultAgentProfile: 'coder' })),
  };
  const host = {
    state,
    session,
    harness,
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    track: vi.fn(),
    mountEditorReplacement: vi.fn((panel: MountedPanel) => {
      mountedPanel = panel;
    }),
    restoreEditor: vi.fn(() => {
      mountedPanel = null;
    }),
  } as unknown as SlashCommandHost & {
    session: typeof session;
    harness: typeof harness;
    state: typeof state;
  };
  return {
    host,
    session,
    harness,
    getMountedPanel: () => mountedPanel,
  };
}

describe('handleAgentCommand', () => {
  it('applies a named profile immediately and saves it as default', async () => {
    const { host, session, harness } = makeHost();

    await handleAgentCommand(host, 'coder');

    expect(session.setProfile).toHaveBeenCalledWith('coder');
    expect(harness.setConfig).toHaveBeenCalledWith({ defaultAgentProfile: 'coder' });
    expect(host.setAppState).toHaveBeenCalledWith({ agentProfile: 'coder' });
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Switched to agent profile "coder"'),
      expect.any(String),
    );
  });

  it('opens the agent picker when no argument is given', async () => {
    const { host, session, getMountedPanel } = makeHost();

    await handleAgentCommand(host, '');

    expect(session.listAgentProfiles).toHaveBeenCalled();
    const panel = getMountedPanel();
    expect(panel).not.toBeNull();
    expect(panel).toBeInstanceOf(AgentSelectorComponent);
  });

  it('reports already-active profiles without persisting', async () => {
    const { host, session, harness } = makeHost();

    await handleAgentCommand(host, 'agent');

    expect(session.setProfile).not.toHaveBeenCalled();
    expect(harness.setConfig).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Already using agent profile "agent"'),
    );
  });
});