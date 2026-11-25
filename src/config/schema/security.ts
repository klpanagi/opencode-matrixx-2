import { z } from "zod"

const DEFAULT_SENSITIVE_FILE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "service-account*.json",
  ".npmrc",
  ".pypirc",
]

const SecretScanningConfigSchema = z.object({
  /** Enable secret scanning before git commit/push (default: true) */
  enabled: z.boolean().default(true),
  /** Secret detection tool to use (default: gitleaks) */
  tool: z.enum(["gitleaks"]).default("gitleaks"),
  /** Block git operations when secrets are detected (default: true) */
  block_on_detection: z.boolean().default(true),
  /** File paths to exclude from secret scanning (glob patterns) */
  allowlist_paths: z.array(z.string()).optional(),
})

const EnvFileGuardConfigSchema = z.object({
  /** Enable guard preventing writes to sensitive files (default: true) */
  enabled: z.boolean().default(true),
  /** Glob patterns for files that should be blocked from write/edit */
  blocked_patterns: z.array(z.string()).default(DEFAULT_SENSITIVE_FILE_PATTERNS),
  /** File paths explicitly allowed despite matching blocked patterns */
  allowed_paths: z.array(z.string()).optional(),
})

const DependencyAuditConfigSchema = z.object({
  /** Enable dependency vulnerability auditing (default: false) */
  enabled: z.boolean().default(false),
  /** Automatically audit when package.json/bun.lockb changes (default: true) */
  on_package_change: z.boolean().default(true),
})

const InputSecretGuardModeSchema = z.enum(["prompt", "block", "off"])

const InputSecretGuardConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: InputSecretGuardModeSchema.default("prompt"),
  blocklist_mode: z.enum(["prompt", "block"]).default("prompt"),
  warnlist_mode: z.enum(["prompt", "off"]).default("prompt"),
  allowlist_patterns: z.array(z.string()).optional(),
  detection: z
    .object({
      entropy_threshold: z.number().min(0).max(8).default(4.5),
      max_scan_bytes: z.number().int().min(1024).max(256 * 1024).default(64 * 1024),
    })
    .optional(),
})

const CommandExpansionConfigSchema = z.object({
  /** Allow executing project-scoped commands from the project directory (default: false) */
  project_scope_execution: z.boolean().default(false),
  /** Allow resolving command file references from the project directory (default: false) */
  project_scope_file_refs: z.boolean().default(false),
  /** Command names allowed to run in project scope even when disabled above */
  allowlist: z.array(z.string()).default([]),
})

const FileReferenceConfigSchema = z.object({
  /** Maximum bytes read from a single referenced file (default: 256 KiB) */
  max_bytes: z.number().default(262144),
  /** Maximum bytes read across all referenced files in one message (default: 1 MiB) */
  max_total_bytes: z.number().default(1048576),
})

const LoggingConfigSchema = z.object({
  /** Rotate the log file at this size in bytes (default: 1 MiB) */
  max_bytes: z.number().default(1048576),
  /** Number of rotated log files to retain (default: 3) */
  max_files: z.number().default(3),
  /** Redact detected secrets before writing log lines (default: true) */
  redact: z.boolean().default(true),
})

const DocumentReaderConfigSchema = z.object({
  /** Enable the document-reader MCP (default: false) */
  enabled: z.boolean().default(false),
})

const AutoUpdateConfigSchema = z.object({
  /** Install updates automatically (default: false) */
  auto_install: z.boolean().default(false),
  /** Require an integrity check before installing an update (default: true) */
  require_integrity: z.boolean().default(true),
})

export const SecurityConfigSchema = z.object({
  /** Secret scanning configuration for pre-commit/pre-push checks */
  secret_scanning: SecretScanningConfigSchema.optional(),
  /** Guard against writing to sensitive files (.env, .pem, .key, etc.) */
  env_file_guard: EnvFileGuardConfigSchema.optional(),
  /** Dependency vulnerability auditing configuration */
  dependency_audit: DependencyAuditConfigSchema.optional(),
  input_secret_guard: InputSecretGuardConfigSchema.optional(),
  /** Project-scoped command execution and file-reference policy */
  command_expansion: CommandExpansionConfigSchema.prefault({}),
  /** Size ceilings for referenced file contents */
  file_reference: FileReferenceConfigSchema.prefault({}),
  /** Log rotation and secret redaction */
  logging: LoggingConfigSchema.prefault({}),
  /** Document-reader MCP toggle */
  document_reader: DocumentReaderConfigSchema.prefault({}),
  /** Update install policy */
  auto_update: AutoUpdateConfigSchema.prefault({}),
})

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>
export type SecretScanningConfig = z.infer<typeof SecretScanningConfigSchema>
export type EnvFileGuardConfig = z.infer<typeof EnvFileGuardConfigSchema>
export type InputSecretGuardConfig = z.infer<typeof InputSecretGuardConfigSchema>
export type InputSecretGuardMode = z.infer<typeof InputSecretGuardModeSchema>
export type CommandExpansionConfig = z.infer<typeof CommandExpansionConfigSchema>
export type FileReferenceConfig = z.infer<typeof FileReferenceConfigSchema>
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>
export type DocumentReaderConfig = z.infer<typeof DocumentReaderConfigSchema>
export type AutoUpdateConfig = z.infer<typeof AutoUpdateConfigSchema>
