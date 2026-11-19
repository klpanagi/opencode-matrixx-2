import { PACK_CATALOG, PACK_CATALOG_BY_ID } from "../../skills/packs/catalog"
import { removePack } from "../skill-pack/installer"
import type { SkillIO, SkillRemoveCommand } from "./args"

export function runRemove(
  cmd: SkillRemoveCommand,
  io: SkillIO,
  remove: typeof removePack = removePack,
): number {
  if (!Object.hasOwn(PACK_CATALOG_BY_ID, cmd.pack)) {
    io.stderr(`Unknown skill pack: ${cmd.pack}`)
    io.stderr(`Available packs: ${PACK_CATALOG.map((entry) => entry.id).join(", ")}`)
    return 2
  }

  const removed = remove(cmd.pack, { root: cmd.root, version: cmd.version })

  if (removed.length === 0) {
    if (cmd.force) {
      io.stdout(`Nothing to remove for ${cmd.pack}.`)
      return 0
    }
    io.stderr(`Skill pack ${cmd.pack} is not installed.`)
    return 1
  }

  const versionSuffix = cmd.version === undefined ? "" : ` ${cmd.version}`
  io.stdout(`Removed ${cmd.pack}${versionSuffix} (${removed.length} version${removed.length === 1 ? "" : "s"}).`)
  return 0
}
