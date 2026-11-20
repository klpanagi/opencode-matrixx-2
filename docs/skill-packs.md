# Skill Packs

> Skill packs are optional, externally sourced skills. They are **not** part of the 70 built-in skills: they install into a separate store under the OpenCode config dir and are the single documented runtime-`SKILL.md` carve-out. Full config field reference: [configurations.md](configurations.md) § Skill Packs.

External design-intelligence skills for the `ui-ux-pro-max` pack family, installed from the pinned `ui-ux-pro-max-cli` npm distribution (currently `2.15.0`).

## Prerequisites

- **Bun 1.4.4+**. The CLI itself runs on Bun; `bunx` or `bun` must be on your PATH to invoke it.
- **Python 3.8+ on PATH** for tool execution. The tool layer resolves an interpreter in this order: `skill_packs.python_bin` config, then `python3`, then `python`, then `py -3` on Windows. Nothing is auto-installed.
- **One-time outbound network access** to the npm registry at install time, to fetch the pinned, SHA-512-verified tarball.
- **Write access to the OpenCode config dir** (`OPENCODE_CONFIG_DIR`, defaulting to `~/.config/opencode`), where the pack store lives.
- **An OpenCode restart after install**, so the new tools and skills register.

`requiresPython` and `requiresNode` never block the install itself. They are checked only when pack tools execute, and by `matrixx doctor`.

## Quick start

1. Install the core pack plus the design-system pack:

   ```bash
   matrixx skill add ui-ux-pro-max design-system
   ```

2. Confirm the install:

   ```bash
   matrixx skill list
   ```

3. Restart OpenCode so the `uiux_*` tools and the `ui-ux-pro-max` skill register.

4. Sanity check `uiux_validate` once the session is back up.

5. First real use:

   - `uiux_search` with a query and an optional `stack` argument.
   - `uiux_design_system`, which writes `design-system/<project>/MASTER.md`.
   - Or delegate UI work to Sati, which runs the design-system protocol.

> **Note:** `skill add` ships with the CLI release that contains skill packs. If `matrixx skill` reports `Unknown command: skill`, the installed CLI predates that release. Use a newer release, or run a local build with `bun dist/cli.js skill ...`.

## What a skill pack is

A pack is one installable unit of the upstream `ui-ux-pro-max-cli` tarball. Each pack ships a `SKILL.md` (guidance the skill tool serves to agents), reference data domains, and optionally executable scripts. Installed packs load through a dedicated loader (`src/skills/packs/loader.ts`) that is fully isolated from the built-in skill loader: a missing, corrupt, or malformed pack degrades to fewer skills, never to a startup failure.

Built-in skills are code-only (`src/skills/builtin/**.ts`); installed packs are the single documented exception that writes `SKILL.md` files at runtime. They are never committed to this repository.

## Install location

```
<opencode config dir>/matrixx/skill-packs/<packId>/<version>/
├── lock.json        # install manifest (integrity, files, skills, risks)
└── skills/<packId>/ # SKILL.md + data + scripts
```

The config dir defaults to `~/.config/opencode` on Linux/macOS (platform-specific on Windows) and can be moved with the `OPENCODE_CONFIG_DIR` environment variable. Override the pack store itself with `skill_packs.root` in `matrixx.jsonc` or the per-command `--root DIR` flag.

## Commands

The CLI exposes one command group. Any of the binaries (`matrixx`, `opencode-matrixx`, `opencode-matrixx-v2`) works, for example `bunx opencode-matrixx-v2 skill add ...`.

```
Usage:
  matrixx skill add [pack...] [--all] [--version X] [--force] [--dry-run]
                    [--allow-network] [--allow-api-keys] [--root DIR] [--json]
  matrixx skill list [--json] [--root DIR]
  matrixx skill remove <pack> [--version X] [--force] [--root DIR]
```

Exit codes for every subcommand: `0` success, `1` runtime failure, `2` usage error, unknown pack, or missing consent. `matrixx skill --help` prints this usage.

### `skill add`

```bash
matrixx skill add ui-ux-pro-max
matrixx skill add ui-ux-pro-max design-system --allow-network
matrixx skill add --all --allow-network --allow-api-keys
matrixx skill add ui-styling --allow-network --dry-run
```

| Flag | Purpose |
|------|---------|
| `--all` | Install every catalog pack. Mutually exclusive with explicit pack names. |
| `--version X` | Install an exact package version instead of the catalog-pinned `2.15.0`. |
| `--force` | Replace an existing version directory instead of failing with `PACK_ALREADY_INSTALLED`. |
| `--dry-run` | Preflight + download + integrity verify only; never writes the pack. |
| `--allow-network` | Consent for packs with the `requiresNetwork` risk (`ui-styling`, `design`). |
| `--allow-api-keys` | Consent for packs with the `requiresApiKeys` risk (`design`). |
| `--root DIR` | Override the packs root for this invocation. |
| `--json` | Emit the install rows as JSON instead of a table. |

The whole pack list is validated before anything happens: unknown packs and missing consent are reported first, so a refused flag never leaves a partial install behind. A successful run prints a `pack / version / skills / status` table and, for `--dry-run`, `Dry run: verified the download without writing any files.`

### `skill list`

```bash
matrixx skill list
matrixx skill list --json
```

Prints every installed pack version (`pack`, `version`, `skills`) or `No skill packs installed. Run: matrixx skill add ui-ux-pro-max` when the store is empty. `--json` adds the version directory path to each row.

### `skill remove`

```bash
matrixx skill remove brand
matrixx skill remove ui-ux-pro-max --version 2.15.0
```

Accepts exactly one pack. Without `--version`, every installed version of that pack is removed. Unknown packs exit `2`; removing a pack that is not installed exits `1` unless `--force` is set (which reports `Nothing to remove` and exits `0`).

## Pack catalog

| Pack | Skill | Risk | Consent at install | Notes |
|------|-------|------|--------------------|-------|
| `ui-ux-pro-max` | `ui-ux-pro-max` | `requiresPython` | none | **Core pack.** Installs first, provides `search.py` used by the auxiliary packs. Needs a Python 3 interpreter at tool runtime. |
| `design-system` | `design-system` | `requiresNode` | none | Token, theme, and component scaffold generation through Node. |
| `brand` | `brand` | `requiresNode` | none | Brand identity, logo direction, voice guidance through Node. |
| `slides` | `slides` | (none) | none | Reference-only: guidance files, no executable scripts. |
| `banner-design` | `banner-design` | (none) | none | Reference-only: guidance files, no executable scripts. |
| `ui-styling` | `ui-styling` | `requiresNode`, `requiresNetwork` | `--allow-network` | Fonts are not bundled (R3); they are fetched over the network at runtime, so Node 18 or newer is required. |
| `design` | `design` | `requiresApiKeys`, `requiresNetwork`, `requiresPython` | `--allow-network --allow-api-keys` | API-backed design review and image generation; needs provider API keys, network access, and Python 3. |

`requiresPython` and `requiresNode` never block the install itself. They describe runtime prerequisites and are checked by `matrixx doctor` and the tool layer.

## Security model

One install is a preflight → verified download → staged materialisation → atomic swap pipeline (`src/cli/skill-pack/installer.ts`):

1. **Consent preflight.** Catalog membership and consent flags are enforced before any network access. `requiresNetwork` and `requiresApiKeys` block unless the matching flag is set.
2. **Pinned release.** The registry packument is refused unless its digest equals the pinned release digest (`PINNED_INTEGRITY` in `src/cli/skill-pack/constants.ts`), before a single byte of the tarball is read.
3. **Integrity before extraction.** The downloaded tarball is verified against the pinned SHA-512 digest with a timing-safe compare. A tampered archive never reaches the filesystem.
4. **Hardened in-house extractor.** No `tar` binary, no dependency: the parser reads ustar/PAX/GNU headers with `zlib` and accepts regular files and directories only. It rejects `..` segments, absolute paths, NUL bytes, and Windows drive-letter paths outright, and ignores symlinks, hardlinks, devices and FIFOs. Only `package/assets/**` survives extraction; the tarball's `dist/`, `package.json` and docs are never written.
5. **Staging + atomic swap.** Files are rendered into `<root>/.staging-<packId>-<pid>`, then renamed onto `<root>/<packId>/<version>`. `lock.json` is written atomically (temp file + rename). Any failure removes the staging directory and the downloaded tarball, so a botched install never leaves a half-populated pack.

Additional guarantees:

- **Per-pack isolation.** Each pack installs into its own `<packId>/<version>` directory; installing `brand` never copies `design`'s skill files.
- **No scripts run at install time.** Installation only verifies and copies files. Python and Node scripts execute only when the uiux tools below are invoked.
- **Sandboxed runtime.** Pack scripts run as short-lived subprocesses under the pack's own cwd with `PYTHONDONTWRITEBYTECODE=1`, `PYTHONIOENCODING=utf-8`, and `PYTHONUTF8=1`, a per-run timeout (`skill_packs.timeout_ms`, default 12000 ms) that kills the child, and a stdout cap (`skill_packs.max_stdout_bytes`, default 12288 bytes). Truncated JSON output is rejected rather than parsed partially.

### R2: the core skill points at the installed script

The core `SKILL.md` is not shipped by the tarball; it is generated at install time from the upstream template. The `{{SCRIPT_PATH}}` placeholder is always substituted with the absolute installed path (`<root>/ui-ux-pro-max/<version>/skills/ui-ux-pro-max/scripts/search.py`), never left as a placeholder.

### R3: ui-styling ships without fonts

The `ui-styling` pack does not bundle font files. Its `fetch-fonts.js` downloads them over the network on first use, which is why the pack carries the `requiresNetwork` risk and requires Node 18+.

### R5: Python resolution order

Tool runs resolve the interpreter in this order: `skill_packs.python_bin` (when set) → `python3` → `python` → on Windows additionally `py` (invoked with `-3`). The candidate is probed with `--version` (3 second timeout) once per binary and the result is memoised. Nothing is ever installed for you: if no interpreter resolves, the tools fail with `No Python interpreter found. Install Python 3.8+ or set skill_packs.python_bin.`

## Tools (gated)

Three tools wrap the installed core pack. They are registered **only when** the core `ui-ux-pro-max` pack is installed **and** `tool_gating.uiux_tools` is not `false`. `skill_packs.enabled: false` disables pack skill loading and all three tools entirely.

| Tool | Args | What it does |
|------|------|--------------|
| `uiux_search` | `query` (required), `domain`, `stack`, `maxResults` (1-20, default 3), `full`, `json` | Runs `search.py` against the installed knowledge base and returns ranked guidance. |
| `uiux_design_system` | `project` (required), `format` (`ascii` \| `markdown`, default `markdown`), `persist` (default `true`), `outputDir`, `page`, `force` | Runs `search.py --design-system`; by default persists `design-system/<project>/MASTER.md` under the project root. |
| `uiux_validate` | (none) | Read-only integrity check of the installed pack: `lock.json` parses, its file list matches the disk, the upstream data validator (`scripts/validate_data.py`) runs when present, and Python availability is reported. |

Search domains: `style`, `color`, `chart`, `landing`, `product`, `ux`, `typography`, `icons`, `gsap`, `react`, `web`, `google-fonts`. Stacks include `react`, `nextjs`, `vue`, `svelte`, `astro`, `swiftui`, `react-native`, `flutter`, `html-tailwind`, `shadcn` and more.

## Doctor

```bash
matrixx doctor --category dependencies
```

The `skill-packs` check reports, per installed pack version:

- **Corrupt `lock.json`** (problem): `matrixx skill remove <pack> && matrixx skill add <pack>`
- **Version differs from the pinned version** (warning): same remove-and-add fix
- **Integrity** matched against the pinned digest: `integrity pinned`, `integrity unknown (version ...)`, or a mismatch problem
- **Missing consent** still required by the pack's risks (warning): re-run with `--allow-network` / `--allow-api-keys`
- **Core skill present** for `ui-ux-pro-max`
- **Python availability** when any installed pack needs it: `Python 3.x.y` or `Python: not found (fix: Install Python 3 (python3) and re-run matrixx doctor)`

With no packs installed the check passes with `add one with: matrixx skill add ui-ux-pro-max`. With `skill_packs.enabled: false` it reports `skill packs disabled`.

## Configuration reference

```jsonc
// matrixx.jsonc
{
  "skill_packs": {
    "enabled": true,
    "root": "./packs",                    // default: <config dir>/matrixx/skill-packs
    "python_bin": "/usr/bin/python3.12",  // default: auto-resolved (python3 → python → py -3)
    "timeout_ms": 12000,
    "max_stdout_bytes": 12288,
    "disabled_packs": ["design"],
    "disabled_skills": ["design/image-generation", "brand"]
  }
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `enabled` | `boolean` | `true` | `false` disables pack loading, agent discovery, and the uiux tools. |
| `root` | `string` | unset | Packs root (relative to the project or absolute). Falls back to `<config dir>/matrixx/skill-packs`. |
| `auto_install` | `boolean` | `false` | Declared in the schema (`src/config/schema/skill-packs.ts`); installation currently happens through the `matrixx skill add` command. |
| `pinned_versions` | `Record<string, string>` | unset | Per-pack version pins; `matrixx doctor` compares installed versions against this map. `matrixx skill add` uses the catalog-pinned version unless `--version` is passed. |
| `allow_network_packs` | `boolean` | unset | Read by the doctor to silence the `requiresNetwork` warning. Install-time consent comes from the `--allow-network` CLI flag. |
| `allow_api_key_packs` | `boolean` | unset | Read by the doctor to silence the `requiresApiKeys` warning. Install-time consent comes from the `--allow-api-keys` CLI flag. |
| `python_bin` | `string` | unset | Python interpreter used to run pack scripts. Unset uses the R5 resolution order. |
| `disabled_packs` | `string[]` | `[]` | Pack ids whose skills are excluded entirely. Unknown ids warn once and are ignored. |
| `disabled_skills` | `string[]` | `[]` | Skill identifiers (`pack/skill` or bare name) to skip. Pack-level disables win over skill-level ones. |
| `timeout_ms` | `number` | `12000` | Per-script subprocess timeout in milliseconds. |
| `max_stdout_bytes` | `number` | `12288` | Cap on captured subprocess stdout in bytes. |

Note the top-level `disabled_skills` (built-in skill names) does **not** filter pack skills; only the `skill_packs.disabled_packs` / `skill_packs.disabled_skills` fields participate.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Skill pack <id> requires consent for requiresNetwork` / `requiresApiKeys` | Missing consent flag | Re-run with `--allow-network` and/or `--allow-api-keys` (exit code `2`). |
| `Skill pack <id> is already installed at <dir>; pass force to replace it` | Version directory exists | `--force` to replace, or remove first (exit code `1`). |
| `Registry integrity does not match the pinned ui-ux-pro-max-cli release digest` or a tarball `IntegrityMismatchError` | Registry/tarball does not match the pinned release | Do not bypass the check. Retry later, check mirrors, or report the mismatch. |
| `unsafe tar entry rejected: ...` | Archive contains an unsafe member | The archive is not installable; report it. Nothing was written. |
| `No Python interpreter found. Install Python 3.8+ or set skill_packs.python_bin.` | R5 resolution found nothing | Install Python 3 and ensure `python3`/`python` is on `PATH`, or set `skill_packs.python_bin`. |
| `search.py timed out after <ms>ms` | Slow script or machine | Raise `skill_packs.timeout_ms`. |
| `search.py JSON output was truncated; narrow the query or use text output` | Stdout exceeded `max_stdout_bytes` | Narrow the query, drop `json`, or raise `skill_packs.max_stdout_bytes`. |
| `Failed to install <id>: ...` | Network or registry failure | Check connectivity and the registry; the staging dir and tarball are cleaned up automatically. |
| Doctor: `corrupt lock.json` | Interrupted or torn install | `matrixx skill remove <pack> && matrixx skill add <pack>`. |
| Tools missing entirely | Core pack not installed, or `tool_gating.uiux_tools: false`, or `skill_packs.enabled: false` | Install the core pack (`matrixx skill add ui-ux-pro-max`), check both config keys, restart OpenCode. |

## Source of truth

- Catalog: `src/skills/packs/catalog.ts` (packs, risks, pinned version)
- Installer: `src/cli/skill-pack/installer.ts`, `tar.ts`, `integrity.ts`, `registry.ts`, `generate.ts`
- Store layout: `src/skills/packs/store.ts`
- Tools: `src/tools/uiux/`
- Doctor check: `src/cli/doctor/checks/skill-packs.ts`
- Config schema: `src/config/schema/skill-packs.ts`
