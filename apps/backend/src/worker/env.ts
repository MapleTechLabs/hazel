/**
 * The api Worker's deploy-time env: every key the backend reads through `Config` (see
 * `services/`, `@hazel/auth`, `@hazel/integrations`). Plain values become vars, `Redacted` ones
 * Worker secrets. Read from the Worker's props only, never from its init.
 */
import { type HazelStackContext, isProductionStage } from "@hazel/infra/cloudflare"
import { Config } from "effect"
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

/** A plain value the stack derives from the stage's domains, unless the environment sets it. */
const domainDefault = (key: string, domain: string | undefined) => optionalPlain(key, domain)

/**
 * A customer install's uploads live in a bucket the stack declares (`worker.ts`, `UPLOADS_S3`), so
 * it needs none of the `S3_*` keys; every other stage brings its own bucket through them.
 */
const uploadsEnv = ({ stage, domains }: HazelStackContext) =>
	stage.kind === "customer"
		? merge(
				optionalPlain("S3_BUCKET"),
				optionalPlain("S3_ENDPOINT"),
				optionalPlain("S3_REGION"),
				domainDefault("S3_PUBLIC_URL", domains.cdn && `https://${domains.cdn}`),
				optionalSecret("S3_ACCESS_KEY_ID"),
				optionalSecret("S3_SECRET_ACCESS_KEY"),
			)
		: merge(
				requirePlainEntry("S3_BUCKET"),
				requirePlainEntry("S3_ENDPOINT"),
				optionalPlain("S3_REGION"),
				optionalPlain("S3_PUBLIC_URL"),
				requireSecretEntry("S3_ACCESS_KEY_ID"),
				requireSecretEntry("S3_SECRET_ACCESS_KEY"),
			)

export const apiEnv = (stack: HazelStackContext) => {
	const { stage, urls, domains } = stack
	return merge(
		telemetryEnv(stage),
		derived("IS_DEV", stage.kind === "dev" ? "true" : "false"),
		// `prd` | `pr` | `customer` | `dev`: gates the routes that must never run in production
		// (`lib/stage.ts`, where `customer` counts as production).
		derived("HAZEL_STAGE", stage.kind),
		derived("API_BASE_URL", urls.api),
		derived("FRONTEND_URL", urls.web),
		optionalPlain("COOKIE_DOMAIN"),
		// Sender of invitation emails; its domain must be onboarded to Cloudflare Email Sending.
		optionalPlain("INVITE_EMAIL_FROM"),
		domainDefault("INVITE_EMAIL_DOMAIN", domains.mail),
		// Support mailboxes (`services/email/config.ts`).
		domainDefault("INBOUND_EMAIL_DOMAIN", domains.inboundMail),
		domainDefault("SUPPORT_EMAIL_DOMAIN", domains.mail),

		// Who may use this install (`apps/docs/content/docs/self-hosting/configuration.mdx`): sign-in
		// limited to these email domains (comma separated; unset: anyone), the instance admins
		// (comma-separated emails), and who may create an organization (`anyone` | `admins`).
		optionalPlain("ALLOWED_EMAIL_DOMAINS"),
		optionalPlain("INSTANCE_ADMIN_EMAILS"),
		optionalPlain("ORG_CREATION"),

		// Maple's OAuth tokens are still Clerk-issued (services/oauth-bearer-auth.ts); API v1 answers
		// 503 without this key.
		optionalSecret("CLERK_SECRET_KEY"),

		// Auth (Hazel sign-in): off until AUTH_GITHUB_CLIENT_ID or AUTH_GOOGLE_CLIENT_ID is set. Keys come from
		// `bun run --cwd packages/auth generate-keys`.
		optionalPlain("AUTH_GITHUB_CLIENT_ID"),
		optionalSecret("AUTH_GITHUB_CLIENT_SECRET"),
		optionalPlain("AUTH_GOOGLE_CLIENT_ID"),
		optionalSecret("AUTH_GOOGLE_CLIENT_SECRET"),
		optionalSecret("AUTH_BINDING_KEY"),
		optionalSecret("AUTH_TRANSACTION_KEY"),
		optionalPlain("AUTH_ACCESS_TOKEN_KID"),
		optionalSecret("AUTH_ACCESS_TOKEN_PRIVATE_JWK"),
		optionalPlain("AUTH_PASSKEY_RP_ID"),
		optionalPlain("AUTH_TRUSTED_ORIGINS"),
		// `POST /internal/dev/sign-in` (routes/dev-sign-in.http.ts): signs in as any email, so it
		// is never passed to prd. Also enables sign-in on a stage without a GitHub app.
		isProductionStage(stage) ? Config.succeed({}) : optionalSecret("DEV_SIGNIN_SECRET"),

		// Uploads: presigned against the bucket's S3 API (R2)
		uploadsEnv(stack),

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
		// Discord allows one gateway session per bot token: enable it on one stage only.
		plainWithDefault("DISCORD_GATEWAY_ENABLED", "false"),
		optionalPlain("DISCORD_GATEWAY_INTENTS"),
		optionalPlain("SLACK_CLIENT_ID"),
		optionalSecret("SLACK_CLIENT_SECRET"),
		// Verifies Slack's Events API deliveries (`POST /webhooks/slack`).
		optionalSecret("SLACK_SIGNING_SECRET"),
		optionalPlain("GITHUB_APP_ID"),
		optionalPlain("GITHUB_APP_SLUG"),
		optionalSecret("GITHUB_APP_PRIVATE_KEY"),
		optionalSecret("GITHUB_WEBHOOK_SECRET"),
		optionalPlain("GITHUB_WEBHOOK_SKIP_SIGNATURE"),
		// OAuth broker (`docs/self-hosting.md#brokered-integrations`). On Hazel's own install: the
		// broker, off unless OAUTH_BROKER_ENABLED=true; keys from `bun scripts/oauth-broker-keys.ts`.
		plainWithDefault("OAUTH_BROKER_ENABLED", "false"),
		optionalSecret("OAUTH_BROKER_STATE_KEY"),
		optionalSecret("OAUTH_BROKER_SIGNING_KEY"),
		optionalSecret("OAUTH_BROKER_INSTANCES"),
		// On a customer install: connect Slack, Linear and the GitHub App through Hazel's apps, for
		// any of them without its own keys above. The installer writes the instance id and key.
		optionalPlain("OAUTH_BROKER_URL"),
		optionalPlain("OAUTH_BROKER_INSTANCE_ID"),
		optionalSecret("OAUTH_BROKER_PRIVATE_KEY"),
		optionalPlain("OAUTH_BROKER_PUBLIC_KEY"),
		optionalSecret("KLIPY_API_KEY"),
		// Customers: company enrichment (`docs/customers/enrichment.md`); unset: off.
		optionalSecret("CONTEXT_DEV_API_KEY"),
		// Thread naming (services/thread-namer.ts) and support triage (services/decisions.ts); unset
		// disables both.
		optionalSecret("OPENROUTER_API_KEY"),
		// iOS push (services/apns.ts): an APNs auth key (.p8); any one unset disables push.
		optionalSecret("APNS_KEY_ID"),
		optionalSecret("APNS_TEAM_ID"),
		optionalSecret("APNS_PRIVATE_KEY"),
		// Operator point-in-time recovery (routes/operator.http.ts); unset: the endpoints answer 404.
		optionalSecret("OPERATOR_TOKEN"),
	)
}
