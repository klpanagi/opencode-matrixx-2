import yaml from "js-yaml"

interface FrontmatterResult<T = Record<string, unknown>> {
  data: T
  body: string
  hadFrontmatter: boolean
  parseError: boolean
}

/** Refuse absurdly large inputs before the YAML parser sees them. */
export const MAX_FRONTMATTER_BYTES = 1_048_576

export function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): FrontmatterResult<T> {

  if (Buffer.byteLength(content, "utf8") > MAX_FRONTMATTER_BYTES) {
    return { data: {} as T, body: "", hadFrontmatter: false, parseError: true }
  }

  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { data: {} as T, body: content, hadFrontmatter: false, parseError: false }
  }

  const yamlContent = match[1]
  const body = match[2]

  try {
    // Use JSON_SCHEMA for security - prevents code execution via YAML tags
    const parsed = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA })
    const data = (parsed ?? {}) as T
    return { data, body, hadFrontmatter: true, parseError: false }
  } catch {
    return { data: {} as T, body, hadFrontmatter: true, parseError: true }
  }
}
