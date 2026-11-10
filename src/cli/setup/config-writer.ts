import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type MatrixxConfig, MatrixxConfigSchema } from "../../config/schema/matrixx-config";
import type { ModelPresets } from "../../config/schema/model-presets";
import { deepMerge } from "../../shared/config/deep-merge";
import { getOpenCodeConfigDir } from "../../shared/config/opencode-config-dir";
import { log } from "../../shared/runtime/logger";
import { detectConfigFile, parseJsonc, parseJsoncSafe } from "../../shared/text/jsonc-parser";
import type { SetupState } from "./types";

export const PRESETS_FILENAME = "matrixx.presets.jsonc";

export function resolveMatrixxConfigPath(): { format: "json" | "jsonc" | "none"; path: string } {
  const dir = getOpenCodeConfigDir({ binary: "opencode" });
  return detectConfigFile(join(dir, "matrixx"));
}

export function buildMatrixxConfig(state: SetupState, existing: MatrixxConfig | null): MatrixxConfig {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  next.tasks = {
    ...((existing?.tasks as Record<string, unknown>) ?? {}),
    enabled: state.taskSystem,
  };
  next.headroom = {
    enabled: state.headroom.enabled,
    ...(state.headroom.proxyUrl ? { proxyUrl: state.headroom.proxyUrl } : {}),
    ...(state.headroom.project ? { project: state.headroom.project } : {}),
  };
  next.rtk = {
    enabled: state.rtk.enabled,
    ...(state.rtk.binaryPath ? { binary_path: state.rtk.binaryPath } : {}),
    timeout_ms: 5000,
  };
  next.dcp = {
    ...(existing?.dcp as Record<string, unknown> ?? {}),
    enabled: state.dcp.enabled,
  } as unknown as MatrixxConfig["dcp"];
  if (state.preset) {
    next.model_presets = {
      ...(existing?.model_presets ?? {}),
      [state.preset.name]: state.preset.preset,
    };
    next.active_preset = state.preset.name;
    next.model_presets_file = existing?.model_presets_file ?? PRESETS_FILENAME;
  }
  const parsed = MatrixxConfigSchema.safeParse(next);
  if (parsed.success) return parsed.data;
  return next as MatrixxConfig;
}

export function writePresetsFile(
  configPath: string,
  presets: ModelPresets,
  opts: { dryRun: boolean; backup: boolean },
): string {
  const presetsPath = join(dirname(configPath), PRESETS_FILENAME);
  const merged: Record<string, unknown> = {};
  if (existsSync(presetsPath)) {
    const parsed = parseJsoncSafe<Record<string, unknown>>(readFileSync(presetsPath, "utf-8"));
    if (parsed.data) Object.assign(merged, parsed.data);
  }
  Object.assign(merged, presets as Record<string, unknown>);
  const nextContent = `${JSON.stringify(merged, null, 2)}\n`;
  if (opts.dryRun) {
    console.log("[dry-run] would write:", presetsPath);
    console.log(nextContent);
    return presetsPath;
  }
  if (!existsSync(dirname(presetsPath))) mkdirSync(dirname(presetsPath), { recursive: true });
  if (existsSync(presetsPath) && opts.backup) {
    const bak = `${presetsPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
    writeFileSync(bak, readFileSync(presetsPath, "utf-8"));
  }
  writeFileSync(presetsPath, nextContent);
  return presetsPath;
}

export function migratePresetsToFile(
  configPath: string,
  opts: { dryRun: boolean; backup: boolean },
): { migrated: boolean; presetsPath: string | null } {
  const presetsPath = join(dirname(configPath), PRESETS_FILENAME);
  if (!existsSync(configPath)) return { migrated: false, presetsPath: null };
  const raw = parseJsonc<Record<string, unknown>>(readFileSync(configPath, "utf-8"));
  const inline = raw.model_presets as ModelPresets | undefined;
  if (!inline || Object.keys(inline).length === 0) return { migrated: false, presetsPath };
  if (opts.dryRun) {
    log("[dry-run] would migrate inline presets to", presetsPath);
    return { migrated: true, presetsPath };
  }
  writePresetsFile(configPath, inline, opts);
  const next: Record<string, unknown> = {
    ...raw,
    model_presets_file: (raw.model_presets_file as string | undefined) ?? PRESETS_FILENAME,
  };
  delete next.model_presets;
  const parsed = MatrixxConfigSchema.safeParse(next);
  const nextContent = `${JSON.stringify(parsed.success ? parsed.data : next, null, 2)}\n`;
  if (opts.backup) {
    const bak = `${configPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
    writeFileSync(bak, readFileSync(configPath, "utf-8"));
  }
  writeFileSync(configPath, nextContent);
  return { migrated: true, presetsPath };
}

export function previewDiff(existing: string, next: string): string {
  const a = existing.split("\n");
  const b = next.split("\n");
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) out.push(`- ${a[i]}`);
      if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    } else {
      out.push(`  ${a[i] ?? ""}`);
    }
  }
  return out.join("\n");
}

export async function writeMatrixxConfig(
  targetPath: string,
  config: MatrixxConfig,
  opts: { dryRun: boolean; backup: boolean },
): Promise<void> {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (config.model_presets && Object.keys(config.model_presets).length > 0) {
    writePresetsFile(targetPath, config.model_presets, opts);
  }

  const existingContent = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : null;
  const nextContent = `${JSON.stringify(config, null, 2)}\n`;

  if (opts.dryRun) {
    const diff = existingContent ? previewDiff(existingContent, nextContent) : nextContent;
    console.log("[dry-run] would write:", targetPath);
    console.log(diff);
    return;
  }

  if (existingContent && opts.backup) {
    const bak = `${targetPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
    writeFileSync(bak, existingContent);
  }

  if (existingContent) {
    try {
      const existing = parseJsonc<MatrixxConfig>(existingContent);
      const merged = deepMerge(existing as unknown as Record<string, unknown>, config as unknown as Record<string, unknown>) as unknown as MatrixxConfig;
      const parsed = MatrixxConfigSchema.safeParse(merged);
      if (parsed.success) {
        writeFileSync(targetPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
        return;
      }
    } catch {}
  }

  writeFileSync(targetPath, nextContent);
}
