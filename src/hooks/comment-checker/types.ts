export interface PendingEdit {
  old_string: string
  new_string: string
  filePath?: string
  file_path?: string
  path?: string
}

export interface PendingCall {
  filePath: string
  content?: string
  oldString?: string
  newString?: string
  edits?: PendingEdit[]
  tool: "write" | "edit" | "multiedit"
  sessionID: string
  timestamp: number
}
