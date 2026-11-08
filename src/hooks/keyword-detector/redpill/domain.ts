import type { RedpillDomain } from "./manifesto"

const STRONG_PATTERNS = [
  /```/,
  /(?:^|\s)(?:src|tests?|scripts?|packages?|apps?|lib)\/[\w.@/-]+/i,
  /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|kts|swift|rb|php|cs|cpp|c|h|hpp|sql|sh|bash|zsh|json|ya?ml|toml|css|scss|html|svelte|vue)\b/i,
  /\b(?:file|line)\s*:\s*\d+\b/i,
  /\b(?:git|github|gitlab|bitbucket)\b/i,
  /\b(?:git commit|commit message|commit hash|pull request|merge request|rebase|cherry-pick|feature branch|main branch)\b/i,
  /\b(?:npm|pnpm|yarn|bun|deno|cargo|pip|poetry|uv|maven|gradle)\b/i,
  /\b(?:typecheck|type check|lint|compile|transpile|test suite|unit test|integration test|e2e|tdd|codebase|source code|code review)\b/i,
  /\b(?:refactor|debug|stack trace|segfault|null pointer)\b/i,
  /\b(?:api|endpoint|database|schema|migration|frontend|backend|sdk)\b/i,
  /\b(?:typescript|javascript|python|rust|golang|java|kotlin|swift|ruby|php|c\+\+|c#|sql|react|svelte|next\.js|node\.js)\b/i,
  /\b(?:deploy|deployment|kubernetes|docker)\b/i,
]

const WEAK_PATTERNS = [
  /\bcode\b/i,
  /\bimplement\b/i,
  /\bfeature\b/i,
  /\btest\b/i,
  /\bfile\b/i,
  /\brepo\b/i,
  /\bscript\b/i,
  /\bprogram\b/i,
  /\bapp\b/i,
  /\brelease\b/i,
  /\bfunction\b/i,
  /\bclass\b/i,
  /\bmodule\b/i,
  /\bcomponent\b/i,
  /\bquery\b/i,
  /\bserver\b/i,
  /\bbuild\b/i,
  /\bcommit\b/i,
  /\bbranch\b/i,
  /\binterface\b/i,
  /\bimport\b/i,
  /\bexport\b/i,
  /\bbug\b/i,
  /\bfix\b/i,
]

export function detectRedpillDomain(text: string): RedpillDomain {
  if (!text.trim()) return "universal"
  if (STRONG_PATTERNS.some((pattern) => pattern.test(text))) return "software"
  return WEAK_PATTERNS.filter((pattern) => pattern.test(text)).length >= 2 ? "software" : "universal"
}
