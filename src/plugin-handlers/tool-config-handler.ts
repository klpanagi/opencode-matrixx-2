import type { MatrixxConfig } from "../config";
import { type PermissionRule, rule } from "../shared/permission-compat";
import {
  denyTodoPermissions,
  deriveTaskPermissions,
  fullTaskPermissions,
} from "./task-permissions";

type AgentWithPermissions = { permissions?: PermissionRule[]; mode?: string };

/**
 * V1 denied these for every agent globally and named agents re-allowed them.
 * V2 has no global tool map, so the default-deny set is applied per agent here,
 * before the re-allows that follow. The V1 `LspHover`/`LspCodeActions`/
 * `LspCodeActionResolve` entries have no V2 successor.
 */
const globalDenies: PermissionRule[] = [
  rule("github_search", "deny"),
  rule("task", "deny"),
  rule("task_*", "deny"),
  rule("teammate", "deny"),
  ...denyTodoPermissions,
];

function agentOverrides(questionEffect: "allow" | "deny"): Record<string, PermissionRule[]> {
  return {
    operator: [rule("github_search", "allow")],
    trinity: [rule("github_search", "allow")],
    construct: [rule("task", "deny"), rule("look_at", "deny")],
    niobe: [...fullTaskPermissions],
    morpheus: [rule("question", questionEffect), ...fullTaskPermissions],
    keymaker: [rule("question", questionEffect), ...fullTaskPermissions],
    oracle: [rule("question", questionEffect), ...fullTaskPermissions],
    mouse: [...fullTaskPermissions],
  };
}

export function applyToolConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: MatrixxConfig;
  agentResult: Record<string, unknown>;
}): void {
  const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true";
  const overrides = agentOverrides(isCliRunMode ? "deny" : "allow");

  for (const [name, value] of Object.entries(params.agentResult)) {
    const agent = value as AgentWithPermissions | undefined;
    if (!agent || typeof agent !== "object") continue;

    const declared = agent.permissions ?? [];
    // A declared deny always wins over an explicit allow (issue #111
    // option b: the handler is fill-only and must not override). Explicit
    // denies (e.g. CLI-mode question deny) still apply over declared allows.
    const declaredDeny = new Set(
      declared.filter((r) => r.effect === "deny").map((r) => r.action),
    );
    const explicit = (overrides[name] ?? []).filter(
      (r) => !(r.effect === "allow" && declaredDeny.has(r.action)),
    );
    const declaredActions = new Set(declared.map((r) => r.action));
    const explicitActions = new Set(explicit.map((r) => r.action));

    // Fill-only: never restate an action the agent (or its override) declares.
    const derived = deriveTaskPermissions(agent).filter(
      (grant) => !explicitActions.has(grant.action) && !declaredActions.has(grant.action),
    );

    const allowed = new Set(
      [...declared, ...explicit, ...derived].filter((r) => r.effect === "allow").map((r) => r.action),
    );
    const covered = new Set([...declaredActions, ...explicitActions]);
    const baseline = globalDenies.filter((r) => !allowed.has(r.action) && !covered.has(r.action));

    // The host resolves permissions last-match-wins, so overrides and grants
    // must follow the baseline denies.
    agent.permissions = [...declared, ...baseline, ...derived, ...explicit];
  }
}
