import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import type {
  PermissionPolicy,
  PermissionPolicyResult,
} from '#/agent/permissionPolicy/types';

const DEFAULT_APPROVE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'SetTodoList',
  'TodoList',
  'TaskList',
  'TaskOutput',
  'CronList',
  'WebSearch',
  'FetchURL',
  'Agent',
  'AskUserQuestion',
  'Skill',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'select_tools',
  'memory_save',
  'memory_search',
  'memory_toggle',
  'brewing_calculator',
  'water_profile_calculator',
  'ibu_calculator',
  'priming_calculator',
  'recipe_validator',
  'inventory_search',
  'yaml_to_docx',
  'yaml_to_pdf',
]);

export class DefaultToolApprovePermissionPolicyService implements PermissionPolicy {
  readonly name = 'default-tool-approve';

  evaluate(context: ResolvedToolExecutionHookContext): PermissionPolicyResult | undefined {
    return DEFAULT_APPROVE_TOOLS.has(context.toolCall.name)
      ? { kind: 'approve' }
      : undefined;
  }
}
