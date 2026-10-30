import { existsSync, readFileSync } from "node:fs"
import { escapeRegExp as escapeRegex } from "../../shared/escape-regexp"
import { log } from "../../shared/logger"
import type { NativePluginContext } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import type { SessionMessage } from "../../shared/session-message"
import { contentOf, isAssistant } from "../../shared/session-message"
import { withTimeout } from "../../shared/with-timeout"
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

	try {
		if (!existsSync(transcriptPath)) return false

		const content = readFileSync(transcriptPath, "utf-8")
		const pattern = buildPromisePattern(promise)
		const lines = content.split("\n").filter((line) => line.trim())

		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as { type?: string }
				if (entry.type === "user") continue
				if (pattern.test(line)) return true
			} catch {
			}
		}
		return false
	} catch {
		return false
	}
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

