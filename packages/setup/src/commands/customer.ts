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
	type BrokerSettings,
	brokerRegistryEntry,
	GENERATED_KEYS,
	type GeneratedSecrets,
	generateBrokerPrivateKey,
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
import { onlineChecks } from "../customer/cloudflare.ts"
import { isReleaseTag, latestRelease, RELEASE_TAG_GLOB } from "../customer/releases.ts"
import { TOKEN_PERMISSIONS } from "../customer/token.ts"
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

// ─── Git ────────────────────────────────────────────────────────────────────

/** Runs git in the repo; never fails, the exit code says how it went. */
const git = (args: ReadonlyArray<string>) =>
	Effect.promise(async () => {
		const proc = Bun.spawn(["git", ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" })
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		])
		return { code, stdout: stdout.trim(), stderr: stderr.trim() }
	})

/** Runs a command in the repo with the terminal attached; succeeds with its exit code. */
const run = (command: ReadonlyArray<string>, env?: Record<string, string>) =>
	Effect.promise(
		() =>
			Bun.spawn([...command], {
				cwd: REPO_ROOT,
				env: { ...process.env, ...env },
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			}).exited,
	)

/** Tracked files with changes: a deploy of them would report a commit it does not run. */
const dirtyFiles = git(["status", "--porcelain", "--untracked-files=no"]).pipe(
	Effect.map((result) => (result.code === 0 ? result.stdout : "")),
)

/** What the checkout is: its commit, and the release tag on it if any. */
const revision = Effect.gen(function* () {
	const sha = (yield* git(["rev-parse", "HEAD"])).stdout
	const tag = yield* git(["describe", "--tags", "--exact-match", "--match", RELEASE_TAG_GLOB, "HEAD"])
	return { sha, release: tag.code === 0 && isReleaseTag(tag.stdout) ? tag.stdout : undefined }
})

/** The commit and stage `GET https://api.<zone>/version` reports; undefined before the first deploy. */
const deployedVersion = (zone: string) =>
	Effect.tryPromise(async () => {
		const response = await fetch(`https://${customerHosts(zone).api}/version`, {
			signal: AbortSignal.timeout(10_000),
		})
		if (!response.ok) return undefined
		const body = (await response.json()) as { version?: unknown; stage?: unknown }
		return typeof body.version === "string" && body.version !== "unknown" ? body.version : undefined
	}).pipe(Effect.orElseSucceed(() => undefined))

// ─── Shared checks ──────────────────────────────────────────────────────────

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
		const { sha, release } = yield* revision
		if (release !== undefined) {
			yield* Console.log(pc.green("✓") + ` Release ${release} (${sha.slice(0, 12)})`)
		} else {
			yield* Console.log(
				pc.yellow(
					`⚠ ${sha.slice(0, 12)} is not a release: installs should run releases (bun run customer:upgrade ${name}).`,
				),
			)
		}
		const dirty = yield* dirtyFiles
		if (dirty !== "") {
			yield* Console.log(
				pc.yellow(
					`⚠ Uncommitted changes: /version will report ${sha.slice(0, 12)}, which is not what runs.`,
				),
			)
		}
		yield* Console.log(pc.dim(`\n$ ${command.join(" ")}\n`))
		// alchemy reads `--env-file` through its config; the process env covers what the stack
		// reads from `process.env` directly (and the web build's VITE_* keys).
		const code = yield* run(command, env)
		if (code !== 0) {
			return yield* failWith(
				`Deploy of ${stageOf(name)} failed (exit ${code}). Deploys are idempotent: fix the cause and run it again.`,
			)
		}
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

		// The broker identity: kept once generated (Hazel registers its public key).
		const brokerPrivateKey =
			(prior.OAUTH_BROKER_PRIVATE_KEY ?? "") !== ""
				? (prior.OAUTH_BROKER_PRIVATE_KEY ?? "")
				: yield* Effect.promise(generateBrokerPrivateKey)
		const broker: BrokerSettings = {
			instanceId:
				(prior.OAUTH_BROKER_INSTANCE_ID ?? "") !== ""
					? (prior.OAUTH_BROKER_INSTANCE_ID ?? name)
					: name,
			privateKey: brokerPrivateKey,
			url: prior.OAUTH_BROKER_URL || undefined,
			publicKey: prior.OAUTH_BROKER_PUBLIC_KEY || undefined,
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
			broker,
			operatorToken: prior.OPERATOR_TOKEN || secretsService.generatePassword(48),
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
			`The API token has, on that account and zone: ` +
				TOKEN_PERMISSIONS.map((p) => `${p.group}${p.required ? "" : " (recommended)"}`).join(", ") +
				`. The checks above verify it; an account-owned token is checked in full.`,
			`The account has a workers.dev subdomain (open Workers & Pages in the dashboard once).`,
			`Email sending: onboard ${hosts.mail} to Cloudflare Email Sending (invitations and support replies come from it).`,
			`Inbound support mail: enable Email Routing for ${hosts.inbound} (the deploy routes it to the api Worker).`,
			[
				...(github ? [`GitHub OAuth app callback: ${callbacks.github}`] : []),
				...(google ? [`Google OAuth client redirect URI: ${callbacks.google}`] : []),
			].join("\n     "),
			`Optional Slack sync: bun run slack:manifest --api-url https://${hosts.api}, then add SLACK_* to the env file.`,
			`Optional: integrations through Hazel's OAuth broker instead of your own apps. Send Hazel this ` +
				`instance's registry entry for OAUTH_BROKER_INSTANCES (public keys only):\n     ` +
				Option.getOrElse(
					brokerRegistryEntry(zone, broker),
					() => "(OAUTH_BROKER_PRIVATE_KEY is invalid)",
				) +
				`\n     then set OAUTH_BROKER_URL and OAUTH_BROKER_PUBLIC_KEY from Hazel in ${envFileName(name)}.`,
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

// ─── customer-upgrade ───────────────────────────────────────────────────────

const yesFlag = Flag.Boolean("yes").pipe(
	Flag.withAlias("y"),
	Flag.withDescription("Do not ask for confirmation"),
	Flag.withDefault(false),
)

/** A yes/no question, or `--yes`; without a terminal and without `--yes` the answer is no. */
const confirm = (message: string, yes: boolean) =>
	yes
		? Effect.succeed(true)
		: process.stdin.isTTY === true
			? Prompt.Confirm({ message, initial: false })
			: Effect.succeed(false)

/**
 * Moves the checkout to a release (the newest by default) and deploys it with the new code: the
 * deploy runs in a fresh process, so the release's own installer and stack do it.
 */
export const customerUpgradeCommand = Command.make(
	"customer-upgrade",
	{
		name: nameArgument,
		dir: dirFlag,
		to: flag("to", "Release tag (or any git ref) to deploy (default: the newest server-v* release)"),
		allowDowngrade: Flag.Boolean("allow-downgrade").pipe(
			Flag.withDescription(
				"Deploy a commit older than the one the install runs. Migrations only go forward: never for a release with new migrations",
			),
			Flag.withDefault(false),
		),
		yes: yesFlag,
	},
	({ name, dir, to, allowDowngrade, yes }) =>
		Effect.gen(function* () {
			const { env } = yield* loadForName(name, dir)
			const zone = normalizeZone(env.HAZEL_ZONE ?? "")
			yield* Console.log(
				`\n${pc.bold(`Upgrading ${stageOf(name)}`)} ${pc.dim(`https://${customerHosts(zone).web}`)}\n`,
			)

			const dirty = yield* dirtyFiles
			if (dirty !== "") {
				return yield* failWith(
					`The checkout has uncommitted changes; an upgrade switches commits. Commit or discard them first:\n${dirty}`,
				)
			}

			const fetched = yield* git(["fetch", "--tags", "--force", "origin"])
			if (fetched.code !== 0) {
				yield* Console.log(
					pc.yellow(`⚠ git fetch failed (${fetched.stderr}); using the tags already here`),
				)
			}
			const ref = Option.isSome(to)
				? to.value
				: latestRelease((yield* git(["tag", "-l", RELEASE_TAG_GLOB])).stdout.split("\n"))
			if (ref === undefined)
				return yield* failWith("No server release (server-v*) found. Pass --to <ref>.")
			const target = yield* git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
			if (target.code !== 0) return yield* failWith(`${ref} is not a commit in this checkout`)
			const targetSha = target.stdout
			if (!isReleaseTag(ref)) {
				yield* Console.log(
					pc.yellow(`⚠ ${ref} is not a release tag: releases are the commits Hazel runs itself.`),
				)
			}

			const deployed = yield* deployedVersion(zone)
			yield* Console.log(
				`  Running:  ${deployed === undefined ? pc.dim("unknown (not deployed, or unreachable)") : deployed.slice(0, 12)}`,
			)
			yield* Console.log(`  Target:   ${ref} (${targetSha.slice(0, 12)})`)
			if (deployed === targetSha) {
				yield* Console.log(
					pc.green(
						`\n✓ ${stageOf(name)} already runs ${ref}. To redeploy it as is: ${deployCommandText(name, REPO_ROOT)}\n`,
					),
				)
				return
			}
			if (deployed !== undefined) {
				const ancestry = yield* git(["merge-base", "--is-ancestor", deployed, targetSha])
				if (ancestry.code === 1 && !allowDowngrade) {
					return yield* failWith(
						`${ref} is older than what ${stageOf(name)} runs (${deployed.slice(0, 12)}). Migrations only go forward, ` +
							`so a downgrade can break the install; pass --allow-downgrade only if you know it adds none.`,
					)
				}
				if (ancestry.code !== 0 && ancestry.code !== 1) {
					yield* Console.log(
						pc.yellow(
							`⚠ The running commit ${deployed.slice(0, 12)} is not in this checkout: cannot check it is older.`,
						),
					)
				}
			}

			if (!(yield* confirm(`Deploy ${ref} to ${stageOf(name)}?`, yes))) {
				return yield* failWith("Not upgrading (pass --yes to skip this question)")
			}

			const checkout = yield* git(["checkout", "--detach", targetSha])
			if (checkout.code !== 0) return yield* failWith(`git checkout ${ref} failed: ${checkout.stderr}`)
			yield* Console.log(pc.green("✓") + ` Checked out ${ref} (detached; git switch - goes back)`)
			if ((yield* run(["bun", "install", "--frozen-lockfile"])) !== 0) {
				return yield* failWith(
					"bun install failed; the checkout is on the new release, nothing was deployed",
				)
			}
			const dirArgs = Option.match(dir, { onNone: () => [], onSome: (d) => ["--dir", d] })
			const code = yield* run(["bun", "run", "customer:deploy", name, ...dirArgs])
			if (code !== 0) return yield* Effect.sync(() => process.exit(code))
		}).pipe(Effect.catchTag("CustomerSetupError", reportAndExit)),
)

// ─── customer-destroy ───────────────────────────────────────────────────────

/** Deletes the whole install: every Worker, the directory D1, every Durable Object, the buckets. */
export const customerDestroyCommand = Command.make(
	"customer-destroy",
	{ name: nameArgument, dir: dirFlag, yes: yesFlag },
	({ name, dir, yes }) =>
		Effect.gen(function* () {
			const { path, env } = yield* loadForName(name, dir)
			const zone = normalizeZone(env.HAZEL_ZONE ?? "")
			yield* Console.log(
				pc.red(
					`\nThis deletes ${stageOf(name)} (https://${customerHosts(zone).web}) for good: its Workers, ` +
						`its directory database, every organization, channel and message, and its buckets. ` +
						`Point-in-time recovery cannot bring a deleted database or object back.\n`,
				),
			)
			if (!yes) {
				if (process.stdin.isTTY !== true)
					return yield* failWith("Pass --yes to destroy without a terminal")
				const typed = yield* Prompt.String({ message: `Type ${name} to confirm` })
				if (typed.trim() !== name) return yield* failWith("Not destroying: the name did not match")
			}
			const code = yield* run(
				["alchemy", "destroy", "--yes", "--stage", stageOf(name), "--env-file", path],
				env,
			)
			if (code !== 0) {
				return yield* failWith(
					`Destroy of ${stageOf(name)} failed (exit ${code}); run it again (a non-empty bucket may need emptying first)`,
				)
			}
			yield* Console.log(
				pc.green(
					`\n✓ Destroyed ${stageOf(name)}. ${envFileName(name)} is kept; delete it yourself.\n`,
				),
			)
		}).pipe(Effect.catchTag("CustomerSetupError", reportAndExit)),
)
