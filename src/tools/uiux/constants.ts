/**
 * Fixed defaults for the uiux skill-pack subprocess layer.
 *
 * These mirror the `skill_packs` config defaults (`timeout_ms` /
 * `max_stdout_bytes`) and the upstream `search.py` argparse choices. Runtime
 * callers pass the *effective* values through `UiuxToolDeps`; these constants
 * are the fallbacks and the source of truth for the enums.
 */

/** Per-script subprocess timeout in milliseconds. */
export const UIUX_TIMEOUT_MS = 12_000

/** Cap on captured pack stdout in bytes. */
export const UIUX_MAX_STDOUT_BYTES = 12_288

/** Default `--max-results` value passed to the pack scripts. */
export const UIUX_DEFAULT_MAX_RESULTS = 3

/** Domains accepted by `search.py --domain`. */
export const UIUX_DOMAINS = [
  "style",
  "color",
  "chart",
  "landing",
  "product",
  "ux",
  "typography",
  "icons",
  "gsap",
  "react",
  "web",
  "google-fonts",
] as const

/** Stacks accepted by `search.py --stack`. */
export const UIUX_STACKS = [
  "react",
  "nextjs",
  "vue",
  "svelte",
  "astro",
  "swiftui",
  "react-native",
  "flutter",
  "nuxtjs",
  "nuxt-ui",
  "html-tailwind",
  "shadcn",
  "jetpack-compose",
  "threejs",
  "angular",
  "laravel",
  "javafx",
  "wpf",
  "winui",
  "avalonia",
  "uno",
  "uwp",
] as const
