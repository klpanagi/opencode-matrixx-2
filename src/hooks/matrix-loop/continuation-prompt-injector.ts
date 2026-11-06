import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { promptNativeWithModelSuggestionRetry } from "../../shared/model/model-suggestion-retry"
import { getMessageDir } from "../../shared/opencode/opencode-message-dir"
import { log } from "../../shared/runtime/logger"
import { withTimeout } from "../../shared/runtime/with-timeout"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { fetchSessionMessages } from "../../shared/session/session-context-source"

export async function injectContinuationPrompt(
	ctx: NativePluginContext,
	options: { sessionID: string; prompt: string; directory: string; apiTimeoutMs: number },
): Promise<void> {
	let agent: string | undefined
	let model: { providerID: string; modelID: string } | undefined

	try {
		const messages = await withTimeout(
			fetchSessionMessages(ctx, options.sessionID),
			options.apiTimeoutMs,
		)
		for (let i = messages.length - 1; i >= 0; i--) {
			const info = messages[i]
			if (info?.agent || info?.model) {
				agent = info.agent
				model = info.model
					? { providerID: info.model.providerID, modelID: info.model.modelID }
					: undefined
				break
			}
		}
	} catch {
		const messageDir = getMessageDir(options.sessionID)
		const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
		agent = currentMessage?.agent
		model =
			currentMessage?.model?.providerID && currentMessage?.model?.modelID
				? {
					providerID: currentMessage.model.providerID,
					modelID: currentMessage.model.modelID,
				}
				: undefined
	}

	await promptNativeWithModelSuggestionRetry(ctx.session, {
		sessionID: options.sessionID,
		...(agent !== undefined ? { agent } : {}),
		...(model !== undefined ? { model } : {}),
		parts: [{ type: "text", text: options.prompt }],
	})

	log("[matrix-loop] continuation injected", { sessionID: options.sessionID })
}
