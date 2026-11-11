import type { NativeSubagentClient } from "../../../src/shared/session/native-subagent"

export interface FakeAssemblyClient {
  client: NativeSubagentClient
  calls: { create: Record<string, unknown>[]; prompt: unknown[]; interrupt: unknown[] }
}

export function userMessage(text = "question") {
  return { id: "user-1", type: "user", time: { created: 1 }, text }
}

export function assistantMessage(text: string, finish = "stop") {
  return {
    id: "assistant-1",
    type: "assistant",
    time: { created: 2, completed: 3 },
    content: [{ type: "text", text }],
    finish,
  }
}

export function createFakeAssemblyClient(transcripts: unknown[][]): FakeAssemblyClient {
  const calls = { create: [] as Record<string, unknown>[], prompt: [] as unknown[], interrupt: [] as unknown[] }
  let counter = 0
  const ids: string[] = []
  const session = {
    create: async (body?: Record<string, unknown>) => {
      calls.create.push(body ?? {})
      const id = `child-${counter++}`
      ids.push(id)
      return { id }
    },
    prompt: async (args: { sessionID: string } & Record<string, unknown>) => {
      calls.prompt.push(args)
      return {}
    },
    interrupt: async (args: { sessionID: string }) => {
      calls.interrupt.push(args)
      return {}
    },
    context: async (args: { sessionID: string }) => {
      const index = ids.indexOf(args.sessionID)
      return { messages: transcripts[index] ?? [] }
    },
  }
  return { client: { session }, calls }
}
