/**
 * Installing Hazel into a customer's own Cloudflare account (`docs/self-hosting.md`):
 *
 * - `customer`: asks for (or takes as flags) the install's settings, generates its secrets, writes
 *   `.env.customer-<name>`, and prints what to register and the deploy command (`--deploy` runs it).
 * - `customer-check <name>`: checks that env file, and the Cloudflare token and zone.
 * - `customer-deploy <name>`: checks it, then deploys stage `customer-<name>` with it.
 */
import { Argument, Command, Flag, Prompt } from "effect/cli"
import { Console, Effect, Option, Redacted, Schema } from "effect"
import { chmod } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { pc } from "../colors"
import {
	type Check,
	checkCustomerEnv,
	type CustomerInput,
	customerHosts,
	envFileName,
	GENERATED_KEYS,
	type GeneratedSecrets,
	hasSignInProvider,
	NAME_RE,
	normalizeZone,
	oauthCallbackUrls,
	ORG_CREATION_MODES,
	parseEnv,
	renderCustomerEnv,
	stageOf,
	ZONE_RE,
} from "../customer/install.ts"
import { SecretGenerator } from "../services/secrets.ts"

/** The repo root: `packages/setup/src/commands` → four levels up. */
const REPO_ROOT = resolve(import.meta.dir, "../../../..")

class CustomerSetupError extends Schema.TaggedError<CustomerSetupError, { readonly brand: unique symbol }>()(
	"CustomerSetupError",
	{
		message: Schema.String,
	},
) {}

const failWith = (message: string) => Effect.fail(new CustomerSetupError({ message }))

const reportAndExit = (error: CustomerSetupError) =>
	Console.error(pc.red(`\n✗ ${error.message}\n`)).pipe(Effect.andThen(Effect.sync(() => process.exit(1))))

const section = (title: string) => Console.log(pc.cyan(`\n─── ${title} ───`))

const formatCheck = (check: Check) => {
	const icon =
		check.status === "ok" ? pc.green("✓") : check.status === "warn" ? pc.yellow("⚠") : pc.red("✗")
	const message =
		check.status === "fail"
			? pc.red(check.message)
			: check.status === "warn"
				? pc.yellow(check.message)
				: check.message
	return `  ${icon} ${pc.bold(check.name)}: ${message}`
}

const envFilePath = (dir: string, name: string) => resolve(dir, envFileName(name))

const readEnvFile = (path: string) =>
	Effect.promise(async () => {
		const file = Bun.file(path)
		return (await file.exists()) ? parseEnv(await file.text()) : undefined
	})

/**
 * Fresh auth keys from `packages/auth/scripts/generate-keys.ts` itself (it prints `KEY=value`
 * lines), so the installer never drifts from what the auth package expects.
 */
const generateAuthKeys = Effect.tryPromise({
	try: async () => {
		const proc = Bun.spawn(["bun", "packages/auth/scripts/generate-keys.ts"], {
			cwd: REPO_ROOT,
			stdout: "pipe",
			stderr: "pipe",
		})
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		])
		if (code !== 0) throw new Error(stderr.trim() || `exited with ${code}`)
		return parseEnv(stdout)
	},
	catch: (error) =>
		new CustomerSetupError({
			message: `Generating auth keys (packages/auth/scripts/generate-keys.ts) failed: ${error instanceof Error ? error.message : String(error)}`,
		}),
})

// ─── Shared checks ──────────────────────────────────────────────────────────

const cloudflareGet = (path: string, token: string) =>
	Effect.tryPromise(async () => {
		const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
			headers: { authorization: `Bearer ${token}` },
		})
		return {
			status: response.status,
			body: (await response.json().catch(() => ({}))) as {
				success?: boolean
				result?: unknown
				errors?: ReadonlyArray<{ message?: string }>
			},
		}
	})

/** The token is live, and the zone is in the account (needs Zone:Read, which the deploy needs anyway). */
const onlineChecks = (env: Record<string, string>): Effect.Effect<Array<Check>> =>
	Effect.gen(function* () {
		const token = env.CLOUDFLARE_API_TOKEN ?? ""
		const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? ""
		const zone = normalizeZone(env.HAZEL_ZONE ?? "")
		if (!token || !accountId) return []
		const checks: Array<Check> = []

		// User tokens verify on /user/tokens, account-owned ones on the account.
		const user = yield* cloudflareGet("/user/tokens/verify", token)
		const verified =
			user.body.success === true ||
			(yield* cloudflareGet(`/accounts/${accountId}/tokens/verify`, token)).body.success === true
		checks.push(
			verified
				? { name: "Cloudflare token", status: "ok", message: "active" }
				: {
						name: "Cloudflare token",
						status: "fail",
						message: "Cloudflare rejects it (expired, revoked or mistyped)",
					},
		)
		if (!verified || !zone) return checks

		const zones = yield* cloudflareGet(
			`/zones?${new URLSearchParams({ name: zone, "account.id": accountId })}`,
			token,
		)
		const result = Array.isArray(zones.body.result)
			? (zones.body.result as Array<{ status?: string }>)
			: []
		checks.push(
			!zones.body.success
				? {
						name: "Zone",
						status: "warn",
						message: `could not list zones (${zones.body.errors?.[0]?.message ?? zones.status}); the token needs Zone:Read`,
					}
				: result.length === 0
					? {
							name: "Zone",
							status: "fail",
							message: `${zone} is not a zone in account ${accountId}`,
						}
					: result[0]?.status === "active"
						? { name: "Zone", status: "ok", message: `${zone} is active` }
						: {
								name: "Zone",
								status: "warn",
								message: `${zone} is ${result[0]?.status ?? "not active"}: point its nameservers at Cloudflare first`,
							},
		)
		return checks
	}).pipe(
		Effect.orElseSucceed((): Array<Check> => [
			{
				name: "Cloudflare",
				status: "warn",
				message: "could not reach api.cloudflare.com; skipped the online checks",
			},
		]),
	)

/** Prints the checks; succeeds with whether none failed. */
const runChecks = (name: string, env: Record<string, string>, online: boolean) =>
	Effect.gen(function* () {
		const checks = [...checkCustomerEnv(name, env), ...(online ? yield* onlineChecks(env) : [])]
		for (const check of checks) yield* Console.log(formatCheck(check))
		return !checks.some((check) => check.status === "fail")
	})

const deploy = (name: string, path: string, env: Record<string, string>) =>
	Effect.gen(function* () {
		const command = [
			"bun",
			"scripts/alchemy-deploy.ts",
			"--yes",
			"--stage",
			stageOf(name),
			"--env-file",
			path,
		]
		yield* Console.log(pc.dim(`\n$ ${command.join(" ")}\n`))
		const code = yield* Effect.promise(async () => {
			// alchemy reads `--env-file` through its config; the process env covers what the stack
			// reads from `process.env` directly (and the web build's VITE_* keys).
			const proc = Bun.spawn(command, {
				cwd: REPO_ROOT,
				env: { ...process.env, ...env },
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			})
			return proc.exited
		})
		if (code !== 0) return yield* failWith(`Deploy of ${stageOf(name)} failed (exit ${code})`)
		const hosts = customerHosts(normalizeZone(env.HAZEL_ZONE ?? ""))
		yield* Console.log(pc.green(`\n✅ Deployed ${stageOf(name)}: https://${hosts.web}`))
	})

const deployCommandText = (name: string, dir: string) =>
	`bun run customer:deploy ${name}${dir === REPO_ROOT ? "" : ` --dir ${dir}`}`

// ─── customer ───────────────────────────────────────────────────────────────

const flag = (name: string, description: string) =>
	Flag.String(name).pipe(Flag.withDescription(description), Flag.optional)

const offlineFlag = Flag.Boolean("offline").pipe(
	Flag.withDescription("Skip the checks that call the Cloudflare API"),
	Flag.withDefault(false),
)

const installFlags = {
	name: flag("name", "Instance name: the stage is customer-<name> ([a-z0-9][a-z0-9-]*)"),
	zone: flag("zone", "Cloudflare zone the install lives under (app.<zone>, api.<zone>, ...)"),
	accountId: flag("account-id", "Cloudflare account id (default: $CLOUDFLARE_ACCOUNT_ID)"),
	apiToken: flag("api-token", "Cloudflare API token (default: $CLOUDFLARE_API_TOKEN)"),
	githubClientId: flag("github-client-id", "GitHub OAuth app client id (sign-in; GitHub, Google or both)"),
	githubClientSecret: flag(
		"github-client-secret",
		"GitHub OAuth app client secret (default: $AUTH_GITHUB_CLIENT_SECRET)",
	),
	googleClientId: flag("google-client-id", "Google OAuth client id (sign-in; GitHub, Google or both)"),
	googleClientSecret: flag(
		"google-client-secret",
		"Google OAuth client secret (default: $AUTH_GOOGLE_CLIENT_SECRET)",
	),
	allowedEmailDomains: flag(
		"allowed-email-domains",
		"Only these email domains may sign in (comma separated)",
	),
	adminEmails: flag("admin-emails", "Instance admins (comma-separated emails)"),
	orgCreation: Flag.Literals("org-creation", ORG_CREATION_MODES).pipe(
		Flag.withDescription("Who may create organizations: anyone (default) or admins"),
		Flag.optional,
	),
	dir: flag("dir", "Directory to write .env.customer-<name> into (default: the repo root)"),
	force: Flag.Boolean("force").pipe(
		Flag.withDescription(
			"Regenerate the install's secrets. Signs everyone out and breaks stored integrations",
		),
		Flag.withDefault(false),
	),
	nonInteractive: Flag.Boolean("non-interactive").pipe(
		Flag.withAlias("y"),
		Flag.withDescription("Never prompt: take every value from flags, the existing file or the env"),
		Flag.withDefault(false),
	),
	offline: offlineFlag,
	deploy: Flag.Boolean("deploy").pipe(
		Flag.withDescription("Deploy right after writing the env file"),
		Flag.withDefault(false),
	),
}

const validator = (test: (value: string) => string | undefined) => (value: string) => {
	const error = test(value.trim())
	return error === undefined ? Effect.succeed(value.trim()) : Effect.fail(error)
}

const validateName = validator((v) =>
	NAME_RE.test(v) ? undefined : "Use lower-case letters, digits and dashes",
)
const validateZone = validator((v) =>
	ZONE_RE.test(normalizeZone(v)) ? undefined : "Enter a DNS zone, e.g. chat.acme.com",
)
const validateAccountId = validator((v) =>
	/^[0-9a-f]{32}$/.test(v) ? undefined : "A 32-character hex account id",
)
const required = validator((v) => (v === "" ? "Required" : undefined))
const anything = validator(() => undefined)

export const customerCommand = Command.make("customer", installFlags, (flags) =>
	Effect.gen(function* () {
		const interactive = !flags.nonInteractive && process.stdin.isTTY === true
		const secretsService = yield* SecretGenerator

		/**
		 * A value from its flag, else `fallback` (the existing file or the env), else a prompt; without
		 * a terminal a missing required value fails naming its flag.
		 */
		const value = (options: {
			readonly flag: Option.Option<string>
			readonly flagName: string
			readonly message: string
			readonly fallback?: string | undefined
			readonly secret?: boolean
			readonly optional?: boolean
			readonly validate?: (value: string) => Effect.Effect<string, string>
		}) =>
			Effect.gen(function* () {
				const validate = options.validate ?? (options.optional ? anything : required)
				const given = Option.getOrUndefined(options.flag) ?? options.fallback
				if (given !== undefined && given !== "") {
					return yield* validate(given).pipe(
						Effect.mapError(
							(error) => new CustomerSetupError({ message: `--${options.flagName}: ${error}` }),
						),
					)
				}
				if (!interactive) {
					if (options.optional) return ""
					return yield* failWith(`--${options.flagName} is required (no terminal to prompt on)`)
				}
				if (options.secret) {
					const answer = Redacted.value(
						yield* Prompt.Password({
							message: options.message,
							validate: (v) => (options.optional && v === "" ? Effect.succeed(v) : validate(v)),
						}),
					)
					return answer.trim()
				}
				return yield* Prompt.String({
					message: options.message,
					validate: (v) => (options.optional && v.trim() === "" ? Effect.succeed("") : validate(v)),
				})
			})

		yield* Console.log(`\n${pc.bold("\u{1F33F} Hazel customer install")}`)
		yield* Console.log(
			pc.dim(
				"Writes .env.customer-<name> for stage customer-<name>; nothing is deployed without --deploy.",
			),
		)

		// ── Instance ──
		yield* section("Instance")
		const name = yield* value({
			flag: flags.name,
			flagName: "name",
			message: "Instance name (stage customer-<name>)",
			validate: validateName,
		})
		const dir = Option.match(flags.dir, {
			onNone: () => REPO_ROOT,
			onSome: (d) => (isAbsolute(d) ? d : resolve(process.cwd(), d)),
		})
		const path = envFilePath(dir, name)
		const existing = yield* readEnvFile(path)
		if (existing) yield* Console.log(pc.green("✓") + ` Found ${path}: its values are the defaults`)
		const prior = existing ?? {}
		const env = (key: string) => prior[key] || process.env[key] || undefined

		const zone = normalizeZone(
			yield* value({
				flag: flags.zone,
				flagName: "zone",
				message: "Cloudflare zone (app.<zone>, api.<zone>, ...)",
				fallback: prior.HAZEL_ZONE,
				validate: validateZone,
			}),
		)
		const callbacks = oauthCallbackUrls(zone)

		// ── Cloudflare ──
		yield* section("Cloudflare")
		yield* Console.log(pc.dim("The account the zone is in, and an API token that can deploy into it."))
		const cloudflareAccountId = yield* value({
			flag: flags.accountId,
			flagName: "account-id",
			message: "Cloudflare account id",
			fallback: env("CLOUDFLARE_ACCOUNT_ID"),
			validate: validateAccountId,
		})
		const cloudflareApiToken = yield* value({
			flag: flags.apiToken,
			flagName: "api-token",
			message: "Cloudflare API token",
			fallback: env("CLOUDFLARE_API_TOKEN"),
			secret: true,
		})

		// ── Sign-in ──
		yield* section("Sign-in")
		yield* Console.log(
			pc.dim(
				"Users sign in with GitHub, Google or both (and passkeys once signed in): set up at least one.",
			),
		)
		// A provider given by flag, or already in the env file, is kept without asking.
		const offer = (options: {
			readonly flag: Option.Option<string>
			readonly prior: string | undefined
			readonly message: string
			readonly initial: boolean
		}) =>
			Option.isSome(options.flag) || (options.prior ?? "") !== ""
				? Effect.succeed(true)
				: interactive
					? Prompt.Confirm({ message: options.message, initial: options.initial })
					: Effect.succeed(false)

		let github: CustomerInput["github"]
		const githubIdFallback = prior.AUTH_GITHUB_CLIENT_ID
		if (
			yield* offer({
				flag: flags.githubClientId,
				prior: githubIdFallback,
				message: "Offer GitHub sign-in?",
				initial: true,
			})
		) {
			yield* Console.log(
				pc.dim("GitHub: create an OAuth app at https://github.com/settings/developers"),
			)
			yield* Console.log(pc.dim(`  Homepage URL:      https://${customerHosts(zone).web}`))
			yield* Console.log(pc.dim(`  Callback URL:      ${callbacks.github}`))
			github = {
				clientId: yield* value({
					flag: flags.githubClientId,
					flagName: "github-client-id",
					message: "GitHub client id",
					fallback: githubIdFallback,
				}),
				clientSecret: yield* value({
					flag: flags.githubClientSecret,
					flagName: "github-client-secret",
					message: "GitHub client secret",
					fallback: env("AUTH_GITHUB_CLIENT_SECRET"),
					secret: true,
				}),
			}
		}

		let google: CustomerInput["google"]
		const googleIdFallback = prior.AUTH_GOOGLE_CLIENT_ID
		if (
			yield* offer({
				flag: flags.googleClientId,
				prior: googleIdFallback,
				message: github === undefined ? "Offer Google sign-in?" : "Also offer Google sign-in?",
				// Without GitHub, Google is the only way in.
				initial: github === undefined,
			})
		) {
			yield* Console.log(
				pc.dim(`Google: an OAuth client (Web application) with redirect URI ${callbacks.google}`),
			)
			google = {
				clientId: yield* value({
					flag: flags.googleClientId,
					flagName: "google-client-id",
					message: "Google client id",
					fallback: googleIdFallback,
				}),
				clientSecret: yield* value({
					flag: flags.googleClientSecret,
					flagName: "google-client-secret",
					message: "Google client secret",
					fallback: env("AUTH_GOOGLE_CLIENT_SECRET"),
					secret: true,
				}),
			}
		}

		if (!hasSignInProvider({ github, google })) {
			return yield* failWith(
				"Sign-in needs a GitHub or a Google OAuth app: pass --github-client-id and --github-client-secret, " +
					"or --google-client-id and --google-client-secret (or both).",
			)
		}

		// ── Access ──
		yield* section("Access")
		const allowedEmailDomains = yield* value({
			flag: flags.allowedEmailDomains,
			flagName: "allowed-email-domains",
			message: "Allowed email domains, comma separated (empty: anyone may sign in)",
			fallback: prior.ALLOWED_EMAIL_DOMAINS,
			optional: true,
		})
		const instanceAdminEmails = yield* value({
			flag: flags.adminEmails,
			flagName: "admin-emails",
			message: "Instance admin emails, comma separated (optional)",
			fallback: prior.INSTANCE_ADMIN_EMAILS,
			optional: true,
		})
		const priorOrgCreation = ORG_CREATION_MODES.find((mode) => mode === prior.ORG_CREATION)
		const orgCreation = Option.isSome(flags.orgCreation)
			? flags.orgCreation.value
			: priorOrgCreation !== undefined || !interactive
				? priorOrgCreation
				: yield* Prompt.Select({
						message: "Who may create organizations?",
						choices: [
							{ title: "Anyone who can sign in", value: "anyone" as const },
							{ title: "Instance admins only", value: "admins" as const },
						],
					})

		// ── Secrets ──
		yield* section("Secrets")
		const priorSecrets = GENERATED_KEYS.filter((key) => (prior[key] ?? "") !== "")
		let secrets: GeneratedSecrets
		if (priorSecrets.length === GENERATED_KEYS.length && !flags.force) {
			secrets = {
				INTEGRATION_ENCRYPTION_KEY: prior.INTEGRATION_ENCRYPTION_KEY ?? "",
				AUTH_BINDING_KEY: prior.AUTH_BINDING_KEY ?? "",
				AUTH_TRANSACTION_KEY: prior.AUTH_TRANSACTION_KEY ?? "",
				AUTH_ACCESS_TOKEN_KID: prior.AUTH_ACCESS_TOKEN_KID ?? "",
				AUTH_ACCESS_TOKEN_PRIVATE_JWK: prior.AUTH_ACCESS_TOKEN_PRIVATE_JWK ?? "",
			}
			yield* Console.log(pc.green("✓") + " Keeping the install's generated secrets")
		} else if (priorSecrets.length > 0 && !flags.force) {
			return yield* failWith(
				`${path} has only some of the generated secrets (${priorSecrets.join(", ")}). Restore the rest from ` +
					`your backup, or pass --force to regenerate all of them (signs everyone out, breaks stored integrations).`,
			)
		} else {
			if (priorSecrets.length > 0) {
				yield* Console.log(
					pc.yellow(
						"⚠ --force: regenerating every secret. Once deployed, everyone is signed out and every " +
							"connected integration has to be reconnected.",
					),
				)
			}
			const auth = yield* generateAuthKeys
			secrets = {
				INTEGRATION_ENCRYPTION_KEY: secretsService.generateEncryptionKey(),
				AUTH_BINDING_KEY: auth.AUTH_BINDING_KEY ?? "",
				AUTH_TRANSACTION_KEY: auth.AUTH_TRANSACTION_KEY ?? "",
				AUTH_ACCESS_TOKEN_KID: auth.AUTH_ACCESS_TOKEN_KID ?? "",
				AUTH_ACCESS_TOKEN_PRIVATE_JWK: auth.AUTH_ACCESS_TOKEN_PRIVATE_JWK ?? "",
			}
			yield* Console.log(pc.green("✓") + ` Generated ${GENERATED_KEYS.join(", ")}`)
		}

		const input: CustomerInput = {
			name,
			zone,
			cloudflareAccountId,
			cloudflareApiToken,
			github,
			google,
			allowedEmailDomains: allowedEmailDomains || undefined,
			instanceAdminEmails: instanceAdminEmails || undefined,
			orgCreation,
		}
		const content = renderCustomerEnv(input, secrets, prior)
		yield* Effect.promise(() => Bun.write(path, content))
		yield* Effect.promise(() => chmod(path, 0o600))
		yield* Console.log(pc.green("✓") + ` Wrote ${path} (mode 600)`)

		// ── Checks ──
		yield* section("Checks")
		const written = parseEnv(content)
		const healthy = yield* runChecks(name, written, !flags.offline)

		// ── Before deploying ──
		const hosts = customerHosts(zone)
		yield* section("Before the first deploy")
		const steps = [
			`${zone} is an active zone in Cloudflare account ${cloudflareAccountId} (its DNS on Cloudflare).`,
			`The API token can edit, in that account: Workers Scripts, Workers KV, D1, R2, Durable Objects, ` +
				`Email Sending and Email Routing, and create API tokens (alchemy mints the uploads bucket's S3 credentials); ` +
				`in the zone: DNS, Workers Routes and Zone Settings (custom domains for ${hosts.web}, ${hosts.api}, ` +
				`${hosts.linkPreview}, ${hosts.botGateway}, ${hosts.cdn}).`,
			`Email sending: onboard ${hosts.mail} to Cloudflare Email Sending (invitations and support replies come from it).`,
			`Inbound support mail: enable Email Routing for ${hosts.inbound} (the deploy routes it to the api Worker).`,
			[
				...(github ? [`GitHub OAuth app callback: ${callbacks.github}`] : []),
				...(google ? [`Google OAuth client redirect URI: ${callbacks.google}`] : []),
			].join("\n     "),
			`Optional Slack sync: bun run slack:manifest --api-url https://${hosts.api}, then add SLACK_* to the env file.`,
			`Back up ${envFileName(name)} (password manager or secret store): losing it means losing the install's keys.`,
		]
		for (const [index, step] of steps.entries()) yield* Console.log(`  ${index + 1}. ${step}`)

		yield* section("Deploy")
		yield* Console.log(`  ${pc.cyan(deployCommandText(name, dir))}`)
		yield* Console.log(
			pc.dim(
				`  (runs: bun scripts/alchemy-deploy.ts --yes --stage ${stageOf(name)} --env-file ${envFileName(name)})`,
			),
		)
		yield* Console.log(pc.dim(`  Then open https://${hosts.web}`))

		if (flags.deploy) {
			if (!healthy) return yield* failWith("Not deploying: fix the failed checks above first")
			yield* deploy(name, path, written)
		}
	}).pipe(Effect.catchTag("CustomerSetupError", reportAndExit)),
)

// ─── customer-check / customer-deploy ───────────────────────────────────────

const nameArgument = Argument.String("name").pipe(
	Argument.withDescription("Instance name: reads .env.customer-<name>"),
)
const dirFlag = installFlags.dir
const loadForName = (name: string, dir: Option.Option<string>) =>
	Effect.gen(function* () {
		const root = Option.match(dir, {
			onNone: () => REPO_ROOT,
			onSome: (d) => (isAbsolute(d) ? d : resolve(process.cwd(), d)),
		})
		const path = envFilePath(root, name)
		const env = yield* readEnvFile(path)
		if (!env) return yield* failWith(`${path} not found. Run: bun run customer:install --name ${name}`)
		return { path, env, root }
	})

export const customerCheckCommand = Command.make(
	"customer-check",
	{ name: nameArgument, dir: dirFlag, offline: offlineFlag },
	({ name, dir, offline }) =>
		Effect.gen(function* () {
			const { path, env, root } = yield* loadForName(name, dir)
			yield* Console.log(`\n${pc.bold(`Hazel customer install: ${stageOf(name)}`)} ${pc.dim(path)}\n`)
			const healthy = yield* runChecks(name, env, !offline)
			yield* Console.log(
				healthy
					? pc.green(`\nReady to deploy: ${deployCommandText(name, root)}\n`)
					: pc.red("\nSome checks failed. Fix them before deploying.\n"),
			)
			if (!healthy) return yield* Effect.sync(() => process.exit(1))
		}).pipe(Effect.catchTag("CustomerSetupError", reportAndExit)),
)

export const customerDeployCommand = Command.make(
	"customer-deploy",
	{ name: nameArgument, dir: dirFlag },
	({ name, dir }) =>
		Effect.gen(function* () {
			const { path, env } = yield* loadForName(name, dir)
			yield* Console.log(`\n${pc.bold(`Deploying ${stageOf(name)}`)} ${pc.dim(path)}\n`)
			const healthy = yield* runChecks(name, env, true)
			if (!healthy) return yield* failWith("Not deploying: fix the failed checks above first")
			yield* deploy(name, path, env)
		}).pipe(Effect.catchTag("CustomerSetupError", reportAndExit)),
)
