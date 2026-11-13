# Contributing to Matrixx

First off, thanks for taking the time to contribute! This document provides guidelines and instructions for contributing to Matrixx.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Development Setup](#development-setup)
  - [Testing Your Changes Locally](#testing-your-changes-locally)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
  - [Build Commands](#build-commands)
  - [Code Style & Conventions](#code-style--conventions)
- [Making Changes](#making-changes)
  - [Adding a New Agent](#adding-a-new-agent)
  - [Adding a New Hook](#adding-a-new-hook)
  - [Adding a New Tool](#adding-a-new-tool)
  - [Adding a New MCP Server](#adding-a-new-mcp-server)
- [Pull Request Process](#pull-request-process)
- [Publishing](#publishing)
- [Getting Help](#getting-help)

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to make better tools together.

## Language Policy

**English is the primary language for all communications in this repository.**

This includes:
- Issues and bug reports
- Pull requests and code reviews
- Documentation and comments
- Discussions and community interactions

### Why English?

- **Global Accessibility**: English allows contributors from all regions to collaborate effectively
- **Consistency**: A single language keeps discussions organized and searchable
- **Open Source Best Practice**: Most successful open-source projects use English as the lingua franca

### Need Help with English?

If English isn't your first language, don't worry! We value your contributions regardless of perfect grammar. You can:
- Use translation tools to help compose messages
- Ask for help from other community members
- Focus on clear, simple communication rather than perfect prose

## Getting Started

### Prerequisites

- **Bun** (latest version) - The only supported package manager
- **TypeScript 5.7.3+** - For type checking and declarations
- **OpenCode 1.0.150+** - For testing the plugin

### Development Setup

```bash
# Clone the repository
git clone https://github.com/klpanagi/opencode-matrixx.git
cd matrixx

# Install dependencies (bun only - never use npm/yarn)
bun install

# Build the project
bun run build
```

### Testing Your Changes Locally

After making changes, you can test your local build in OpenCode:

1. **Build the project**:
   ```bash
   bun run build
   ```

2. **Update your OpenCode config** (`~/.config/opencode/opencode.json` or `opencode.jsonc`):
   ```json
   {
     "plugin": [
        "file:///absolute/path/to/matrixx/dist/index.js"
     ]
   }
   ```
   
   For example, if your project is at `/Users/yourname/projects/matrixx`:
   ```json
   {
     "plugin": [
       "file:///Users/yourname/projects/matrixx/dist/index.js"
     ]
   }
   ```

   > **Note**: Remove `"matrixx"` from the plugin array if it exists, to avoid conflicts with the npm version.

3. **Restart OpenCode** to load the changes.

4. **Verify** the plugin is loaded by checking for OmO agent availability or startup messages.

## Project Structure

```
matrixx/
├── src/
│   ├── agents/        # Definitions, registry, shared agent infra
│   ├── hooks/         # 59 lifecycle hooks + retained-deprecated no-ops
│   ├── tools/         # LSP, AST-Grep, Grep, Glob, task, plan, etc.
│   ├── mcps/          # MCP server integrations (context7, document_reader)
│   ├── features/      # Commands, task storage, mission/plan state
│   ├── config/        # Zod schemas and TypeScript types
│   ├── plugin/        # V2 composition root (setup-domains, handlers, tool)
│   ├── shared/        # Common utilities
│   └── index.ts       # V2 plugin entry ({ id, setup })
├── script/            # Build and CI utilities
├── assets/            # JSON schema
└── dist/              # Build output (ESM + .d.ts)
```

## Development Workflow

### Build Commands

```bash
# Type check only
bun run typecheck

# Full build (ESM + TypeScript declarations + JSON schema)
bun run build

# Clean build output and rebuild
bun run rebuild

# Build schema only (after modifying src/config/schema.ts)
bun run build:schema
```

### Code Style & Conventions

| Convention | Rule |
|------------|------|
| Package Manager | **Bun only** (`bun run`, `bun build`, `bunx`) |
| Types | Use `bun-types`, not `@types/node` |
| Directory Naming | kebab-case (`ast-grep/`, `keyword-detector/`) |
| File Operations | Never use bash commands (mkdir/touch/rm) for file creation in code |
| Tool Structure | Each tool: `index.ts`, `types.ts`, `constants.ts`, `tools.ts`, `utils.ts` |
| Hook Pattern | `createXXXHook(...)` factory returning domain handlers |
| Exports | Barrel pattern (`export * from "./module"` in index.ts) |

**Anti-Patterns (Do Not Do)**:
- Using npm/yarn instead of bun
- Using `@types/node` instead of `bun-types`
- Suppressing TypeScript errors with `as any`, `@ts-ignore`, `@ts-expect-error`
- Generic AI-generated comment bloat
- Direct `bun publish` (use GitHub Actions only)
- Local version modifications in `package.json`

## Making Changes

### Adding a New Agent

1. Create `src/agents/definitions/my-agent.ts` (or `my-agent/` for a multi-file agent) exporting the factory and metadata; re-export it from `src/agents/definitions/index.ts`
2. Add it to `agentSources` and the metadata map in `src/agents/registry/index.ts`
3. Re-export from `src/agents/index.ts`; add the name to `AgentName` in `src/agents/shared/types.ts`
4. Add the name to `BuiltinAgentNameSchema` in `src/config/schema/agent-names.ts`
5. Add the entry to `AgentOverridesSchema` in `src/config/schema/agent-overrides.ts`
6. Add tool restrictions in `src/shared/tool/agent-tool-restrictions.ts`, model requirements in `src/shared/model/model-requirements.ts`, and the display name in `src/shared/agent/agent-display-names.ts`
7. Run `bun run build:schema` to update the JSON schema

See `src/agents/AGENTS.md` for the full checklist and factory patterns.

### Adding a New Hook

1. Create a new directory in `src/hooks/` (kebab-case) with the hook factory
2. Add the hook name to `HookNameSchema` in `src/config/schema/hooks.ts`
3. Register it in the matching factory under `src/plugin/hooks/` (`create-session-hooks.ts`, `create-tool-guard-hooks.ts`, `create-transform-hooks.ts`, `create-continuation-hooks.ts`, or `create-skill-hooks.ts`)
4. Export the factory from `src/hooks/index.ts` if it is new

V2 hooks are domain handlers registered on the native context; there is no `onSessionStart` callback. See an existing factory such as `src/hooks/think-mode/`.

### Adding a New Tool

1. Create a new directory in `src/tools/` with required files:
   - `index.ts` - Main exports
   - `types.ts` - TypeScript interfaces
   - `constants.ts` - Constants and tool descriptions
   - `tools.ts` - Tool implementations
   - `utils.ts` - Helper functions
2. Register it in `src/plugin/tool/tool-catalog.ts` (conditional policy in `src/plugin/tool/tool-policy.ts`)

### Adding a New MCP Server

1. Create configuration in `src/mcps/`
2. Add to `src/mcps/index.ts`
3. Document in README if it requires external setup

## Pull Request Process

1. **Fork** the repository and create your branch from `dev`
2. **Target `dev`** — every Pull Request MUST target the `dev` branch (never `master`; PRs to `master` are automatically rejected; squash merge is disabled, use merge commit)
2. **Make changes** following the conventions above
3. **Build and test** locally:
   ```bash
   bun run test       # full CI: typecheck + lint + isolated tests + build
   ```
4. **Test in OpenCode** using the local build method described above
5. **Commit** with clear, descriptive messages:
   - Use present tense ("Add feature" not "Added feature")
   - Reference issues if applicable ("Fix #123")
6. **Push** to your fork and create a Pull Request
7. **Describe** your changes clearly in the PR description

### PR Checklist

- [ ] Code follows project conventions
- [ ] `bun run test` passes (typecheck + lint + tests + build)
- [ ] Tested locally with OpenCode
- [ ] Updated documentation if needed (README, AGENTS.md)
- [ ] No version changes in `package.json`

## Publishing

**Important**: Publishing is handled exclusively through GitHub Actions.

- **Never** run `bun publish` directly (OIDC provenance issues)
- **Never** modify `package.json` version locally
- Maintainers use GitHub Actions workflow_dispatch:
  ```bash
  gh workflow run publish -f bump=patch  # or minor/major
  ```

## Getting Help

- **Project Knowledge**: Check `AGENTS.md` for detailed project documentation
- **Code Patterns**: Review existing implementations in `src/`
- **Issues**: Open an issue for bugs or feature requests
- **Discussions**: Start a discussion for questions or ideas

---

Thank you for contributing to Matrixx! Your efforts help make AI-assisted coding better for everyone.
