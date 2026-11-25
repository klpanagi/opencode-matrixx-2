import { exec } from "node:child_process"
import { promisify } from "node:util"
import { redactSecrets } from "../text/redact-secrets"

const execAsync = promisify(exec)

type ExecOutcome = { stdout?: Buffer | string; stderr?: Buffer | string }
type ExecError = ExecOutcome & { message?: string }
type ExecImpl = (command: string, options: { timeout: number }) => Promise<ExecOutcome>

export interface ExecuteCommandOptions {
	timeoutMs?: number
	allowShell?: boolean
}

export class CommandNotAllowedError extends Error {
	constructor(command: string) {
		super(`shell execution is not allowed for command: ${command}`)
		this.name = "CommandNotAllowedError"
	}
}

const MAX_STDOUT_CHARS = 32 * 1024
const TRUNCATION_SUFFIX = "[…truncated]"

function truncateStdout(stdout: string): string {
	if (stdout.length <= MAX_STDOUT_CHARS) {
		return stdout
	}
	return stdout.slice(0, MAX_STDOUT_CHARS) + TRUNCATION_SUFFIX
}

function composeOutput(stdout: string, errText: string): string {
	const err = redactSecrets(errText)
	if (err) {
		return stdout ? `${stdout}\n[stderr: ${err}]` : `[stderr: ${err}]`
	}
	return stdout
}

export function createExecuteCommand(execImpl: ExecImpl = execAsync) {
	return async function executeCommand(command: string, options: ExecuteCommandOptions = {}): Promise<string> {
		const { timeoutMs = 30000 } = options
		if (options.allowShell !== true) {
			throw new CommandNotAllowedError(command)
		}

		try {
			const { stdout, stderr } = await execImpl(command, { timeout: timeoutMs })
			const out = truncateStdout(stdout?.toString().trim() ?? "")
			return composeOutput(out, stderr?.toString().trim() ?? "")
		} catch (error: unknown) {
			const e = error as ExecError
			const stdout = truncateStdout(e?.stdout?.toString().trim() ?? "")
			const stderr = e?.stderr?.toString().trim() ?? ""
			const errorMessage = redactSecrets(e?.message || String(error))
			return composeOutput(stdout, stderr || errorMessage)
		}
	}
}

export const executeCommand = createExecuteCommand()
