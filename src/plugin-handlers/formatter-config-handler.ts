/**
 * Native formatter pipeline declaration (D2).
 *
 * Matrixx deleted its custom format-on-write spawner
 * (`src/tools/hashline-edit/formatter-trigger.ts`) and the Biome spawn in
 * the quality-gate hook. Formatting is now owned entirely by OpenCode's
 * native `formatter` pipeline, which reads the user's `formatter` config.
 *
 * This handler is the single place where that delegation is declared:
 * it MUST NOT disable the pipeline (`formatter: false`), MUST NOT add
 * formatter entries, and MUST NOT spawn processes. User-declared
 * `formatter` entries (including an explicit `false` opt-out) pass
 * through untouched. Pure function: input config in, same config out.
 */
export function applyFormatterConfig(params: {
  config: Record<string, unknown>;
}): void {
  // Intentionally no mutation: the native pipeline stays exactly as the
  // user configured it. The function exists so D2 has a named, tested
  // declaration point instead of a silent absence.
  void params.config;
}
