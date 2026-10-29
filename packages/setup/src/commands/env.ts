import { Command, Flag, Prompt } from "effect/cli"
import { Console, Effect, Redacted } from "effect"
import pc from "picocolors"
import { SecretGenerator } from "../services/secrets.ts"
import { EnvWriter } from "../services/env-writer.ts"
import {
	ENV_TEMPLATES,
	extractExistingConfig,
	getLocalMinioConfig,
	maskSecret,
	type Config,
	type S3Config,
} from "../templates.ts"
import { promptWithExisting, getExistingValue } from "../prompts.ts"

// CLI Options
export const force = Flag.Boolean("force").pipe(
	Flag.withAlias("f"),
	Flag.withDescription("Overwrite existing .env files without prompting"),
	Flag.withDefault(false),
)

export const dryRun = Flag.Boolean("dry-run").pipe(
	Flag.withAlias("n"),
	Flag.withDescription("Show what would be done without writing files"),
	Flag.withDefault(false),
)

export const envCommand = Command.make("env", { force, dryRun }, ({ force, dryRun }) =>
	Effect.gen(function* () {
		yield* Console.log(`\n${pc.bold("Hazel Environment Setup")}\n`)

		// Get services
		const envWriter = yield* EnvWriter
		const secrets = yield* SecretGenerator

		// Read existing .env files for smart prefilling
		const envResult = yield* envWriter.readAllEnvFiles()
		const existingConfig = extractExistingConfig(envResult)
		const hasExistingValues = Object.keys(envResult.values).length > 0

		// Check for existing .env files
		const hasExisting = yield* envWriter.envFileExists(".env.local")

		if (hasExisting && !force) {
			if (hasExistingValues) {
				yield* Console.log(pc.cyan("Found existing configuration - values will be prefilled"))
			}
			const overwrite = yield* Prompt.Confirm({
				message: "Existing .env.local found. Overwrite?",
				initial: hasExistingValues,
			})
			if (!overwrite) {
				yield* Console.log(pc.dim("Setup cancelled."))
				return
			}
		}

		// Step 1: Local services info
		yield* Console.log(pc.cyan("\u2500\u2500\u2500 Step 1: Local Services \u2500\u2500\u2500"))
		yield* Console.log(
			pc.dim(
				"  \u2022 The api Worker, its Durable Objects and the directory D1 run under `bun run alchemy:dev`",
			),
		)
		yield* Console.log(pc.dim("  \u2022 MinIO (Docker Compose) stands in for R2 uploads\n"))

		// Step 2: Sign-in
		yield* Console.log(pc.cyan("\u2500\u2500\u2500 Step 2: Sign-in \u2500\u2500\u2500"))
		yield* Console.log(
			pc.dim(
				"Hazel sign-in is off until AUTH_GITHUB_CLIENT_ID / AUTH_GITHUB_CLIENT_SECRET are set in .env.local.",
			),
		)
		yield* Console.log(
			pc.dim(
				`Generate its keys with ${pc.cyan("bun run --cwd packages/auth generate-keys")} and add them there too.\n`,
			),
		)

		// Step 3: Secrets - reuse existing or generate new
		yield* Console.log(pc.cyan("\u2500\u2500\u2500 Step 3: Secrets \u2500\u2500\u2500"))

		const existingEncryptionKey = getExistingValue(envResult, "INTEGRATION_ENCRYPTION_KEY")

		const generatedSecrets = {
			encryptionKey: existingEncryptionKey?.value ?? secrets.generateEncryptionKey(),
		}

		if (existingEncryptionKey) {
			yield* Console.log(
				pc.green("\u2713") +
					` Reusing INTEGRATION_ENCRYPTION_KEY (from ${existingEncryptionKey.source})`,
			)
		} else {
			yield* Console.log(pc.green("\u2713") + " Generated INTEGRATION_ENCRYPTION_KEY")
		}
		yield* Console.log("")

		// Step 4: Optional S3 setup
		yield* Console.log(pc.cyan("\u2500\u2500\u2500 Step 4: Optional Services \u2500\u2500\u2500"))

		// Check if S3 is already configured
		const existingS3Bucket = getExistingValue(envResult, "S3_BUCKET")
		const existingS3Endpoint = getExistingValue(envResult, "S3_ENDPOINT")

		let s3Config: S3Config | undefined

		if (existingS3Bucket && existingS3Endpoint) {
			yield* Console.log(pc.green("\u2713") + " Found existing S3 configuration")
			yield* Console.log(pc.dim(`  Bucket: ${existingS3Bucket.value}`))
			yield* Console.log(pc.dim(`  Endpoint: ${existingS3Endpoint.value}`))
			const keepS3 = yield* Prompt.Confirm({
				message: "Keep existing S3 configuration?",
				initial: true,
			})
			if (keepS3) {
				const existingAccessKeyId = getExistingValue(envResult, "S3_ACCESS_KEY_ID")
				const existingSecretAccessKey = getExistingValue(envResult, "S3_SECRET_ACCESS_KEY")
				const existingPublicUrl = getExistingValue(envResult, "VITE_R2_PUBLIC_URL")
				s3Config = {
					bucket: existingS3Bucket.value,
					endpoint: existingS3Endpoint.value,
					accessKeyId: existingAccessKeyId?.value ?? "",
					secretAccessKey: existingSecretAccessKey?.value ?? "",
					publicUrl: existingPublicUrl?.value ?? "",
				}
			}
		}

		if (!s3Config) {
			const setupS3 = yield* Prompt.Confirm({
				message: "Set up Cloudflare R2/S3 storage? (file uploads; local MinIO otherwise)",
				initial: false,
			})

			if (setupS3) {
				const bucket = yield* promptWithExisting({
					key: "S3_BUCKET",
					message: "S3 Bucket name",
					envResult,
				})
				const endpoint = yield* promptWithExisting({
					key: "S3_ENDPOINT",
					message: "S3 Endpoint URL",
					envResult,
				})
				const accessKeyId = yield* promptWithExisting({
					key: "S3_ACCESS_KEY_ID",
					message: "S3 Access Key ID",
					envResult,
				})
				const secretAccessKey = yield* promptWithExisting({
					key: "S3_SECRET_ACCESS_KEY",
					message: "S3 Secret Access Key",
					envResult,
					isSecret: true,
				})
				const publicUrl = yield* promptWithExisting({
					key: "VITE_R2_PUBLIC_URL",
					message: "Public CDN URL (for images)",
					envResult,
				})
				s3Config = { bucket, endpoint, accessKeyId, secretAccessKey, publicUrl }
			}
		}

		// Optional: Linear OAuth
		yield* Console.log(pc.cyan("\n\u2500\u2500\u2500 Optional: Linear Integration \u2500\u2500\u2500"))

		let linearConfig: { clientId: string; clientSecret: string } | undefined

		// Check if Linear is already configured
		if (existingConfig.linear) {
			yield* Console.log(pc.green("\u2713") + " Found existing Linear configuration")
			yield* Console.log(pc.dim(`  CLIENT_ID: ${maskSecret(existingConfig.linear.clientId.value)}`))
			const keepLinear = yield* Prompt.Confirm({
				message: "Keep existing Linear configuration?",
				initial: true,
			})
			if (keepLinear) {
				linearConfig = {
					clientId: existingConfig.linear.clientId.value,
					clientSecret: existingConfig.linear.clientSecret.value,
				}
			}
		}

		if (!linearConfig) {
			const setupLinear = yield* Prompt.Confirm({
				message: "Set up Linear OAuth? (for Linear integration)",
				initial: false,
			})

			if (setupLinear) {
				yield* Console.log(
					`Create a Linear OAuth app at ${pc.cyan("https://linear.app/settings/api")}`,
				)
				yield* Console.log(pc.dim("Set redirect URI: <api url>/integrations/linear/callback\n"))

				const clientId = yield* promptWithExisting({
					key: "LINEAR_CLIENT_ID",
					message: "Linear Client ID",
					envResult,
				})
				const clientSecret = yield* promptWithExisting({
					key: "LINEAR_CLIENT_SECRET",
					message: "Linear Client Secret",
					envResult,
					isSecret: true,
				})
				linearConfig = { clientId, clientSecret }
			}
		}

		// Optional: GitHub Webhook
		yield* Console.log(pc.cyan("\n\u2500\u2500\u2500 Optional: GitHub Integration \u2500\u2500\u2500"))

		let githubWebhookSecret: string | undefined

		// Check if GitHub is already configured
		if (existingConfig.githubWebhookSecret) {
			yield* Console.log(pc.green("\u2713") + " Found existing GitHub webhook secret")
			const keepGithub = yield* Prompt.Confirm({
				message: "Keep existing GitHub webhook secret?",
				initial: true,
			})
			if (keepGithub) {
				githubWebhookSecret = existingConfig.githubWebhookSecret.value
			}
		}

		if (!githubWebhookSecret) {
			const setupGithub = yield* Prompt.Confirm({
				message: "Set up GitHub webhook secret?",
				initial: false,
			})

			if (setupGithub) {
				yield* Console.log(pc.dim("Generate a random secret for GitHub webhook verification\n"))
				const useGenerated = yield* Prompt.Confirm({
					message: "Auto-generate a secure secret?",
					initial: true,
				})

				if (useGenerated) {
					githubWebhookSecret = secrets.generatePassword(32)
					yield* Console.log(`Generated: ${pc.cyan(githubWebhookSecret)}`)
					yield* Console.log(pc.dim("Save this for your GitHub webhook configuration\n"))
				} else {
					const secretRedacted = yield* Prompt.Password({ message: "GitHub Webhook Secret" })
					githubWebhookSecret = Redacted.value(secretRedacted)
				}
			}
		}

		// Optional: OpenRouter API
		yield* Console.log(pc.cyan("\n\u2500\u2500\u2500 Optional: AI Features \u2500\u2500\u2500"))

		let openrouterApiKey: string | undefined

		// Check if OpenRouter is already configured
		if (existingConfig.openrouterApiKey) {
			yield* Console.log(pc.green("\u2713") + " Found existing OpenRouter API key")
			const keepOpenRouter = yield* Prompt.Confirm({
				message: "Keep existing OpenRouter API key?",
				initial: true,
			})
			if (keepOpenRouter) {
				openrouterApiKey = existingConfig.openrouterApiKey.value
			}
		}

		if (!openrouterApiKey) {
			const setupOpenRouter = yield* Prompt.Confirm({
				message: "Set up OpenRouter API? (for AI thread naming)",
				initial: false,
			})

			if (setupOpenRouter) {
				yield* Console.log(`Get your API key at ${pc.cyan("https://openrouter.ai/keys")}\n`)
				openrouterApiKey = yield* promptWithExisting({
					key: "OPENROUTER_API_KEY",
					message: "OpenRouter API Key",
					envResult,
					isSecret: true,
				})
			}
		}

		// Step 5: Write .env files
		if (dryRun) {
			yield* Console.log(
				pc.cyan("\n\u2500\u2500\u2500 Step 5: Preview .env.local (dry-run) \u2500\u2500\u2500"),
			)
		} else {
			yield* Console.log(pc.cyan("\n\u2500\u2500\u2500 Step 5: Writing .env.local \u2500\u2500\u2500"))
		}

		// The api Worker requires S3: fall back to local MinIO.
		const s3 = s3Config ?? getLocalMinioConfig()
		const config: Config = {
			secrets: generatedSecrets,
			s3,
			s3PublicUrl: s3.publicUrl,
			linear: linearConfig,
			githubWebhookSecret,
			openrouterApiKey,
			botTokens: yield* envWriter.readBotTokens(),
		}

		yield* envWriter.writeEnvFile(".env.local", ENV_TEMPLATES.local(config), dryRun)

		if (dryRun) {
			yield* Console.log(pc.dim("\nDry-run complete! No files were written."))
			yield* Console.log(`Run without ${pc.cyan("--dry-run")} to apply these changes.\n`)
		} else {
			yield* Console.log(pc.green("\n\u2705 Setup complete!"))
			yield* Console.log(pc.bold("Next steps:"))
			yield* Console.log(`  1. Run ${pc.cyan("`docker compose up -d`")} to start MinIO (local S3)`)
			yield* Console.log(
				`  2. Run ${pc.cyan("`bun run dev`")} (\`alchemy:dev\`) to start the Workers and the web app`,
			)
			yield* Console.log(
				`  3. Optional: set ${pc.cyan("HAZEL_BOT_TOKEN")} / ${pc.cyan("LINEAR_BOT_TOKEN")} in .env.local to run the bots too\n`,
			)
		}
	}),
)
