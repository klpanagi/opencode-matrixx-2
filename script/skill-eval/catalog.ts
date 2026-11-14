/// <reference types="bun-types" />
import { readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { EXPECTED_SKILL_COUNT } from "./constants"
import { asRecord } from "./json"

export interface SkillCandidate {
  name: string
  description: string
  template: string
  category: string
  sourceFile: string
  exportKey: string
  allowedTools?: string[]
}

export interface ExportedSkill extends SkillCandidate {
  dirName: string
}

export interface SkillMdOptions {
  version?: string
  author?: string
}

export const DEFAULT_SKILL_VERSION = "1.0.0"
export const DEFAULT_AUTHOR = "klpanagi <klpanagi@users.noreply.github.com>"
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const RESERVED_SEGMENTS = ["anthropic", "claude"]

function toKebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase()
}

function deriveDirName(exportKey: string): string {
  const withoutSuffix = exportKey.endsWith("Skill") ? exportKey.slice(0, -"Skill".length) : exportKey
  return toKebabCase(withoutSuffix)
}

function assertDirName(dirName: string, skill: SkillCandidate): void {
  if (!KEBAB_CASE.test(dirName) || dirName.length > 64) {
    throw new Error(
      `invalid kebab-case skill directory '${dirName}' for skill '${skill.name}' (export '${skill.exportKey}' in ${skill.sourceFile}); expected ${KEBAB_CASE}`,
    )
  }
  for (const segment of RESERVED_SEGMENTS) {
    if (dirName.includes(segment)) throw new Error(`skill directory '${dirName}' contains the reserved segment '${segment}'`)
  }
}

export function resolveDirNames(candidates: SkillCandidate[]): ExportedSkill[] {
  if (candidates.length === 0) throw new Error("no skills collected from src/skills/builtin")
  const nameCounts = new Map<string, number>()
  for (const candidate of candidates) nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1)
  const resolved = candidates.map((candidate) => ({
    ...candidate,
    dirName: (nameCounts.get(candidate.name) ?? 0) > 1 ? deriveDirName(candidate.exportKey) : candidate.name,
  }))
  const seen = new Set<string>()
  for (const skill of resolved) {
    assertDirName(skill.dirName, skill)
    if (seen.has(skill.dirName)) {
      throw new Error(`duplicate skill directory '${skill.dirName}' — directory names must be unique across the catalog`)
    }
    seen.add(skill.dirName)
  }
  return resolved
}

interface SkillModuleValue {
  name: string
  description?: unknown
  template: string
  allowedTools?: unknown
}

function asSkillModuleValue(value: unknown): SkillModuleValue | undefined {
  const record = asRecord(value)
  if (!record || typeof record.name !== "string" || typeof record.template !== "string") return undefined
  return { name: record.name, description: record.description, template: record.template, allowedTools: record.allowedTools }
}

async function findSkillModules(directory: string, depth = 0): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await findSkillModules(fullPath, depth + 1)))
      continue
    }
    if (!entry.name.endsWith(".ts")) continue
    const isBarrel = entry.name === "index.ts" && depth <= 1
    if (isBarrel || entry.name.endsWith(".test.ts")) continue
    files.push(fullPath)
  }
  return files.sort()
}

export async function collectBuiltinSkills(rootDir: string): Promise<ExportedSkill[]> {
  const builtinDir = join(rootDir, "src", "skills", "builtin")
  const files = await findSkillModules(builtinDir)
  const candidates: SkillCandidate[] = []
  for (const file of files) {
    const loaded: Record<string, unknown> = await import(pathToFileURL(file).href)
    for (const [exportKey, value] of Object.entries(loaded)) {
      const skillValue = asSkillModuleValue(value)
      if (!skillValue) continue
      candidates.push({
        name: skillValue.name,
        description: typeof skillValue.description === "string" ? skillValue.description : "",
        template: skillValue.template,
        allowedTools: Array.isArray(skillValue.allowedTools)
          ? skillValue.allowedTools.filter((tool): tool is string => typeof tool === "string")
          : undefined,
        category: relative(builtinDir, file).split(sep)[0] ?? "",
        sourceFile: relative(rootDir, file),
        exportKey,
      })
    }
  }
  const resolved = resolveDirNames(candidates)
  if (resolved.length !== EXPECTED_SKILL_COUNT) {
    throw new Error(
      `expected exactly ${EXPECTED_SKILL_COUNT} builtin skills, found ${resolved.length} in ${builtinDir}; update EXPECTED_SKILL_COUNT in script/skill-eval/constants.ts when the catalog legitimately changes`,
    )
  }
  for (const skill of resolved) {
    if (skill.template.trim().length === 0) {
      throw new Error(`skill '${skill.name}' (${skill.sourceFile}) has an empty template`)
    }
  }
  return resolved
}

export function synthesizeSkillMd(skill: ExportedSkill, options: SkillMdOptions = {}): string {
  const version = options.version ?? DEFAULT_SKILL_VERSION
  const author = options.author ?? DEFAULT_AUTHOR
  const lines = [
    "---",
    `name: ${JSON.stringify(skill.dirName)}`,
    `description: ${JSON.stringify(skill.description)}`,
    `version: ${JSON.stringify(version)}`,
    "metadata:",
    `  author: ${JSON.stringify(author)}`,
    "  tags:",
    `    - ${JSON.stringify(skill.category)}`,
    `    - ${JSON.stringify(skill.dirName)}`,
  ]
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    lines.push(`allowed-tools: ${JSON.stringify(skill.allowedTools.join(", "))}`)
  }
  lines.push("---", skill.template)
  return lines.join("\n")
}
