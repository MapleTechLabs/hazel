import type { EnvReadResult } from "./services/env-writer.ts"

export interface S3Config {
	bucket: string
	endpoint: string
	accessKeyId: string
	secretAccessKey: string
	publicUrl: string
}

/** Represents an env value with its source file(s) */
export interface EnvValue {
	value: string
	source: string
}

/** Existing configuration extracted from .env files */
export interface ExistingConfig {
	encryptionKey?: EnvValue
	linear?: {
		clientId: EnvValue
		clientSecret: EnvValue
	}
	githubApp?: {
		appId: EnvValue
		appSlug: EnvValue
		privateKey: EnvValue
	}
	githubWebhookSecret?: EnvValue
	openrouterApiKey?: EnvValue
	klipyApiKey?: EnvValue
}

/** Get a single value from env result (picks first if multiple) */
const getEnvValue = (result: EnvReadResult, key: string): EnvValue | undefined => {
	const values = result.values[key]
	if (!values || values.length === 0) return undefined
	const value = values[0]
	const source = result.valueSources[`${key}:${value}`] ?? "unknown"
	return { value, source }
}

/** Extract existing configuration from env read result */
export const extractExistingConfig = (result: EnvReadResult): ExistingConfig => {
	const config: ExistingConfig = {}

	const encryptionKey = getEnvValue(result, "INTEGRATION_ENCRYPTION_KEY")
	if (encryptionKey) config.encryptionKey = encryptionKey

	// Linear
	const linearClientId = getEnvValue(result, "LINEAR_CLIENT_ID")
	const linearClientSecret = getEnvValue(result, "LINEAR_CLIENT_SECRET")
	if (linearClientId && linearClientSecret) {
		config.linear = {
			clientId: linearClientId,
			clientSecret: linearClientSecret,
		}
	}

	// GitHub App
	const githubAppId = getEnvValue(result, "GITHUB_APP_ID")
	const githubAppSlug = getEnvValue(result, "GITHUB_APP_SLUG")
	const githubAppPrivateKey = getEnvValue(result, "GITHUB_APP_PRIVATE_KEY")
	if (githubAppId && githubAppSlug && githubAppPrivateKey) {
		config.githubApp = {
			appId: githubAppId,
			appSlug: githubAppSlug,
			privateKey: githubAppPrivateKey,
		}
	}

	// GitHub webhook
	const githubWebhookSecret = getEnvValue(result, "GITHUB_WEBHOOK_SECRET")
	if (githubWebhookSecret) config.githubWebhookSecret = githubWebhookSecret

	// OpenRouter
	const openrouterApiKey = getEnvValue(result, "OPENROUTER_API_KEY")
	if (openrouterApiKey) config.openrouterApiKey = openrouterApiKey

	// Klipy
	const klipyApiKey = getEnvValue(result, "KLIPY_API_KEY")
	if (klipyApiKey) config.klipyApiKey = klipyApiKey

	return config
}

/** Get all unique values for a key with their sources */
export const getEnvValues = (result: EnvReadResult, key: string): EnvValue[] => {
	const values = result.values[key]
	if (!values || values.length === 0) return []
	return values.map((value) => ({
		value,
		source: result.valueSources[`${key}:${value}`] ?? "unknown",
	}))
}

/** Mask a secret value for display (show first/last 4 chars) */
export const maskSecret = (value: string): string => {
	if (value.length <= 8) return "****"
	return `${value.slice(0, 4)}...${value.slice(-4)}`
}

export const getLocalMinioConfig = (): S3Config => ({
	bucket: "hazel",
	endpoint: "http://localhost:9000",
	accessKeyId: "minioadmin",
	secretAccessKey: "minioadmin",
	publicUrl: "http://localhost:9000/hazel",
})

export interface Config {
	secrets: {
		encryptionKey: string
	}
	s3?: S3Config
	s3PublicUrl?: string
	linear?: {
		clientId: string
		clientSecret: string
	}
	githubApp?: {
		appId: string
		appSlug: string
		privateKey: string
	}
	githubWebhookSecret?: string
	openrouterApiKey?: string
	klipyApiKey?: string
	/** Tokens of the first-party bots, kept from an earlier setup: alchemy dev runs a bot with one. */
	botTokens?: BotTokens
}

export interface BotTokens {
	hazelBot?: string
	linearBot?: string
}

/**
 * The env file setup writes. `.env.local` (repo root) is everything `bun run alchemy:dev` reads:
 * alchemy hands it to the Workers it runs locally (the api and its Durable Objects, the bot
 * gateway, the bots) and to the web build; the directory D1 and the objects' SQLite live under
 * `.alchemy/`.
 */
export const ENV_TEMPLATES = {
	local: (config: Config) => {
		const base: Record<string, string> = {
			// Encryption
			INTEGRATION_ENCRYPTION_KEY: config.secrets.encryptionKey,
			INTEGRATION_ENCRYPTION_KEY_VERSION: "1",
		}

		// Uploads (required by the api Worker)
		if (config.s3) {
			base.S3_BUCKET = config.s3.bucket
			base.S3_ENDPOINT = config.s3.endpoint
			base.S3_ACCESS_KEY_ID = config.s3.accessKeyId
			base.S3_SECRET_ACCESS_KEY = config.s3.secretAccessKey
			base.S3_PUBLIC_URL = config.s3.publicUrl
		}
		if (config.s3PublicUrl) base.VITE_R2_PUBLIC_URL = config.s3PublicUrl

		// Linear config (always present, empty if not configured)
		base.LINEAR_CLIENT_ID = config.linear?.clientId ?? ""
		base.LINEAR_CLIENT_SECRET = config.linear?.clientSecret ?? ""

		// GitHub App config (always present, empty if not configured)
		base.GITHUB_APP_ID = config.githubApp?.appId ?? ""
		base.GITHUB_APP_SLUG = config.githubApp?.appSlug ?? ""
		base.GITHUB_APP_PRIVATE_KEY = config.githubApp?.privateKey ?? ""
		base.GITHUB_WEBHOOK_SECRET = config.githubWebhookSecret ?? ""

		// Thread naming
		base.OPENROUTER_API_KEY = config.openrouterApiKey ?? ""

		// Klipy GIF search
		base.KLIPY_API_KEY = config.klipyApiKey ?? ""

		// First-party bots (bots/*): alchemy dev runs each one whose token is set
		if (config.botTokens?.hazelBot) base.HAZEL_BOT_TOKEN = config.botTokens.hazelBot
		if (config.botTokens?.linearBot) base.LINEAR_BOT_TOKEN = config.botTokens.linearBot

		return base
	},
}
