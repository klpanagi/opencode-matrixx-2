import type { FluxSeverity } from "./types"

export const DASHBOARD_FLUX_VALIDATE_DESCRIPTION = `Deterministic, read-only validator for Grafana dashboards and provisioning files backed by InfluxDB-Flux. Returns a JSON report with a status exit code (0=clean, 1=warnings, 2=errors).

Checks:
- DS001 datasource is provisioned as InfluxDB-Flux (dashboard present but no influxdb type declared).
- VAR001 a symbol-like template variable does not use \`schema.tagValues\`.
- PAN001 a staleness/lag/age panel has no value mappings (or thresholds).
- GF001 Flux writes with \`|> to()\` without an explicit \`timeColumn: "_time"\` (server-side timestamp risk).
- GF002 aggregation without \`toFloat()\` (field-type conflict risk).
- GF003 \`createEmpty: true\` (gap masking).
- GF004 \`join()\` instead of \`pivot()\` (unaligned basis).

Accepts a Grafana provisioning YAML, a dashboard JSON, or a directory. JSON dashboards get structural checks; YAML is linted line-by-line. A missing path fails closed with status 2.`

export const DASHBOARD_EXTENSIONS = [".json", ".yaml", ".yml", ".flux", ".txt"]

export const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "venv", "__pycache__"])

export const RULE_CATALOG: Record<string, { severity: FluxSeverity; fix: string }> = {
  DS001: {
    severity: "error",
    fix: "Provision an InfluxDB datasource with Flux enabled and reference it by uid; an unprovisioned datasource silently blanks every panel.",
  },
  VAR001: {
    severity: "warn",
    fix: 'Query the symbol variable with schema.tagValues(bucket: ..., tag: "symbol") so it lists real series, not a hardcoded list.',
  },
  PAN001: {
    severity: "warn",
    fix: "Add a value mapping (or thresholds) so staleness renders as states (healthy/warn/stale) rather than raw numbers.",
  },
  GF001: {
    severity: "error",
    fix: 'Write explicit sample timestamps: pass timeColumn: "_time" and never rely on server-side write time.',
  },
  GF002: {
    severity: "warn",
    fix: "Cast numeric fields with toFloat() before aggregation to avoid mixed field types in one column.",
  },
  GF003: {
    severity: "warn",
    fix: "Remove createEmpty: true; let missing data surface as a gap the panel can show.",
  },
  GF004: {
    severity: "warn",
    fix: "Replace join() with pivot() to align series on _time before computing.",
  },
}
