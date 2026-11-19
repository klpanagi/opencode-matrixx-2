import { listPacks } from "../skill-pack/installer"
import type { SkillIO, SkillListCommand } from "./args"

const LIST_COLUMNS = ["pack", "version", "skills"] as const

interface ListRow {
  pack: string
  version: string
  dir: string
  skills: string[]
}

function renderTable(rows: ListRow[]): string {
  const header: string[] = [...LIST_COLUMNS]
  const cells = rows.map((row) => [row.pack, row.version, row.skills.join(",")])
  const widths = header.map((title, index) =>
    Math.max(title.length, ...cells.map((row) => (row[index] ?? "").length)),
  )
  const render = (row: string[]) =>
    row.map((value, index) => value.padEnd(widths[index] ?? value.length)).join("  ").trimEnd()
  return [render(header), ...cells.map(render)].join("\n")
}

export function runList(
  cmd: SkillListCommand,
  io: SkillIO,
  list: typeof listPacks = listPacks,
): number {
  const installed = list({ root: cmd.root })

  if (installed.length === 0) {
    if (cmd.json) {
      io.stdout("[]")
    } else {
      io.stdout("No skill packs installed. Run: matrixx skill add ui-ux-pro-max")
    }
    return 0
  }

  const rows: ListRow[] = installed.map((summary) => ({
    pack: summary.packId,
    version: summary.version,
    dir: summary.dir,
    skills: summary.lock.skills.map((skill) => skill.name),
  }))

  if (cmd.json) {
    io.stdout(JSON.stringify(rows, null, 2))
    return 0
  }

  io.stdout(renderTable(rows))
  return 0
}
