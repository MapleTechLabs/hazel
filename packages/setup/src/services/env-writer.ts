import { Context, Console, Effect, Layer } from "effect"
import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"

/** Result of reading all env files - maps key to unique values with their sources */
export interface EnvReadResult {
	/** Map of key -> array of unique values found */
	values: Record<string, string[]>
	/** Map of key -> array of source files containing that key */
	sources: Record<string, string[]>
	/** Map of key+value -> source file (for display purposes) */
	valueSources: Record<string, string>
}

/** Files to scan for existing env values (`apps/backend/.env` predates `.env.local`) */
const ENV_FILE_PATHS = [
	".env.local",
	"apps/backend/.env",
	"bots/hazel-bot/.env",
	"bots/linear-bot/.env",
] as const

/** Parse a .env file content into key-value pairs */
const parseEnvContent = (content: string): Record<string, string> => {
	const result: Record<string, string> = {}
	for (const line of content.split("\n")) {
		const trimmed = line.trim()
		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith("#")) continue
		const eqIndex = trimmed.indexOf("=")
		if (eqIndex === -1) continue
		const key = trimmed.slice(0, eqIndex)
		let value = trimmed.slice(eqIndex + 1)
		// Handle quoted values
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		result[key] = value
	}
	return result
}

export class EnvWriter extends Context.Service<EnvWriter>()("EnvWriter", {
	make: Effect.succeed({
		writeEnvFile: (filePath: string, vars: Record<string, string>, dryRun: boolean = false) =>
			Effect.gen(function* () {
				const content = Object.entries(vars)
					.map(([key, value]) => `${key}=${value}`)
					.join("\n")

				if (dryRun) {
					yield* Console.log(`\n  Would write ${filePath}:`)
					yield* Console.log("  " + "-".repeat(40))
					for (const [key, value] of Object.entries(vars)) {
						const masked =
							key.includes("SECRET") || key.includes("PASSWORD") || key.includes("KEY")
								? value.slice(0, 4) + "..." + value.slice(-4)
								: value
						yield* Console.log(`  ${key}=${masked}`)
					}
				} else {
					const dir = dirname(filePath)
					yield* Effect.promise(() => mkdir(dir, { recursive: true }).catch(() => {}))
					yield* Effect.promise(() => Bun.write(filePath, content + "\n"))
					yield* Console.log(`  \u2713 ${filePath}`)
				}
			}),

		envFileExists: (filePath: string) => Effect.promise(() => Bun.file(filePath).exists()),

		backupExistingEnv: (filePath: string) =>
			Effect.gen(function* () {
				const file = Bun.file(filePath)
				const exists = yield* Effect.promise(() => file.exists())
				if (exists) {
					const backup = `${filePath}.backup.${Date.now()}`
					yield* Effect.promise(() => Bun.write(backup, file))
					yield* Console.log(`  Backed up ${filePath} to ${backup}`)
				}
			}),

		/** Read a single .env file and return parsed key-value pairs */
		readEnvFile: (filePath: string) =>
			Effect.gen(function* () {
				const file = Bun.file(filePath)
				const exists = yield* Effect.promise(() => file.exists())
				if (!exists) return {}
				const content = yield* Effect.promise(() => file.text())
				return parseEnvContent(content)
			}),

		/** Read all known .env files and aggregate values with their sources */
		readAllEnvFiles: () =>
			Effect.gen(function* () {
				const result: EnvReadResult = { values: {}, sources: {}, valueSources: {} }

				for (const filePath of ENV_FILE_PATHS) {
					const file = Bun.file(filePath)
					const exists = yield* Effect.promise(() => file.exists())
					if (!exists) continue

					const content = yield* Effect.promise(() => file.text())
					const parsed = parseEnvContent(content)

					for (const [key, value] of Object.entries(parsed)) {
						// Skip empty values
						if (!value) continue

						// Initialize arrays if needed
						if (!result.values[key]) {
							result.values[key] = []
							result.sources[key] = []
						}

						// Only add unique values
						if (!result.values[key].includes(value)) {
							result.values[key].push(value)
							result.valueSources[`${key}:${value}`] = filePath
						}

						// Track all sources for this key
						if (!result.sources[key].includes(filePath)) {
							result.sources[key].push(filePath)
						}
					}
				}

				return result
			}),
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
