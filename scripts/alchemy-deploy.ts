/**
 * `alchemy deploy <args>`, retried when Cloudflare rejects a Worker upload with
 * `ScriptStartupError` (code 10021, "Script startup exceeded CPU time limit"): it does so
 * intermittently while many Workers deploy at once, though startup is far under the limit.
 * Deploys are idempotent, so a rerun only redoes what did not land. Any other failure exits as is.
 *
 *   bun scripts/alchemy-deploy.ts --yes --adopt --stage prd
 */

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 15_000

/** The upload failure worth retrying. */
export const isStartupCpuError = (output: string) =>
	/ScriptStartupError|Script startup exceeded CPU time limit|\bcode\b\D{0,4}10021\b/i.test(output)

/** Runs `command`, streaming its output through, and returns its exit code and output. */
const runOnce = async (command: ReadonlyArray<string>) => {
	const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe", stdin: "inherit" })
	const chunks: Array<string> = []
	const pump = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream) => {
		const decoder = new TextDecoder()
		for await (const chunk of stream) {
			sink.write(chunk)
			chunks.push(decoder.decode(chunk, { stream: true }))
		}
	}
	await Promise.all([pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)])
	return { code: await child.exited, output: chunks.join("") }
}

export const deployWithRetry = async (command: ReadonlyArray<string>, delayMs = RETRY_DELAY_MS) => {
	for (let attempt = 1; ; attempt++) {
		const { code, output } = await runOnce(command)
		if (code === 0) return 0
		if (attempt >= MAX_ATTEMPTS || !isStartupCpuError(output)) return code
		console.error(
			`\n[alchemy-deploy] Cloudflare rejected a Worker with ScriptStartupError (10021); ` +
				`retrying (${attempt + 1}/${MAX_ATTEMPTS}) in ${delayMs / 1000}s`,
		)
		await Bun.sleep(delayMs)
	}
}

if (import.meta.main) {
	process.exit(await deployWithRetry(["alchemy", "deploy", ...process.argv.slice(2)]))
}
