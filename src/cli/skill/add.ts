import { PACK_CATALOG, PACK_CATALOG_BY_ID } from "../../skills/packs/catalog"
import type { PackCatalogEntry, PackId, PackRisk } from "../../skills/packs/types"
import {
  installPack,
  PackAlreadyInstalledError,
  PackRequiresConsentError,
  PackUnknownError,
} from "../skill-pack/installer"
import type { SkillAddCommand, SkillIO } from "./args"

interface InstallRow {
  pack: string
  version: string
  skills: string[]
  dir: string
  status: "installed" | "dry-run"
}

const ADD_COLUMNS = ["pack", "version", "skills", "status"] as const

function catalogIds(): string {
  return PACK_CATALOG.map((entry) => entry.id).join(", ")
}

function blockedRisks(entry: PackCatalogEntry, cmd: SkillAddCommand): PackRisk[] {
  const blocked: PackRisk[] = []
  if (entry.risk.includes("requiresNetwork") && !cmd.allowNetwork) blocked.push("requiresNetwork")
  if (entry.risk.includes("requiresApiKeys") && !cmd.allowApiKeys) blocked.push("requiresApiKeys")
  return blocked
}

function consentHint(risks: PackRisk[]): string {
  const flags: string[] = []
  if (risks.includes("requiresNetwork")) flags.push("--allow-network")
  if (risks.includes("requiresApiKeys")) flags.push("--allow-api-keys")
  return flags.join(" ")
}

function renderTable(rows: InstallRow[]): string {
  const header: string[] = [...ADD_COLUMNS]
  const cells = rows.map((row) => [row.pack, row.version, row.skills.join(","), row.status])
  const widths = header.map((title, index) =>
    Math.max(title.length, ...cells.map((row) => (row[index] ?? "").length)),
  )
  const render = (row: string[]) =>
    row.map((value, index) => value.padEnd(widths[index] ?? value.length)).join("  ").trimEnd()
  return [render(header), ...cells.map(render)].join("\n")
}

/**
 * `matrixx skill add` — validates the whole pack list before installing so a
 * refused consent flag never leaves a partial install behind.
 */
export async function runAdd(
  cmd: SkillAddCommand,
  io: SkillIO,
  install: typeof installPack = installPack,
): Promise<number> {
  const ids = cmd.all ? PACK_CATALOG.map((entry) => entry.id) : cmd.packs
  const unknown = ids.filter((id) => !Object.hasOwn(PACK_CATALOG_BY_ID, id))
  if (unknown.length > 0) {
    io.stderr(`Unknown skill pack: ${unknown.join(", ")}`)
    io.stderr(`Available packs: ${catalogIds()}`)
    return 2
  }

  for (const id of ids) {
    const entry = PACK_CATALOG_BY_ID[id as PackId]
    const risks = blockedRisks(entry, cmd)
    if (risks.length > 0) {
      io.stderr(`Skill pack ${id} requires consent for ${risks.join(", ")}`)
      io.stderr(`Re-run with ${consentHint(risks)}`)
      return 2
    }
  }

  const rows: InstallRow[] = []
  for (const id of ids) {
    try {
      const result = await install({
        packId: id,
        version: cmd.version,
        root: cmd.root,
        force: cmd.force,
        dryRun: cmd.dryRun,
        allowNetworkPacks: cmd.allowNetwork,
        allowApiKeyPacks: cmd.allowApiKeys,
      })
      rows.push({
        pack: result.packId,
        version: result.version,
        skills: result.skills,
        dir: result.dir,
        status: cmd.dryRun ? "dry-run" : "installed",
      })
    } catch (err) {
      if (err instanceof PackUnknownError) {
        io.stderr(`Unknown skill pack: ${err.packId}`)
        io.stderr(`Available packs: ${catalogIds()}`)
        return 2
      }
      if (err instanceof PackRequiresConsentError) {
        io.stderr(`Skill pack ${err.packId} requires consent for ${err.risks.join(", ")}`)
        io.stderr(`Re-run with ${consentHint(err.risks)}`)
        return 2
      }
      if (err instanceof PackAlreadyInstalledError) {
        io.stderr(err.message)
        return 1
      }
      io.stderr(`Failed to install ${id}: ${err instanceof Error ? err.message : String(err)}`)
      return 1
    }
  }

  if (cmd.json) {
    io.stdout(JSON.stringify(rows, null, 2))
    return 0
  }

  io.stdout(renderTable(rows))
  if (cmd.dryRun) {
    io.stdout("Dry run: verified the download without writing any files.")
  } else {
    io.stdout(`Installed ${rows.length} skill pack${rows.length === 1 ? "" : "s"}.`)
  }
  return 0
}
