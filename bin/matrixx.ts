#!/usr/bin/env bun
/**
 * Matrixx CLI entry point
 *
 * Run:
 *   ./bin/matrixx.ts doctor
 *   ./bin/matrixx.ts install --no-tui
 *   ./bin/matrixx.ts version
 *
 * Published as:
 *   bunx opencode-matrixx-v2
 *   npx opencode-matrixx-v2
 *   bunx opencode-matrixx (back-compat alias)
 *   npx matrixx (back-compat alias)
 */

import main from "../src/cli/index"

await main()
