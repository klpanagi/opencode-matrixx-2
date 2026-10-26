/**
 * Docs mode keyword detector (4th detector).
 *
 * docs-suppresses-search: when a docs intent co-matches the broad
 * SEARCH_PATTERN, the docs match wins and the search injection is
 * suppressed (avoids exhaustive parallel-search fan-out for direct
 * library/framework doc lookups that belong to the operator agent).
 *
 * Exact-match only: the pattern is built from DOC_INTENT_TRIGGERS
 * (docs-lookup-guard constants) with regex escaping — no fuzzy
 * triggers, no init-time checks.
 */

import { escapeRegExp } from "../../../shared/escape-regexp"
import { DOC_INTENT_TRIGGERS } from "../../docs-lookup-guard/constants"

// docs-suppresses-search pattern: exact DOC_INTENT_TRIGGERS phrases.
export const DOCS_PATTERN = new RegExp(
  DOC_INTENT_TRIGGERS.map(escapeRegExp).join("|"),
  "i",
)

export const DOCS_MESSAGE = `[docs-mode]
DOCS LOOKUP. Delegate library/framework documentation queries to the operator agent for context isolation:
- task(subagent_type="operator", prompt="Look up docs for <library> <topic> via context7_resolve-library-id then context7_query-docs")
- Operator agents may call context7/websearch docs tools directly (operator-direct).
Do NOT fan out parallel search agents for pure docs intents.`
