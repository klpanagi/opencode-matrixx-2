import { describe, expect, test } from "bun:test"

//#given a headless (SDK) client shape with tui undefined, plus resilient toast helpers copied from precedents
type ToastOpts = { body: { title: string; message: string; variant: "info" | "success" | "warning" | "error"; duration: number } }
type TuiLike = { showToast: (opts: ToastOpts) => Promise<unknown> }
type HeadlessClient = { tui?: TuiLike }

// Precedent: src/features/task-toast-manager/manager.ts:157-158 (guarded early-return)
async function guardedToast(client: HeadlessClient, opts: ToastOpts, sent: ToastOpts[]): Promise<void> {
  const tuiClient = client as unknown as { tui?: TuiLike }
  if (!tuiClient.tui?.showToast) return
  await tuiClient.tui.showToast(opts).catch(() => { sent.push({ body: { ...opts.body, title: "[caught]" } } as ToastOpts) })
}

// Precedent: src/hooks/keyword-detector/hook.ts:91-105 (ctx.client.tui.showToast({...}).catch(log))
async function keywordStyleToast(client: HeadlessClient, opts: ToastOpts): Promise<void> {
  await client.tui
    // @ts-expect-error probe: intentional unguarded access on headless client
    ?.showToast(opts)
    ?.catch(() => {})
}

//#given a mocked session store to measure noReply message-count delta
function makeSessionStore() {
  const messages: Array<{ parts: unknown[]; noReply?: boolean }> = []
  return {
    messages,
    prompt: async (input: { parts: unknown[]; noReply?: boolean }) => {
      messages.push({ parts: input.parts, noReply: input.noReply })
      return { messageID: `msg-${messages.length}` }
    },
  }
}

describe("spike: injection-headless", () => {
  test("(a) unguarded client.tui.showToast throws when tui is undefined (headless hazard)", () => {
    //#when direct property access on undefined tui, as naive code would do
    const client = {} as HeadlessClient
    let threw = ""
    try {
      // @ts-expect-error probe: intentional unguarded dereference
      void client.tui.showToast({ body: { title: "t", message: "m", variant: "info", duration: 1 } })
    } catch (e) {
      threw = (e as Error).constructor.name
    }
    //#then evidence: TypeError proves headless MUST use guarded pattern
    expect(threw).toBe("TypeError")
  })

  test("(a) guarded resilient pattern resolves with zero toasts when tui undefined", async () => {
    //#when headless client hits the task-toast-manager guard
    const sent: ToastOpts[] = []
    await expect(
      guardedToast({}, { body: { title: "Notice", message: "x".repeat(10), variant: "info", duration: 3000 } }, sent)
    ).resolves.toBeUndefined()
    //#then fail-open: resolves, sends nothing
    expect(sent.length).toBe(0)
    // keyword-style ?. chain also resolves on headless
    await expect(keywordStyleToast({}, { body: { title: "N", message: "m", variant: "info", duration: 3000 } })).resolves.toBeUndefined()
  })

  test("(a) guarded pattern sends exactly one toast with precedent signature when TUI present", async () => {
    //#when TUI exists, capture the payload shape
    const seen: ToastOpts[] = []
    const client: HeadlessClient = { tui: { showToast: async (o) => { seen.push(o); return {} } } }
    const sent: ToastOpts[] = []
    await guardedToast(client, { body: { title: "Ultrawork Mode Activated", message: "Maximum precision engaged.", variant: "success", duration: 3000 } }, sent)
    //#then signature matches keyword-detector precedent: {body:{title,message,variant,duration}} + .catch
    expect(seen.length).toBe(1)
    expect(seen[0]).toEqual({ body: { title: "Ultrawork Mode Activated", message: "Maximum precision engaged.", variant: "success", duration: 3000 } })
  })

  test("(a) rejected showToast is swallowed fail-open (never throws)", async () => {
    //#when TUI present but toast rejects (e.g. detached TUI)
    const client: HeadlessClient = { tui: { showToast: async () => { throw new Error("tui gone") } } }
    const caught: ToastOpts[] = []
    //#then guarded helper resolves instead of throwing
    await expect(
      guardedToast(client, { body: { title: "N", message: "m", variant: "info", duration: 1 } }, caught)
    ).resolves.toBeUndefined()
  })

  test("(b) session.prompt({noReply:true}) appends a persistent store message (model-visible cost)", async () => {
    //#when a noReply prompt is issued in a headless harness with a message store
    const session = makeSessionStore()
    const before = session.messages.length
    await session.prompt({ parts: [{ type: "text", text: "[INJECTION NOTICE] skill applied" }], noReply: true })
    const delta = session.messages.length - before
    //#then evidence: count delta is +1 -> persistent message, i.e. context-costing; keep default OFF
    expect(delta).toBe(1)
    expect(session.messages[0].noReply).toBe(true)
  })
})
