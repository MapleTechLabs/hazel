import { Command, Flag, Prompt } from "effect/cli"
import { Console, Effect, Redacted } from "effect"
import pc from "picocolors"
import { SecretGenerator } from "../services/secrets.ts"
import { CredentialValidator } from "../services/validators.ts"
import { EnvWriter } from "../services/env-writer.ts"
import { ENV_TEMPLATES, extractExistingConfig, maskSecret, type Config, type S3Config } from "../templates.ts"
import { promptWithExisting, getExistingValue } from "../prompts.ts"

// CLI Options
export const skipValidation = Flag.Boolean("skip-validation").pipe(
	Flag.withDescription("Skip credential validation (API calls)"),
	Flag.withDefault(false),
)

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

export const envCommand = Command.make(
	"env",
	{ skipValidation, force, dryRun },
	({ skipValidation, force, dryRun }) =>
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
			const hasExisting = yield* envWriter.envFileExists("apps/backend/.env")

			if (hasExisting && !force) {
				if (hasExistingValues) {
					yield* Console.log(pc.cyan("Found existing configuration - values will be prefilled"))
				}
				const overwrite = yield* Prompt.Confirm({
					message: "Existing .env files found. Overwrite?",
					initial: hasExistingValues,
				})
				if (!overwrite) {
					yield* Console.log(pc.dim("Setup cancelled."))
					return
				}
			}

			// Step 1: Local services info
			yield* Console.log(
				pc.cyan("\u2500\u2500\u2500 Step 1: Database & Local Services \u2500\u2500\u2500"),
			)
			yield* Console.log("Using Docker Compose defaults:")
			yield* Console.log(pc.dim("  \u2022 PostgreSQL: postgresql://user:password@localhost:5432/app"))
			yield* Console.log(pc.dim("  \u2022 Redis: redis://localhost:6380"))
			yield* Console.log(pc.dim("  \u2022 Electric: http://localhost:3333\n"))

			// Validate database connection
			if (!skipValidation) {
				const validator = yield* CredentialValidator
				const dbResult = yield* validator
					.validateDatabase("postgresql://user:password@localhost:5432/app")
					.pipe(Effect.result)

				if (dbResult._tag === "Failure") {
					yield* Console.log(
						pc.yellow("\u26A0\uFE0F  Database not reachable.") +
							` Run ${pc.cyan("`docker compose up -d`")} first.`,
					)
					const continueAnyway = yield* Prompt.Confirm({
						message: "Continue anyway?",
						initial: true,
					})
					if (!continueAnyway) return
				} else {
					yield* Console.log(pc.green("\u2713") + " Database connected\n")
				}
			}

			// Step 2: Clerk setup
			yield* Console.log(pc.cyan("\u2500\u2500\u2500 Step 2: Clerk Authentication \u2500\u2500\u2500"))
			yield* Console.log("Clerk provides user authentication.")
			if (!existingConfig.clerkSecretKey) {
				yield* Console.log(`Create a free account at ${pc.cyan("https://dashboard.clerk.com")}\n`)
				yield* Console.log(pc.dim("1. Create a new application"))
				yield* Console.log(pc.dim("2. Go to API Keys \u2192 copy the Publishable key (pk_test_...)"))
				yield* Console.log(pc.dim("3. Go to API Keys \u2192 copy the Secret key (sk_test_...)"))
				yield* Console.log(
					pc.dim(
						"4. Go to Webhooks \u2192 add endpoint http://localhost:3003/webhooks/clerk \u2192 copy signing secret (whsec_...)",
					),
				)
				yield* Console.log(
					pc.dim("5. Enable Organizations + Slugs in the dashboard (required by this app)\n"),
				)
			} else {
				yield* Console.log(
					pc.dim("(Using existing credentials - press Enter to keep or type new value)\n"),
				)
			}

			const clerkSecretKey = yield* promptWithExisting({
				key: "CLERK_SECRET_KEY",
				message: "Enter your Clerk Secret Key",
				envResult,
				validate: (s) =>
					s.startsWith("sk_") ? Effect.succeed(s) : Effect.fail("Must start with sk_"),
				isSecret: true,
			})

			const clerkPublishableKey = yield* promptWithExisting({
				key: "CLERK_PUBLISHABLE_KEY",
				message: "Enter your Clerk Publishable Key",
				envResult,
				validate: (s) =>
					s.startsWith("pk_") ? Effect.succeed(s) : Effect.fail("Must start with pk_"),
			})

			const clerkWebhookSecret = yield* promptWithExisting({
				key: "CLERK_WEBHOOK_SECRET",
				message: "Enter your Clerk Webhook Signing Secret",
				envResult,
				validate: (s) =>
					s.startsWith("whsec_") ? Effect.succeed(s) : Effect.fail("Must start with whsec_"),
				isSecret: true,
			})

			// Validate Clerk credentials
			if (!skipValidation) {
				yield* Console.log(pc.dim("\nValidating Clerk credentials..."))
				const validator = yield* CredentialValidator
				const result = yield* validator
					.validateClerk(clerkSecretKey, clerkPublishableKey)
					.pipe(Effect.result)

				if (result._tag === "Failure") {
					yield* Console.log(pc.red(`\u274C Clerk validation failed: ${result.failure.message}`))
					yield* Console.log(pc.dim("Please check your credentials and try again."))
					return
				}
				yield* Console.log(pc.green("\u2713") + " Clerk credentials valid\n")
			}

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
					message: "Set up Cloudflare R2/S3 storage? (file uploads)",
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
			yield* Console.log(
				pc.cyan("\n\u2500\u2500\u2500 Optional: Linear Integration \u2500\u2500\u2500"),
			)

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
					yield* Console.log(
						pc.dim("Set redirect URI: http://localhost:3003/integrations/linear/callback\n"),
					)

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
			yield* Console.log(
				pc.cyan("\n\u2500\u2500\u2500 Optional: GitHub Integration \u2500\u2500\u2500"),
			)

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
					pc.cyan("\n\u2500\u2500\u2500 Step 5: Preview .env files (dry-run) \u2500\u2500\u2500"),
				)
			} else {
				yield* Console.log(
					pc.cyan("\n\u2500\u2500\u2500 Step 5: Writing .env files \u2500\u2500\u2500"),
				)
			}

			const config: Config = {
				clerkSecretKey,
				clerkPublishableKey,
				clerkWebhookSecret,
				secrets: generatedSecrets,
				s3: s3Config,
				s3PublicUrl: s3Config?.publicUrl,
				linear: linearConfig,
				githubWebhookSecret,
				openrouterApiKey,
			}

			yield* envWriter.writeEnvFile("apps/web/.env", ENV_TEMPLATES.web(config), dryRun)
			yield* envWriter.writeEnvFile("apps/backend/.env", ENV_TEMPLATES.backend(config), dryRun)
			yield* envWriter.writeEnvFile("apps/bot-gateway/.env", ENV_TEMPLATES.botGateway(), dryRun)
			yield* envWriter.writeEnvFile("apps/cluster/.env", ENV_TEMPLATES.cluster(config), dryRun)
			yield* envWriter.writeEnvFile(
				"apps/electric-proxy/.env",
				ENV_TEMPLATES.electricProxy(config),
				dryRun,
			)
			yield* envWriter.writeEnvFile("packages/db/.env", ENV_TEMPLATES.db(), dryRun)

			if (dryRun) {
				yield* Console.log(pc.dim("\nDry-run complete! No files were written."))
				yield* Console.log(`Run without ${pc.cyan("--dry-run")} to apply these changes.\n`)
			} else {
				yield* Console.log(pc.green("\n\u2705 Setup complete!"))
				yield* Console.log(pc.bold("Next steps:"))
				yield* Console.log(`  1. Run ${pc.cyan("`docker compose up -d`")} to start local services`)
				yield* Console.log(`  2. Run ${pc.cyan("`bun run db:push`")} to initialize the database`)
				yield* Console.log(
					`  3. Run ${pc.cyan("`bun run dev`")} to start the core apps and bot gateway`,
				)
				yield* Console.log(
					`  4. Optional: Run ${pc.cyan("`bun run dev:bots`")} to start local bot apps\n`,
				)
			}
		}),
)
