import type { V2Event } from "./context"

type SessionStatus = { type: string }

export function normalizeSessionStatusToIdle(input: V2Event): V2Event | null {
	if (input.type !== "session.status") return null

	const props = input.data as Record<string, unknown> | undefined
	if (!props) return null

	const status = props.status as SessionStatus | undefined
	if (status?.type !== "idle") return null

	const sessionID = props.sessionID as string | undefined
	if (!sessionID) return null

	return {
		type: "session.idle",
		data: { sessionID },
	}
}
