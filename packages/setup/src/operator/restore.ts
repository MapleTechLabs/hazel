/**
 * `bun run operator:restore` (`scripts/operator-restore.ts`): point-in-time recovery of one
 * install's data (`docs/self-hosting.md`, "Backups and restore").
 *
 * - `--kind org|channel|user|customers --id <id>`: one Durable Object, through the api's operator
 *   endpoints (`apps/backend/src/routes/operator.http.ts`) with the `OPERATOR_TOKEN` from the env.
 * - `--kind directory --db <database> | --customer <name>`: the directory D1 database, through
 *   `wrangler d1 time-travel` (Cloudflare credentials from the env, as wrangler reads them).
 *
 * `--dry-run` only looks the bookmark up; a restore asks for confirmation unless `--yes`.
 */
import { parseArgs } from "node:util"

export const OBJECT_KINDS = ["org", "channel", "user", "customers"] as const
export type ObjectKind = (typeof OBJECT_KINDS)[number]

/** Durable Objects and D1 Time Travel both keep 30 days. */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export const usage = [
	"Usage:",
	"  bun run operator:restore --api https://api.<zone> --kind org|channel|user|customers --id <id> --at <ISO time> [--dry-run] [--yes]",
	"  bun run operator:restore --kind directory (--db <database> | --customer <name>) --at <ISO time> [--dry-run] [--yes]",
	"",
	"Object restores read OPERATOR_TOKEN from the env; directory restores use wrangler's Cloudflare credentials",
	"(CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).",
].join("\n")

export type RestorePlan =
	| {
			readonly _tag: "Object"
			readonly api: string
			readonly kind: ObjectKind
			readonly id: string
			readonly at: string
			readonly dryRun: boolean
			readonly yes: boolean
	  }
	| {
			readonly _tag: "Directory"
			readonly database: string
			readonly at: string
			readonly dryRun: boolean
			readonly yes: boolean
	  }

export type ParseResult =
	| { readonly _tag: "Plan"; readonly plan: RestorePlan }
	| { readonly _tag: "Help" }
	| { readonly _tag: "Invalid"; readonly message: string }

const invalid = (message: string): ParseResult => ({ _tag: "Invalid", message })

/** `--at` as an ISO time inside the 30-day window. */
const parseTime = (value: string, now: number): string | undefined => {
	const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
	if (!Number.isFinite(ms) || ms > now || ms < now - WINDOW_MS) return undefined
	return new Date(ms).toISOString()
}

/** Parse the command line; never exits. */
export const parseRestoreArgs = (argv: ReadonlyArray<string>, now = Date.now()): ParseResult => {
	let values: Record<string, string | boolean | undefined>
	try {
		values = parseArgs({
			args: [...argv],
			options: {
				api: { type: "string" },
				kind: { type: "string" },
				id: { type: "string" },
				at: { type: "string" },
				db: { type: "string" },
				customer: { type: "string" },
				"dry-run": { type: "boolean" },
				yes: { type: "boolean", short: "y" },
				help: { type: "boolean", short: "h" },
			},
			strict: true,
			allowPositionals: false,
		}).values
	} catch (error) {
		return invalid(error instanceof Error ? error.message : String(error))
	}
	if (values.help) return { _tag: "Help" }
	const kind = values.kind
	if (typeof kind !== "string") return invalid("--kind is required")
	if (typeof values.at !== "string") return invalid("--at is required")
	const at = parseTime(values.at, now)
	if (at === undefined) return invalid(`--at "${values.at}" is not a time within the last 30 days`)
	const dryRun = values["dry-run"] === true
	const yes = values.yes === true

	if (kind === "directory") {
		if (typeof values.db === "string" && typeof values.customer === "string")
			return invalid("pass --db or --customer, not both")
		const database =
			typeof values.db === "string"
				? values.db
				: typeof values.customer === "string"
					? `hazel-directory-${values.customer}`
					: undefined
		if (database === undefined || !/^[A-Za-z0-9_-]+$/.test(database))
			return invalid("--kind directory needs --db <database> or --customer <name>")
		return { _tag: "Plan", plan: { _tag: "Directory", database, at, dryRun, yes } }
	}

	if (!(OBJECT_KINDS as ReadonlyArray<string>).includes(kind))
		return invalid(`--kind must be one of ${[...OBJECT_KINDS, "directory"].join(", ")}`)
	if (typeof values.id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(values.id))
		return invalid("--id must be the object's id (a UUID)")
	if (typeof values.api !== "string") return invalid("--api is required (https://api.<zone>)")
	let api: URL
	try {
		api = new URL(values.api)
	} catch {
		return invalid(`--api "${values.api}" is not a URL`)
	}
	if (api.protocol !== "https:" && api.hostname !== "localhost" && api.hostname !== "127.0.0.1")
		return invalid("--api must be https")
	return {
		_tag: "Plan",
		plan: {
			_tag: "Object",
			api: api.origin,
			kind: kind as ObjectKind,
			id: values.id.toLowerCase(),
			at,
			dryRun,
			yes,
		},
	}
}

/** The HTTP request an object plan makes. */
export const objectRequest = (plan: Extract<RestorePlan, { _tag: "Object" }>, token: string) => {
	const headers = { authorization: `Bearer ${token}` }
	if (plan.dryRun) {
		const query = new URLSearchParams({ kind: plan.kind, id: plan.id, timestamp: plan.at })
		return {
			url: `${plan.api}/internal/operator/bookmark?${query.toString()}`,
			init: { method: "GET", headers } satisfies RequestInit,
		}
	}
	return {
		url: `${plan.api}/internal/operator/restore`,
		init: {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: JSON.stringify({ kind: plan.kind, id: plan.id, timestamp: plan.at }),
		} satisfies RequestInit,
	}
}

/** The wrangler command a directory plan runs. */
export const directoryCommand = (plan: Extract<RestorePlan, { _tag: "Directory" }>): Array<string> =>
	plan.dryRun
		? ["bunx", "wrangler", "d1", "time-travel", "info", plan.database, "--timestamp", plan.at]
		: ["bunx", "wrangler", "d1", "time-travel", "restore", plan.database, "--timestamp", plan.at]

/** What the operator must type to confirm a restore. */
export const confirmationWord = (plan: RestorePlan) => (plan._tag === "Object" ? plan.id : plan.database)
