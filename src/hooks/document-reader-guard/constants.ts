export const HOOK_NAME = "document-reader-guard"

export const DOCUMENT_READER_TOOL_PATTERN = /^document_reader([._-].*)?$/i

export const BINARY_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".mp3",
  ".wav",
] as const

export const BLOCKED_PATTERNS: RegExp[] = [
  /\bpdftotext\b/,
  /\bpdfinfo\b/,
  /\bpandoc\b.*\.(pdf|docx?|xlsx?|pptx?)/,
  /\blibreoffice\b|\bsoffice\b/,
  /\bcat\s+[^|&;]*\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|mp3|wav)/,
  /\bhead\s+[^|&;]*\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|mp3|wav)/,
  /\btail\s+[^|&;]*\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|mp3|wav)/,
  /\bless\s+[^|&;]*\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|mp3|wav)/,
  /\bpython3?\b.*(fitz|pymupdf|pdfminer|pdfplumber|python-pptx|\bdocx\b|openpyxl|pillow|\bPIL\b)/,
  /\bpython3?\b[^|&;]*\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|mp3|wav)/,
  /\bmarkitdown\b/,
]

export const READ_BLOCK_MESSAGE =
  "[document-reader-guard] BLOCKED: Use document_reader_convert_to_markdown (document_reader MCP, Microsoft MarkItDown) for binary documents — generic Read cannot parse them. " +
  "Call document_reader_convert_to_markdown with an absolute URI like file:///absolute/path/to/report.pdf, then summarize — do not dump raw output. " +
  "For context isolation delegate to the construct subagent so the main context stays clean."

export const BASH_BLOCK_MESSAGE =
  "[document-reader-guard] BLOCKED: Do not read documents via bash CLIs (pdftotext, pdfinfo, pandoc, libreoffice, cat/head/tail, python fitz/pypdf/pdfminer/pdfplumber/docx/openpyxl, markitdown CLI). " +
  "Use document_reader_convert_to_markdown with file:///absolute/path instead — delegate to construct for summarization."

export const URI_NON_FILE_BLOCK_MESSAGE =
  "[document-reader-guard] BLOCKED: document_reader accepts only local file: URIs — http/https, data: and other schemes are blocked (SSRF guard). " +
  "Fix: pass a local absolute path as file:///absolute/path/to/document."

export function uriHostBlockMessage(host: string): string {
  return (
    `[document-reader-guard] BLOCKED: file: URI host "${host}" is a loopback, link-local (169.254.0.0/16 — cloud metadata service), private (10/8, 172.16/12, 192.168/16), ::1 or metadata.google.internal address — blocked (SSRF guard). ` +
    "Fix: pass a local absolute path without a host as file:///absolute/path/to/document."
  )
}

export function uriOutsideWorkspaceBlockMessage(filePath: string, root: string): string {
  return (
    `[document-reader-guard] BLOCKED: file: path "${filePath}" is outside the workspace root "${root}". ` +
    "Fix: move the document inside the workspace and pass file:///absolute/path/to/document."
  )
}

/**
 * Message used when the path cannot be resolved on disk at all (broken
 * symlink, missing file, EACCES/ELOOP…). The guard fails closed: without a
 * real path, containment cannot be proved.
 */
export function uriUnresolvableBlockMessage(filePath: string, reason: string): string {
  return (
    `[document-reader-guard] BLOCKED: file: path "${filePath}" could not be resolved on disk (${reason}) — it may be a broken symlink or an unreadable path; blocked (symlink escape guard). ` +
    "Fix: pass an existing regular file inside the workspace as file:///absolute/path/to/document."
  )
}

