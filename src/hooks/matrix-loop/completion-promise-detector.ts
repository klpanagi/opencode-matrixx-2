import { readFileSync } from "node:fs"
import { log, warn } from "../../shared/runtime/logger"
import { withTimeout } from "../../shared/runtime/with-timeout"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { fetchSessionMessages } from "../../shared/session/session-context-source"
import type { SessionMessage } from "../../shared/session/session-message"
import { contentOf, isAssistant } from "../../shared/session/session-message"
import { escapeRegExp as escapeRegex } from "../../shared/text/escape-regexp"
import { HOOK_NAME } from "./constants"

export type OpenCodeSessionMessage = SessionMessage

function buildPromisePattern(promise: string): RegExp {
	return new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
}

export function detectCompletionInTranscript(
	transcriptPath: string | undefined,
	promise: string,
): boolean {
	if (!transcriptPath) return false

	let content: string
	try {
		content = readFileSync(transcriptPath, "utf-8")
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ENOENT") {
			log(`[${HOOK_NAME}] Transcript not found; treating as incomplete`, { transcriptPath })
			return false
		}
		warn(`[${HOOK_NAME}] Transcript unreadable; treating as incomplete`, {
			transcriptPath,
			code,
			reason: error instanceof Error ? error.message : String(error),
		})
		return false
	}

	const pattern = buildPromisePattern(promise)
	const lines = content.split("\n").filter((line) => line.trim())
	let unparseableLines = 0

	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as { type?: string }
			if (entry.type === "user") continue
			if (pattern.test(line)) return true
		} catch {
			unparseableLines += 1
		}
	}

	if (unparseableLines > 0) {
		warn(`[${HOOK_NAME}] Transcript had unparseable lines; completion scan may be incomplete`, {
			transcriptPath,
			unparseableLines,
			totalLines: lines.length,
		})
	}

	return false
}

export async function detectCompletionInSessionMessages(
	ctx: NativePluginContext,
	options: {
		sessionID: string
		promise: string
		apiTimeoutMs: number
		directory: string
		preFetchedMessages?: OpenCodeSessionMessage[]
	},
): Promise<boolean> {
	try {
		const messageArray: OpenCodeSessionMessage[] = options.preFetchedMessages
			? options.preFetchedMessages
			: await withTimeout(fetchSessionMessages(ctx, options.sessionID), options.apiTimeoutMs)

		const assistantMessages = messageArray.filter((msg) => isAssistant(msg))
		if (assistantMessages.length === 0) return false

		const pattern = buildPromisePattern(options.promise)
		for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
			const assistant = assistantMessages[index]
			let responseText = ""
			for (const part of contentOf(assistant)) {
				if (part.type !== "text") continue
				responseText += `${responseText ? "\n" : ""}${part.text ?? ""}`
			}

			if (pattern.test(responseText)) {
				return true
			}
		}

		return false
	} catch (err) {
		setTimeout(() => {
			log(`[${HOOK_NAME}] Session messages check failed`, {
				sessionID: options.sessionID,
				error: String(err),
			})
		}, 0)
		return false
	}
}

