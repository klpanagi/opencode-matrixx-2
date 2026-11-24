import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../../runtime/logger"
import { TMUX_PROBE_TIMEOUT_MS } from "../constants"

export interface PaneDimensions {
	paneWidth: number
	windowWidth: number
}

export async function getPaneDimensions(
	paneId: string,
): Promise<PaneDimensions | null> {
	const tmux = await getTmuxPath()
	if (!tmux) return null

	const proc = Bun.spawn(
		[tmux, "display", "-p", "-t", paneId, "#{pane_width},#{window_width}"],
		{ stdout: "pipe", stderr: "pipe" },
	)

	let probeTimer: ReturnType<typeof setTimeout> | undefined
	const probeTimeout = new Promise<never>((_, reject) => {
		probeTimer = setTimeout(() => {
			proc.kill()
			reject(new Error("tmux display probe timed out"))
		}, TMUX_PROBE_TIMEOUT_MS)
	})

	let exitCode: number
	try {
		exitCode = await Promise.race([proc.exited, probeTimeout])
	} catch {
		log(
			`[tmux] pane dimension probe timed out after ${TMUX_PROBE_TIMEOUT_MS}ms`,
		)
		return null
	} finally {
		clearTimeout(probeTimer)
	}

	if (exitCode !== 0) return null

	const stdout = await new Response(proc.stdout).text()
	const [paneWidth, windowWidth] = stdout.trim().split(",").map(Number)
	if (Number.isNaN(paneWidth) || Number.isNaN(windowWidth)) return null

	return { paneWidth, windowWidth }
}
