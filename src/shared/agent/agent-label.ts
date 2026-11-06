/**
 * Shared agent label formatting for user-visible task titles.
 * Single source of truth so session titles, tool metadata titles, and toasts
 * all render the same `Agent[category]` label. Pure functions, no dependencies.
 */

const FALLBACK_LABEL = "Agent";

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "undefined" || trimmed.toLowerCase() === "null") {
    return "";
  }
  return trimmed;
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Format an agent identity label: `Mouse[source]`, `Oracle`, `Trinity`.
 * Falls back to `Agent` when no usable name is provided.
 */
export function formatAgentLabel(agent: unknown, category?: unknown): string {
  const ag = clean(agent);
  const name = ag !== "" ? capitalize(ag) : FALLBACK_LABEL;
  const cat = clean(category);
  return cat !== "" ? `${name}[${cat}]` : name;
}

export interface LabeledTitleInput {
  description?: unknown;
  agent?: unknown;
  category?: unknown;
  background: boolean;
}

/**
 * Build a user-visible task title: `[BG] Mouse[source] — Do the thing`
 * for background launches, `Mouse[source] — Do the thing` for sync ones.
 */
export function buildLabeledTitle(input: LabeledTitleInput): string {
  const raw = clean(input.description);
  const desc = raw !== "" ? raw : "Background task";
  const base = `${formatAgentLabel(input.agent, input.category)} — ${desc}`;
  return input.background ? `[BG] ${base}` : base;
}
