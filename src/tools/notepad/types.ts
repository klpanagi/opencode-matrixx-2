import { resolveDirectory } from "../plan/types"

export { resolveDirectory }

export interface NotepadCreateArgs {
  planName?: string | undefined
  fileName?: string | undefined
  subject?: string | undefined
  taskId?: string | undefined
}

export interface NotepadReadArgs {
  planName?: string | undefined
  fileName: string
  offset?: number | undefined
  limit?: number | undefined
}
