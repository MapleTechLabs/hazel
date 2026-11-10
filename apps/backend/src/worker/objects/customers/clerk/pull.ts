/**
 * The scheduled pull and the connect-time backfill: one sweep of the Clerk instance, page by page,
 * in three phases held in the run's cursor so an evicted object resumes where it stopped.
 *
 * | Phase | Request | Writes | Requests per page |
 * |---|---|---|---|
 * | `organizations` | `/organizations?include_members_count=true` | accounts, incl. ones with no members | 1 |
 * | `members` | `/organization_memberships` + one batched `/users?user_id=…` | contacts, roles, last active days | 2 |
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
 * webhook reached us). Every listing asks for `order_by=+created_at`, oldest first, so a record
 * created mid-sweep lands at the end rather than shifting the rows not read yet. A deletion still
 * shifts them back, which offset paging would skip, so each page re-reads the last
 * {@link PAGE_OVERLAP} rows of the one before, and the cursor keeps the previous page's last id: if
 * it is not among those re-read rows, more were deleted than the overlap covers (or rows created in
 * the same millisecond came back in another order) and something may have been skipped. Clerk
 * orders rows created in the same millisecond no fixed way, so a page ending in at least
 * {@link PAGE_OVERLAP} of them may see the next request list one it never read before the rows it
 * re-reads. Either way the sweep goes on but is `partial`, and its last page sets no `sweep`:
 * nothing is removed on the strength of a listing that may have missed a record. Ops carry the time Clerk was asked as
 * `observedAt`, so a record removed wrongly all the same comes back on the next sweep.
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../providers"
import type { CustomerProviderError } from "../provider-errors"
import type { ClerkGet } from "./http"
import { accountOp, domainsAccountOp, membershipOps, onNoMatchOf, type OnNoMatch } from "./map"
import { ClerkDomainsPage, ClerkMembershipsPage, ClerkOrganizationsPage, ClerkUsersList } from "./wire"

/** Clerk's list endpoints cap `limit` at 500; 100 keeps a page's work (and its retry) small. */
export const PAGE_SIZE = 100
/** Rows each page re-reads from the one before: up to this many deletions mid-sweep skip nothing. */
export const PAGE_OVERLAP = 10
/** Clerk's `user_id` filter takes at most 100 ids — exactly one membership page's worth. */
const USER_BATCH = 100

const ClerkPhase = Schema.Literals(["organizations", "members", "domains"])
type ClerkPhase = typeof ClerkPhase.Type

/** Which phase the sweep is in and how far into it; carried on the run as JSON. */
const ClerkCursor = Schema.Struct({
	phase: ClerkPhase,
	offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	/** The previous page's last row, which this page must re-read. */
	lastId: Schema.optionalKey(Schema.String),
	/** A page may have skipped a record: the sweep removes nothing at its end. */
	partial: Schema.optionalKey(Schema.Literal(true)),
})
type ClerkCursor = typeof ClerkCursor.Type

const START: ClerkCursor = { phase: "organizations", offset: 0 }

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(ClerkCursor))

/** The run's cursor; `None` when it cannot be read (a format change between deploys). */
export const decodeCursor = (cursor: string | null): Option.Option<ClerkCursor> =>
	cursor === null ? Option.some(START) : decodeDocument(cursor)

export const encodeCursor = (cursor: ClerkCursor): string => JSON.stringify(cursor)

const NEXT_PHASE = {
	organizations: "members",
	members: "domains",
	domains: null,
} satisfies Readonly<Record<ClerkPhase, ClerkPhase | null>>

/** Where a page starts: a little before the cursor, to re-read what a deletion shifted past it. */
const startOf = (cursor: ClerkCursor): number => Math.max(0, cursor.offset - PAGE_OVERLAP)

interface Row {
	readonly id: string
	readonly created_at?: number | null | undefined
}

/** One page of a phase: its ops, the rows Clerk listed, in order, and Clerk's total. */
interface Listing {
	readonly ops: ReadonlyArray<IngestOp>
	readonly rows: ReadonlyArray<Row>
	readonly total: number | undefined
}

/** The previous page's last row is not among the rows this page re-read: rows shifted past it. */
const shiftedPast = (cursor: ClerkCursor, rows: ReadonlyArray<Row>): boolean =>
	cursor.lastId !== undefined && !rows.slice(0, PAGE_OVERLAP).some((row) => row.id === cursor.lastId)

/** The phase has no rows past this page. */
const exhaustedBy = (cursor: ClerkCursor, { rows, total }: Listing): boolean =>
	rows.length < PAGE_SIZE || (total !== undefined && startOf(cursor) + rows.length >= total)

/** At least {@link PAGE_OVERLAP} rows end the page created in the same millisecond. */
const tiedAtEnd = (rows: ReadonlyArray<Row>): boolean => {
	const tail = rows.slice(-PAGE_OVERLAP)
	return tail.length === PAGE_OVERLAP && tail.every((row) => row.created_at === tail[0]?.created_at)
}

const pageOf = (cursor: ClerkCursor, listing: Listing, partial: boolean): PullPage => {
	const { ops, rows, total } = listing
	const done = startOf(cursor) + rows.length
	const exhausted = exhaustedBy(cursor, listing)
	const flag = partial ? { partial: true as const } : {}
	const nextPhase = NEXT_PHASE[cursor.phase]
	// A page that is not the phase's last is full, so it has a last row.
	const lastId = rows.at(-1)?.id
	const next: ClerkCursor | null =
		!exhausted && lastId !== undefined
			? { phase: cursor.phase, offset: done, lastId, ...flag }
			: nextPhase === null
				? null
				: { phase: nextPhase, offset: 0, ...flag }
	const progress: SyncProgress = { step: cursor.phase, done, total: total ?? null }
	if (next !== null) return { ops, nextCursor: encodeCursor(next), progress }
	// Only the last page of a sweep that listed every organization and membership, none skipped.
	return partial
		? { ops, nextCursor: null, progress }
		: { ops, nextCursor: null, progress, sweep: ["account", "contact"] }
}

/** Oldest first: a record created mid-sweep lands after the rows not read yet. */
const query = (cursor: ClerkCursor, extra: ReadonlyArray<readonly [string, string]> = []) => [
	["limit", String(PAGE_SIZE)] as const,
	["offset", String(startOf(cursor))] as const,
	["order_by", "+created_at"] as const,
	...extra,
]

const organizationsPage = (get: ClerkGet, cursor: ClerkCursor, onNoMatch: OnNoMatch, at: IsoTimestamp) =>
	Effect.map(
		get("/organizations", query(cursor, [["include_members_count", "true"]]), ClerkOrganizationsPage),
		(body): Listing => ({
			ops: body.data.map((org) => accountOp(org, onNoMatch, at)),
			rows: body.data,
			total: body.total_count,
		}),
	)

const membersPage = Effect.fn("Clerk.membersPage")(function* (
	get: ClerkGet,
	cursor: ClerkCursor,
	onNoMatch: OnNoMatch,
	at: IsoTimestamp,
): Effect.fn.Return<Listing, CustomerProviderError> {
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
			withAccount: false,
			observedAt: at,
		}),
	)
	return {
		ops: [...accounts, ...members],
		rows: body.data,
		total: body.total_count,
	}
})

const domainsPage = (get: ClerkGet, cursor: ClerkCursor, onNoMatch: OnNoMatch, at: IsoTimestamp) =>
	Effect.map(
		get("/organization_domains", query(cursor, [["verified", "true"]]), ClerkDomainsPage),
		(body): Listing => {
			const byOrganization = new Map<string, Array<string>>()
			for (const domain of body.data) {
				const names = byOrganization.get(domain.organization_id)
				if (names === undefined) byOrganization.set(domain.organization_id, [domain.name])
				else names.push(domain.name)
			}
			const ops = [...byOrganization].map(([organizationId, names]) =>
				domainsAccountOp(organizationId, names, onNoMatch, at),
			)
			return { ops, rows: body.data, total: body.total_count }
		},
	)

export const pullPage = Effect.fn("Clerk.pullPage")(function* (input: {
	readonly get: ClerkGet
	readonly cursor: string | null
	readonly config: ConnectionConfig
}) {
	const decoded = decodeCursor(input.cursor)
	// Restarting is safe (ingest is idempotent), but a sweep that keeps restarting never finishes.
	if (Option.isNone(decoded))
		yield* Effect.logWarning("Clerk sweep cursor unreadable; restarting the sweep")
	const cursor = Option.getOrElse(decoded, () => START)
	const onNoMatch = onNoMatchOf(input.config)
	// A listing proves its records live as of the request: the ops' `observedAt`.
	const at = new Date(yield* Clock.currentTimeMillis).toISOString()
	const listing =
		cursor.phase === "organizations"
			? yield* organizationsPage(input.get, cursor, onNoMatch, at)
			: cursor.phase === "members"
				? yield* membersPage(input.get, cursor, onNoMatch, at)
				: yield* domainsPage(input.get, cursor, onNoMatch, at)
	const shifted = shiftedPast(cursor, listing.rows)
	const tied = !exhaustedBy(cursor, listing) && tiedAtEnd(listing.rows)
	if (shifted || tied) {
		yield* Effect.logWarning("Clerk sweep may have skipped rows; it will remove nothing at its end", {
			phase: cursor.phase,
			offset: startOf(cursor),
			reason: shifted ? "shifted" : "created_at_ties",
		})
	}
	const page = pageOf(cursor, listing, cursor.partial === true || shifted || tied)
	yield* Effect.annotateCurrentSpan({
		"clerk.phase": cursor.phase,
		"clerk.offset": startOf(cursor),
		"clerk.received": listing.rows.length,
		"clerk.total_count": listing.total ?? -1,
		"clerk.shifted": shifted,
		"clerk.tied": tied,
		"clerk.sweep_complete": page.sweep !== undefined,
	})
	return page
})
