//#given the extension matrix from plan §4.1
//#when resolveLanguage is called on each representative path
//#then every alias maps to its exact tier language
import { describe, expect, test } from "bun:test"
import { isAstLanguage, isRegexLanguage, resolveLanguage } from "../../../src/shared/comment-scan/language"
import type { AstLanguage, RegexLanguage } from "../../../src/shared/comment-scan/types"

const AST_ROWS: ReadonlyArray<readonly [string, AstLanguage]> = [
  [".py", "python"],
  [".pyi", "python"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".ts", "typescript"],
  [".cts", "typescript"],
  [".mts", "typescript"],
  [".tsx", "tsx"],
  [".go", "go"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".scala", "scala"],
  [".sc", "scala"],
  [".c", "c"],
  [".h", "c"],
  [".cpp", "cpp"],
  [".cc", "cpp"],
  [".cxx", "cpp"],
  [".hpp", "cpp"],
  [".hxx", "cpp"],
  [".rs", "rust"],
  [".rb", "ruby"],
  [".rake", "ruby"],
  [".sh", "bash"],
  [".bash", "bash"],
  [".zsh", "bash"],
  [".bats", "bash"],
  [".cs", "csharp"],
  [".swift", "swift"],
  [".ex", "elixir"],
  [".exs", "elixir"],
  [".lua", "lua"],
  [".php", "php"],
  [".html", "html"],
  [".htm", "html"],
  [".css", "css"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".nix", "nix"],
  [".hs", "haskell"],
  [".lhs", "haskell"],
  [".sol", "solidity"],
  [".json", "json"],
]

const REGEX_ROWS: ReadonlyArray<readonly [string, RegexLanguage]> = [
  [".ml", "ocaml"],
  [".mli", "ocaml"],
  [".sql", "sql"],
  [".toml", "toml"],
  [".hcl", "hcl"],
  [".tf", "hcl"],
  [".proto", "proto"],
  [".svelte", "svelte"],
  [".elm", "elm"],
  [".groovy", "groovy"],
  [".gradle", "groovy"],
  [".cue", "cue"],
  [".jsonc", "jsonc"],
]

describe("resolveLanguage", () => {
  test.each(AST_ROWS)("maps %s to AST language %s", (extension, language) => {
    //#given a path ending in the extension
    const filePath = `src/nested/sample${extension}`
    //#when resolving
    const resolved = resolveLanguage(filePath)
    //#then it maps to the AST language and is classified as AST
    expect(resolved).toBe(language)
    expect(isAstLanguage(language)).toBe(true)
    expect(isRegexLanguage(language)).toBe(false)
  })

  test.each(REGEX_ROWS)("maps %s to regex language %s", (extension, language) => {
    //#given a path ending in the extension
    const filePath = `src/nested/sample${extension}`
    //#when resolving
    const resolved = resolveLanguage(filePath)
    //#then it maps to the regex language and is classified as regex
    expect(resolved).toBe(language)
    expect(isAstLanguage(language)).toBe(false)
    expect(isRegexLanguage(language)).toBe(true)
  })

  test("splits .h to c and .hpp to cpp", () => {
    //#given C-family header paths with distinct extensions
    //#when resolving both
    //#then .h is c and .hpp is cpp (LANG_EXTENSIONS must not be reused)
    expect(resolveLanguage("include/header.h")).toBe("c")
    expect(resolveLanguage("include/header.hpp")).toBe("cpp")
  })

  test("routes .json to AST json and .jsonc to regex jsonc", () => {
    //#given sibling JSON paths
    //#when resolving both
    //#then plain json stays AST-tier while jsonc is regex-tier only
    expect(resolveLanguage("config.json")).toBe("json")
    expect(resolveLanguage("config.jsonc")).toBe("jsonc")
    expect(isAstLanguage("jsonc")).toBe(false)
    expect(isRegexLanguage("jsonc")).toBe(true)
  })

  test("matches Dockerfile by basename before extension", () => {
    //#given Dockerfile basenames in different directories and cases
    //#when resolving
    //#then every one maps to the dockerfile regex language
    expect(resolveLanguage("Dockerfile")).toBe("dockerfile")
    expect(resolveLanguage("deploy/images/Dockerfile")).toBe("dockerfile")
    expect(resolveLanguage("dockerfile")).toBe("dockerfile")
    //#then isAstLanguage rejects it, isRegexLanguage accepts it
    expect(isAstLanguage("dockerfile")).toBe(false)
    expect(isRegexLanguage("dockerfile")).toBe(true)
  })

  test("is case-insensitive for extensions", () => {
    //#given an uppercase extension
    //#when resolving
    //#then the language is resolved the same as lowercase
    expect(resolveLanguage("SRC/MAIN.PY")).toBe("python")
    expect(resolveLanguage("src/App.TSX")).toBe("tsx")
  })

  test("returns null for unknown extensions", () => {
    //#given a path with an unmapped extension
    //#when resolving
    //#then null is returned
    expect(resolveLanguage("notes.txt")).toBeNull()
    expect(resolveLanguage("data.unknownext")).toBeNull()
  })

  test("returns null for extensionless files and dotfiles", () => {
    //#given an extensionless file and a dotfile
    //#when resolving
    //#then neither resolves to a language
    expect(resolveLanguage("Makefile")).toBeNull()
    expect(resolveLanguage(".gitignore")).toBeNull()
  })
})
