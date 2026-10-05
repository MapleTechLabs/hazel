/**
 * The api Worker's deploy-time env: every key the backend reads through `Config` (see
 * `services/`, `@hazel/auth`, `@hazel/integrations`). Plain values become vars, `Redacted` ones
 * Worker secrets. Read from the Worker's props only, never from its init.
 */
import type { HazelStackContext } from "@hazel/infra/cloudflare"
import {
	derived,
	merge,
	optionalPlain,
	optionalSecret,
	plainWithDefault,
	requirePlainEntry,
	requireSecretEntry,
	telemetryEnv,
} from "@hazel/infra/env"

export const apiEnv = ({ stage, urls }: HazelStackContext) =>
	merge(
		telemetryEnv(stage),
		derived("IS_DEV", stage.kind === "dev" ? "true" : "false"),
		derived("API_BASE_URL", urls.api),
		derived("FRONTEND_URL", urls.web),
		optionalPlain("COOKIE_DOMAIN"),

		// Auth (Clerk)
		requireSecretEntry("CLERK_SECRET_KEY"),
		requirePlainEntry("CLERK_PUBLISHABLE_KEY"),
		optionalSecret("CLERK_WEBHOOK_SECRET"),

		// Uploads: presigned against the bucket's S3 API (R2)
		requirePlainEntry("S3_BUCKET"),
		requirePlainEntry("S3_ENDPOINT"),
		optionalPlain("S3_REGION"),
		optionalPlain("S3_PUBLIC_URL"),
		requireSecretEntry("S3_ACCESS_KEY_ID"),
		requireSecretEntry("S3_SECRET_ACCESS_KEY"),

		// Workflows run on the Railway-hosted cluster (infra/cloudflare-migration-plan.md, Phase 5)
		requirePlainEntry("CLUSTER_URL"),

		// Bot gateway event delivery (Durable Streams until the BotGateway Durable Object lands)
		optionalPlain("DURABLE_STREAMS_URL"),
		optionalSecret("DURABLE_STREAMS_TOKEN"),

		// Integrations
		requireSecretEntry("INTEGRATION_ENCRYPTION_KEY"),
		optionalPlain("INTEGRATION_ENCRYPTION_KEY_VERSION"),
		optionalSecret("INTEGRATION_ENCRYPTION_KEY_PREV"),
		optionalPlain("INTEGRATION_ENCRYPTION_KEY_VERSION_PREV"),
		optionalPlain("LINEAR_CLIENT_ID"),
		optionalSecret("LINEAR_CLIENT_SECRET"),
		optionalPlain("DISCORD_CLIENT_ID"),
		optionalSecret("DISCORD_CLIENT_SECRET"),
		optionalSecret("DISCORD_BOT_TOKEN"),
		// Off until cutover: the Railway backend still holds the gateway session, and Discord
		// allows one per bot token.
		plainWithDefault("DISCORD_GATEWAY_ENABLED", "false"),
		optionalPlain("DISCORD_GATEWAY_INTENTS"),
		optionalPlain("GITHUB_APP_ID"),
		optionalPlain("GITHUB_APP_SLUG"),
		optionalSecret("GITHUB_APP_PRIVATE_KEY"),
		optionalSecret("GITHUB_WEBHOOK_SECRET"),
		optionalPlain("GITHUB_WEBHOOK_SKIP_SIGNATURE"),
		optionalSecret("INTERNAL_SECRET"),
		optionalSecret("KLIPY_API_KEY"),
	)
