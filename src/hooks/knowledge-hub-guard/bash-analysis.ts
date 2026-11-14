import * as os from "node:os"
import * as path from "node:path"
import { expandEnvVars } from "../../features/knowledge-hub/loader"

const MAX_INTERPRETER_DEPTH = 2

const PREFIX_COMMANDS = new Set(["sudo", "nohup", "time", "command", "env"])
const ALL_ARGS_VERBS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "tee",
  "truncate",
  "install",
  "ln",
  "chmod",
  "touch",
  "mv",
])
const DEST_ONLY_VERBS = new Set(["cp", "rsync"])
const INTERPRETER_FLAGS: Record<string, string[]> = {
  sh: ["-c"],
  bash: ["-c"],
  node: ["-e", "--eval"],
  bun: ["-e", "--eval"],
  python: ["-c"],
  python3: ["-c"],
  perl: ["-e"],
}
const REDIRECT_TOKENS = new Set([">", ">>"])
const NUMBER_TOKEN_RE = /^\d+$/
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/
const FLAG_RE = /^-/
const GLOB_RE = /[*?[\]{}]/
const PATH_LIKE_SUBSTRING_RE = /(?:~|\/)[^\s'"`;|&<>()]*/g

interface LexState {
  cwd: string
}

function lex(command: string): string[][] {
  const segments: string[][] = []
  let current: string[] = []
  let token = ""
  let quote: "'" | '"' | null = null
  let escaped = false

  const pushToken = (): void => {
    if (token.length > 0) {
      current.push(token)
      token = ""
    }
  }
  const pushSegment = (): void => {
    pushToken()
    if (current.length > 0) {
      segments.push(current)
      current = []
    }
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        quote = null
      } else {
        token += char
      }
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null
      } else if (char === "\\") {
        escaped = true
      } else {
        token += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "\n" || char === ";") {
      pushSegment()
      continue
    }
    if (char === "|") {
      pushSegment()
      if (command[i + 1] === "|") {
        i += 1
      }
      continue
    }
    if (char === "&") {
      pushSegment()
      if (command[i + 1] === "&") {
        i += 1
      }
      continue
    }
    if (char === ">") {
      if (NUMBER_TOKEN_RE.test(token)) {
        token = ""
      } else {
        pushToken()
      }
      if (command[i + 1] === ">") {
        current.push(">>")
        i += 1
      } else {
        current.push(">")
      }
      continue
    }
    if (char === "<") {
      pushToken()
      current.push("<")
      continue
    }
    if (char === " " || char === "\t" || char === "\r") {
      pushToken()
      continue
    }
    token += char
  }
  pushSegment()
  return segments
}

function expandTilde(value: string): string {
  if (value === "~") {
    return os.homedir()
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

function resolveToken(token: string, cwd: string): string {
  const expanded = expandTilde(expandEnvVars(token))
  if (expanded.length === 0) {
    return path.normalize(cwd)
  }
  if (GLOB_RE.test(expanded)) {
    const globIndex = expanded.search(GLOB_RE)
    const head = expanded.slice(0, globIndex)
    const directory = head.endsWith("/") || head.length === 0 ? head || "." : path.dirname(head)
    return resolveToken(directory, cwd)
  }
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded)
  }
  return path.normalize(path.resolve(cwd, expanded))
}

function pathArguments(tokens: string[]): string[] {
  return tokens.filter((token) => {
    if (token.length === 0 || FLAG_RE.test(token)) {
      return false
    }
    if (REDIRECT_TOKENS.has(token) || token === "<" || NUMBER_TOKEN_RE.test(token)) {
      return false
    }
    return true
  })
}

function addCandidates(candidates: Set<string>, values: string[], cwd: string): void {
  for (const value of values) {
    candidates.add(resolveToken(value, cwd))
  }
}

function findVerb(tokens: string[]): { verb: string; args: string[] } | null {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (ASSIGNMENT_RE.test(token) || PREFIX_COMMANDS.has(token)) {
      index += 1
      continue
    }
    if (FLAG_RE.test(token)) {
      index += 1
      continue
    }
    break
  }
  if (index >= tokens.length) {
    return null
  }
  return { verb: path.basename(tokens[index]), args: tokens.slice(index + 1) }
}

function collectInterpreter(script: string, state: LexState, projectDir: string, candidates: Set<string>): void {
  for (const match of script.match(PATH_LIKE_SUBSTRING_RE) ?? []) {
    candidates.add(resolveToken(match, state.cwd))
  }
  for (const value of analyze(script, state.cwd, projectDir, 1)) {
    candidates.add(value)
  }
}

function analyzeSegment(tokens: string[], state: LexState, projectDir: string, candidates: Set<string>): void {
  if (tokens.length === 0) {
    return
  }
  const first = tokens[0]
  if (first === "cd") {
    const target = tokens.slice(1).find((token) => !FLAG_RE.test(token))
    state.cwd = resolveToken(target ?? "~", state.cwd)
    return
  }

  const parsed = findVerb(tokens)
  if (!parsed) {
    return
  }
  const { verb, args } = parsed
  const argsWithoutFlags = pathArguments(args)

  const interpreterFlags = INTERPRETER_FLAGS[verb]
  if (interpreterFlags) {
    const flagIndex = args.findIndex((token) => interpreterFlags.includes(token))
    if (flagIndex !== -1) {
      collectInterpreter(args.slice(flagIndex + 1).join(" "), state, projectDir, candidates)
    }
    return
  }

  if (verb === "git") {
    const dashC = args.indexOf("-C")
    if (dashC !== -1 && args[dashC + 1]) {
      addCandidates(candidates, [args[dashC + 1]], state.cwd)
    }
    return
  }

  if (verb === "dd") {
    const outputs = args.filter((token) => token.startsWith("of=")).map((token) => token.slice(3))
    addCandidates(candidates, outputs, state.cwd)
    return
  }

  if (verb === "find") {
    if (!args.includes("-delete")) {
      return
    }
    const targets = pathArguments(args).filter((token) => token.includes("/") || token.startsWith(".") || token.startsWith("~"))
    addCandidates(candidates, targets, state.cwd)
    candidates.add(path.normalize(state.cwd))
    return
  }

  if (verb === "sed") {
    const inPlace = args.some((token) => token === "--in-place" || /^-[a-zA-Z]*i/.test(token))
    if (!inPlace) {
      return
    }
    addCandidates(candidates, argsWithoutFlags, state.cwd)
    candidates.add(path.normalize(state.cwd))
    return
  }

  if (ALL_ARGS_VERBS.has(verb)) {
    addCandidates(candidates, argsWithoutFlags, state.cwd)
    candidates.add(path.normalize(state.cwd))
    return
  }

  if (DEST_ONLY_VERBS.has(verb)) {
    const destination = argsWithoutFlags[argsWithoutFlags.length - 1]
    if (destination) {
      addCandidates(candidates, [destination], state.cwd)
    }
    candidates.add(path.normalize(state.cwd))
  }
}

function analyze(command: string, cwd: string, projectDir: string, depth: number): string[] {
  const candidates = new Set<string>()
  const state: LexState = { cwd: path.normalize(cwd) }
  for (const segment of lex(command)) {
    const redirectTargets: string[] = []
    for (let i = 0; i < segment.length; i += 1) {
      if (REDIRECT_TOKENS.has(segment[i]) && segment[i + 1]) {
        redirectTargets.push(segment[i + 1])
      }
    }
    addCandidates(candidates, redirectTargets, state.cwd)
    if (depth < MAX_INTERPRETER_DEPTH) {
      analyzeSegment(segment, state, projectDir, candidates)
    }
  }
  return [...candidates]
}

/**
 * Best-effort extraction of absolute paths that a destructive bash command may touch.
 * Returns an empty array when nothing destructive is found. Never throws.
 */
export function analyzeBash(command: string, cwd: string, projectDir: string): string[] {
  try {
    if (typeof command !== "string" || command.trim().length === 0) {
      return []
    }
    return analyze(command, cwd, projectDir, 0)
  } catch {
    return []
  }
}
