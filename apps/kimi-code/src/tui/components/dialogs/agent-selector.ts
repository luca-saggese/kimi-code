/**
 * AgentSelectorComponent — modal list of the available agent profiles
 * (e.g. `agent`, `coder`, `explore`, ...). Each entry shows the profile name
 * plus its description / when-to-use hint. Selecting applies the profile to
 * the active session immediately.
 *
 * Rendered via `mountEditorReplacement`, following the ChoicePicker
 * interaction spec (see DESIGN.md).
 */

import type { AgentProfileInfo } from '@moonshot-ai/kimi-code-sdk';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

export interface AgentSelectorOptions {
  readonly profiles: readonly AgentProfileInfo[];
  readonly currentValue: string | undefined;
  readonly warning?: string | undefined;
  readonly onSelect: (profile: string) => void;
  readonly onCancel: () => void;
}

export class AgentSelectorComponent extends ChoicePickerComponent {
  constructor(opts: AgentSelectorOptions) {
    const options: ChoiceOption[] = opts.profiles.map((profile) => {
      const description =
        profile.description !== undefined && profile.description.length > 0
          ? profile.description
          : profile.whenToUse;
      return {
        value: profile.name,
        label: profile.name,
        description,
      };
    });
    super({
      title: 'Select agent',
      searchable: true,
      currentValue: opts.currentValue,
      notice: opts.warning,
      options,
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}