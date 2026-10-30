import type { PluginInput } from "@opencode-ai/plugin";
import { isRecord } from "./record-type-guard"
import type { SessionContextCarrier } from "./session-context-source"
import { fetchSessionMessages } from "./session-context-source"
import { roleOf } from "./session-message"
import { getCachedTokenUsage } from "./token-cache"

const ANTHROPIC_ACTUAL_LIMIT =
  process.env.ANTHROPIC_1M_CONTEXT === "true" ||
  process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : 200_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_TARGET_MAX_TOKENS = 50_000;

interface AssistantMessageInfo {
	role: "assistant";
	tokens: {
		input: number;
		output: number;
		reasoning: number;
		cache: { read: number; write: number };
	};
}

type MessageSource = PluginInput | SessionContextCarrier

function asSessionCarrier(ctx: MessageSource): SessionContextCarrier | undefined {
	if (typeof ctx !== "object" || ctx === null) return undefined
	const session = (ctx as { session?: unknown }).session
	if (!isRecord(session) || typeof session.context !== "function") return undefined
	return { session: session as unknown as SessionContextCarrier["session"] }
}

function tokensOf(message: unknown): AssistantMessageInfo["tokens"] | undefined {
	const holders = [isRecord(message) ? message.info : undefined, isRecord(message) ? message.tokens : undefined]
	for (const holder of holders) {
		if (!isRecord(holder)) continue
		const candidate = holder as { input?: unknown; output?: unknown; reasoning?: unknown; cache?: unknown }
		if (typeof candidate.input !== "number") continue
		if (typeof candidate.output !== "number") continue
		if (typeof candidate.reasoning !== "number") continue
		if (!isRecord(candidate.cache)) continue
		if (typeof candidate.cache.read !== "number") continue
		if (typeof candidate.cache.write !== "number") continue
		return {
			input: candidate.input,
			output: candidate.output,
			reasoning: candidate.reasoning,
			cache: { read: candidate.cache.read, write: candidate.cache.write },
		}
	}
	return undefined
}

function isAssistantMessage(message: unknown): boolean {
	if (roleOf(message) === "assistant") return true
	const info = isRecord(message) ? message.info : undefined
	return isRecord(info) && info.role === "assistant"
}

interface TruncationResult {
	result: string;
	truncated: boolean;
	removedCount?: number;
}

interface TruncationOptions {
	targetMaxTokens?: number;
	preserveHeaderLines?: number;
	contextWindowLimit?: number;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function truncateToTokenLimit(
	output: string,
	maxTokens: number,
	preserveHeaderLines = 3,
): TruncationResult {
	if (typeof output !== 'string') {
		return { result: String(output ?? ''), truncated: false };
	}

	const currentTokens = estimateTokens(output);

	if (currentTokens <= maxTokens) {
		return { result: output, truncated: false };
	}

	const lines = output.split("\n");

	if (lines.length <= preserveHeaderLines) {
		const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
		return {
			result:
				output.slice(0, maxChars) +
				"\n\n[Output truncated due to context window limit]",
			truncated: true,
		};
	}

	const headerLines = lines.slice(0, preserveHeaderLines);
	const contentLines = lines.slice(preserveHeaderLines);

	const headerText = headerLines.join("\n");
	const headerTokens = estimateTokens(headerText);
	const truncationMessageTokens = 50;
	const availableTokens = maxTokens - headerTokens - truncationMessageTokens;

	if (availableTokens <= 0) {
		return {
			result:
				`${headerText}\n\n[Content truncated due to context window limit]`,
			truncated: true,
			removedCount: contentLines.length,
		};
	}

	const resultLines: string[] = [];
	let currentTokenCount = 0;

	for (const line of contentLines) {
		const lineTokens = estimateTokens(`${line}\n`);
		if (currentTokenCount + lineTokens > availableTokens) {
			break;
		}
		resultLines.push(line);
		currentTokenCount += lineTokens;
	}

	const truncatedContent = [...headerLines, ...resultLines].join("\n");
	const removedCount = contentLines.length - resultLines.length;

	return {
		result:
			truncatedContent +
			`\n\n[${removedCount} more lines truncated due to context window limit]`,
		truncated: true,
		removedCount,
	};
}

 async function getContextWindowUsage(
	ctx: MessageSource,
	sessionID: string,
): Promise<{
	usedTokens: number;
	remainingTokens: number;
	usagePercentage: number;
} | null> {
	const cached = getCachedTokenUsage(sessionID)
	if (cached) {
		const usedTokens =
			(cached.tokens.input ?? 0) +
			(cached.tokens.cache?.read ?? 0) +
			(cached.tokens.output ?? 0);
		const remainingTokens = ANTHROPIC_ACTUAL_LIMIT - usedTokens;
		return {
			usedTokens,
			remainingTokens,
			usagePercentage: usedTokens / ANTHROPIC_ACTUAL_LIMIT,
		};
	}

	const carrier = asSessionCarrier(ctx)
	if (!carrier) return null

	try {
		const response = await Promise.race([
			fetchSessionMessages(carrier, sessionID),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("SDK messages timeout after 5000ms")), 5000)
			),
		]);

		const assistantMessages: AssistantMessageInfo[] = []
		for (const message of response) {
			if (!isAssistantMessage(message)) continue
			const tokens = tokensOf(message)
			if (tokens) assistantMessages.push({ role: "assistant", tokens })
		}

		if (assistantMessages.length === 0) return null;

		const lastAssistant = assistantMessages[assistantMessages.length - 1];
		const lastTokens = lastAssistant.tokens;
		const usedTokens =
			(lastTokens?.input ?? 0) +
			(lastTokens?.cache?.read ?? 0) +
			(lastTokens?.output ?? 0);
		const remainingTokens = ANTHROPIC_ACTUAL_LIMIT - usedTokens;

		return {
			usedTokens,
			remainingTokens,
			usagePercentage: usedTokens / ANTHROPIC_ACTUAL_LIMIT,
		};
	} catch {
		return null;
	}
}

 async function dynamicTruncate(
	ctx: MessageSource,
	sessionID: string,
	output: string,
	options: TruncationOptions = {},
): Promise<TruncationResult> {
	if (typeof output !== 'string') {
		return { result: String(output ?? ''), truncated: false };
	}

	const {
		targetMaxTokens = DEFAULT_TARGET_MAX_TOKENS,
		preserveHeaderLines = 3,
	} = options;

	const usage = await getContextWindowUsage(ctx, sessionID);

	if (!usage) {
		// Fallback: apply conservative truncation when context usage unavailable
		return truncateToTokenLimit(output, targetMaxTokens, preserveHeaderLines);
	}

	const maxOutputTokens = Math.min(
		usage.remainingTokens * 0.5,
		targetMaxTokens,
	);

	if (maxOutputTokens <= 0) {
		return {
			result: "[Output suppressed - context window exhausted]",
			truncated: true,
		};
	}

	return truncateToTokenLimit(output, maxOutputTokens, preserveHeaderLines);
}

export function createDynamicTruncator(ctx: MessageSource) {
	return {
		truncate: (
			sessionID: string,
			output: string,
			options?: TruncationOptions,
		) => dynamicTruncate(ctx, sessionID, output, options),

		getUsage: (sessionID: string) => getContextWindowUsage(ctx, sessionID),

		truncateSync: (
			output: string,
			maxTokens: number,
			preserveHeaderLines?: number,
		) => truncateToTokenLimit(output, maxTokens, preserveHeaderLines),
	};
}
