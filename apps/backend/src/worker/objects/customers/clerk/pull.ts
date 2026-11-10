/**
 * The scheduled pull and the connect-time backfill: one sweep of the Clerk instance, page by page,
 * in three phases held in the run's cursor so an evicted object resumes where it stopped.
 *
 * | Phase | Request | Writes | Requests per page |
 * |---|---|---|---|
 * | `organizations` | `/organizations?include_members_count=true` | accounts, incl. ones with no members | 1 |
 * | `members` | `/organization_memberships` + one batched `/users?user_id=…` | contacts, roles, sign-in days | 2 |
 * | `domains` | `/organization_domains?verified=true` | the accounts' domains | 1 |
 *
 * `/organization_memberships` carries each membership's whole organization and public user data,
 * so the member phase needs no per-organization request; the one extra call per page fetches the
 * hundred users behind the page (Clerk's `user_id` filter takes up to 100 ids) for their emails,
 * `last_sign_in_at` and `last_active_at`.
 *
 * None of Clerk's list endpoints filter by a change time, so `since` cannot narrow a sweep: every
 * pull walks the whole instance and ingest writes only what actually changed (unchanged rows never
 * reach the change log). Webhooks carry the live signal; the sweep is the reconciliation behind
 * them, which is why its period is hours rather than minutes.
 *
 * Because every pull lists every organization and membership, its last page sets
 * `sweep: ["account", "contact"]` and core removes the ones it did not see (deleted while no
 * webhook reached us). Offset paging skips a record when one before it is deleted mid-sweep, so
 * each page re-reads the last {@link PAGE_OVERLAP} rows of the one before; ops carry the time
 * Clerk was asked as `observedAt`, so a record removed wrongly all the same comes back on the next
 * sweep.
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../providers"
import type { ClerkGet } from "./http"
import { accountOp, domainsAccountOp, membershipOps, onNoMatchOf, type OnNoMatch } from "./map"
import { ClerkDomainsPage, ClerkMembershipsPage, ClerkOrganizationsPage, ClerkUsersList } from "./wire"

/** Clerk's list endpoints cap `limit` at 500; 100 keeps a page's work (and its retry) small. */
export const PAGE_SIZE = 100
/** Rows each page re-reads from the one before: up to this many deletions mid-sweep skip nothing. */
export const PAGE_OVERLAP = 10
/** Clerk's `user_id` filter takes at most 100 ids — exactly one membership page's worth. */
const USER_BATCH = 100

export const ClerkPhase = Schema.Literals(["organizations", "members", "domains"])
export type ClerkPhase = typeof ClerkPhase.Type

/** Which phase the sweep is in and how far into it; carried on the run as JSON. */
export const ClerkCursor = Schema.Struct({
	phase: ClerkPhase,
	offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type ClerkCursor = typeof ClerkCursor.Type

const START: ClerkCursor = { phase: "organizations", offset: 0 }

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(ClerkCursor))

/** An unreadable cursor (a format change between deploys) restarts the sweep; ingest is idempotent. */
export const decodeCursor = (cursor: string | null): ClerkCursor =>
	cursor === null ? START : Option.getOrElse(decodeDocument(cursor), () => START)

export const encodeCursor = (cursor: ClerkCursor): string => JSON.stringify(cursor)

const NEXT_PHASE = {
	organizations: "members",
	members: "domains",
	domains: null,
} satisfies Readonly<Record<ClerkPhase, ClerkPhase | null>>

/** Where a page starts: a little before the cursor, to re-read what a deletion shifted past it. */
const startOf = (cursor: ClerkCursor): number => Math.max(0, cursor.offset - PAGE_OVERLAP)

/** Where the sweep goes after a page: on in this phase, into the next one, or done. */
const advance = (cursor: ClerkCursor, received: number, total: number | undefined): string | null => {
	const done = startOf(cursor) + received
	const exhausted = received < PAGE_SIZE || (total !== undefined && done >= total)
	if (!exhausted) return encodeCursor({ phase: cursor.phase, offset: done })
	const next = NEXT_PHASE[cursor.phase]
	return next === null ? null : encodeCursor({ phase: next, offset: 0 })
}

const pageOf = (
	cursor: ClerkCursor,
	ops: ReadonlyArray<IngestOp>,
	received: number,
	total: number | undefined,
): PullPage => {
	const nextCursor = advance(cursor, received, total)
	const progress: SyncProgress = {
		step: cursor.phase,
		done: startOf(cursor) + received,
		total: total ?? null,
	}
	// Only the last page of a sweep, which listed every organization and membership.
	return nextCursor === null
		? { ops, nextCursor, progress, sweep: ["account", "contact"] }
		: { ops, nextCursor, progress }
}

const query = (cursor: ClerkCursor, extra: ReadonlyArray<readonly [string, string]> = []) => [
	["limit", String(PAGE_SIZE)] as const,
	["offset", String(startOf(cursor))] as const,
	...extra,
]

const organizationsPage = (get: ClerkGet, cursor: ClerkCursor, onNoMatch: OnNoMatch, at: IsoTimestamp) =>
	Effect.map(
		get("/organizations", query(cursor, [["include_members_count", "true"]]), ClerkOrganizationsPage),
		(body) =>
			pageOf(
				cursor,
				body.data.map((org) => accountOp(org, onNoMatch, at)),
				body.data.length,
				body.total_count,
			),
	)

const membersPage = Effect.fn("Clerk.membersPage")(function* (
	get: ClerkGet,
	cursor: ClerkCursor,
	onNoMatch: OnNoMatch,
	at: IsoTimestamp,
) {
	const body = yield* get("/organization_memberships", query(cursor), ClerkMembershipsPage)
	const userIds = [
		...new Set(
			body.data.flatMap((membership) =>
				membership.public_user_data === undefined ? [] : [membership.public_user_data.user_id],
			),
		),
	].slice(0, USER_BATCH)
	yield* Effect.annotateCurrentSpan("clerk.users", userIds.length)
	const users =
		userIds.length === 0
			? []
			: yield* get(
					"/users",
					[["limit", String(USER_BATCH)], ...userIds.map((id) => ["user_id", id] as const)],
					ClerkUsersList,
				)
	const byId = new Map(users.map((user) => [user.id, user]))
	// The organizations come first, once each: a contact's account must exist before it does.
	const seen = new Set<string>()
	const accounts: Array<IngestOp> = []
	for (const membership of body.data) {
		const org = membership.organization
		if (org === undefined || seen.has(org.id)) continue
		seen.add(org.id)
		accounts.push(accountOp(org, onNoMatch, at))
	}
	const members = body.data.flatMap((membership) =>
		membershipOps({
			membership,
			user: byId.get(membership.public_user_data?.user_id ?? ""),
			onNoMatch,
			withAccount: false,
			observedAt: at,
		}),
	)
	return pageOf(cursor, [...accounts, ...members], body.data.length, body.total_count)
})

const domainsPage = (get: ClerkGet, cursor: ClerkCursor, onNoMatch: OnNoMatch, at: IsoTimestamp) =>
	Effect.map(
		get("/organization_domains", query(cursor, [["verified", "true"]]), ClerkDomainsPage),
		(body) => {
			const byOrganization = new Map<string, Array<string>>()
			for (const domain of body.data) {
				const names = byOrganization.get(domain.organization_id)
				if (names === undefined) byOrganization.set(domain.organization_id, [domain.name])
				else names.push(domain.name)
			}
			const ops = [...byOrganization].map(([organizationId, names]) =>
				domainsAccountOp(organizationId, names, onNoMatch, at),
			)
			return pageOf(cursor, ops, body.data.length, body.total_count)
		},
	)

export const pullPage = Effect.fn("Clerk.pullPage")(function* (input: {
	readonly get: ClerkGet
	readonly cursor: string | null
	readonly config: ConnectionConfig
}) {
	const cursor = decodeCursor(input.cursor)
	const onNoMatch = onNoMatchOf(input.config)
	// A listing proves its records live as of the request: the ops' `observedAt`.
	const at = new Date(yield* Clock.currentTimeMillis).toISOString()
	const page: PullPage =
		cursor.phase === "organizations"
			? yield* organizationsPage(input.get, cursor, onNoMatch, at)
			: cursor.phase === "members"
				? yield* membersPage(input.get, cursor, onNoMatch, at)
				: yield* domainsPage(input.get, cursor, onNoMatch, at)
	yield* Effect.annotateCurrentSpan({
		"clerk.phase": cursor.phase,
		"clerk.offset": startOf(cursor),
		"clerk.received": page.progress.done - startOf(cursor),
		"clerk.total_count": page.progress.total ?? -1,
		"clerk.sweep_complete": page.sweep !== undefined,
	})
	return page
})
