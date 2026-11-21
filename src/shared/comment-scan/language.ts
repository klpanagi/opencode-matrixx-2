import { AST_LANGUAGES, DOCKERFILE_BASENAME, EXTENSION_LANGUAGE, REGEX_LANGUAGES } from "./constants"
import type { AstLanguage, RegexLanguage, ScanLanguage } from "./types"

function basenameLower(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
  return filePath.slice(slash + 1).toLowerCase()
}

export function resolveLanguage(filePath: string): ScanLanguage | null {
  const name = basenameLower(filePath)
  if (name === DOCKERFILE_BASENAME) return "dockerfile"
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return null
  return EXTENSION_LANGUAGE[name.slice(dot)] ?? null
}

export function isAstLanguage(language: ScanLanguage): language is AstLanguage {
  return AST_LANGUAGES.some((ast) => ast === language)
}

export function isRegexLanguage(language: ScanLanguage): language is RegexLanguage {
  return REGEX_LANGUAGES.some((regex) => regex === language)
}
