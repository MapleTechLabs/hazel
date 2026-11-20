/**
 * Suggested channel links (`docs/customers/channels.md`), on the `CustomersObject` side: the
 * evidence of each channel comes from its `OrgObject` (`org.channelEvidence`), the scorer is pure
 * (`@hazel/domain/customers`), and the result is `customer_channel_suggestions`.
 *
 * Suggestions are the customer's (a group's primary, like links): every account is scored under
 * its link owner, with its group's domains and contacts. `open` rows are rewritten by each
 * refresh; `dismissed` and `accepted` rows are decisions and stay. Only a Connect channel whose
 * guests are clearly one account's contacts is linked without a click (`autoLink`), and never a
 * channel with any link history or decided suggestion.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	buildSuggestionIndex,
	type ChannelEvidence,
	type ChannelSuggestion,
	MAX_EVIDENCE_MEMBERS,
	type ScoredSuggestion,
	scoreChannel,
	STRONG_SUGGESTION_SCORE,
	type SuggestionAccount,
	type SuggestionReason,
	workspaceKey,
} from "@hazel/domain/customers"
import type {
	ChannelId,
	ConnectConversationId,
	CustomerAccountId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Cause, Clock, Effect, Option, PartitionedSemaphore } from "effect"
import { callObject } from "../calls"
import { orgTarget } from "../kinds"
import { readObjectMeta } from "../meta"
import { ChannelEvidenceCall, ConnectGuestEvidenceCall, VisibleChannelsCall } from "../org/channel-evidence"
import { linkChannel, publishChannelCustomers } from "./channels"
import { inList } from "./sql"

// ---------------------------------------------------------------------------
// Accounts under their customer
// ---------------------------------------------------------------------------

interface Customers {
	/** Live account → its link owner (the group's live primary, else itself). */
	readonly ownerOf: ReadonlyMap<CustomerAccountId, CustomerAccountId>
	/** Each owner with its group's domains. */
	readonly accounts: ReadonlyArray<SuggestionAccount>
}

const loadCustomers = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "name", "domains", "primaryAccountId")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const live = new Map(rows.map((row) => [row.id, row] as const))
	const ownerOf = new Map<CustomerAccountId, CustomerAccountId>()
	const domains = new Map<CustomerAccountId, Set<string>>()
	for (const row of rows) {
		const owner =
			row.primaryAccountId !== null && live.has(row.primaryAccountId) ? row.primaryAccountId : row.id
		ownerOf.set(row.id, owner)
		const set = domains.get(owner) ?? new Set<string>()
		for (const domain of row.domains) set.add(domain)
		domains.set(owner, set)
	}
	const accounts = [...domains].map(([id, set]) => ({
		id,
		name: live.get(id)?.name ?? "",
		domains: [...set],
	}))
	return { ownerOf, accounts } satisfies Customers
})

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

const autoLinkTitle = "Channel linked automatically"

/**
 * Reasons as a customer event may carry them: kinds and counts, never a name. Customer events
 * reach every member while a channel's (or a workspace's) name may be private, and a `name`
 * reason's `value` is that name; contact samples are left out too.
 */
export const eventReasons = (reasons: ReadonlyArray<SuggestionReason>) =>
	reasons.map((reason) => {
		switch (reason.kind) {
			case "contacts":
				return { kind: reason.kind, matched: reason.matched, total: reason.total }
			case "domain":
				return {
					kind: reason.kind,
					domain: reason.domain,
					matched: reason.matched,
					total: reason.total,
				}
			case "workspace":
				return { kind: reason.kind, provider: reason.provider, linkedChannels: reason.linkedChannels }
			case "name":
				return { kind: reason.kind, where: reason.where }
		}
	})

/** Workspaces whose linked channels can lend a scoped channel the `workspace` reason. */
const siblingKeys = (evidence: ReadonlyArray<ChannelEvidence>) => [
	...new Set(
		evidence.flatMap((entry) =>
			entry.workspaces.flatMap((workspace) =>
				workspace.provider === "slack" && !workspace.external
					? []
					: [workspaceKey(workspace.provider, workspace.id)],
			),
		),
	),
]

/**
 * Score the org's channels (all, or `channelIds`) again and store the result. The org is asked
 * first, outside the transaction: for a scope, its channels, then only the linked channels that
 * share a workspace with them.
 */
/**
 * One refresh at a time per organization: each fetches evidence then applies it, so two that
 * overlapped could apply out of order (an older one restoring rows a newer one removed). Keyed by
 * organization because Durable Objects of one class may share an isolate.
 */
const refreshPermits = PartitionedSemaphore.makeUnsafe<OrganizationId>({ permits: 1 })

export const refreshSuggestions = (organizationId: OrganizationId, channelIds?: ReadonlyArray<ChannelId>) =>
	refreshPermits.withPermits(organizationId, 1)(refreshSuggestionsNow(organizationId, channelIds))

const refreshSuggestionsNow = Effect.fn("CustomersObject.refreshSuggestions")(function* (
	organizationId: OrganizationId,
	channelIds?: ReadonlyArray<ChannelId>,
) {
	const db = yield* Database.Database
	const scope = channelIds === undefined ? undefined : [...new Set(channelIds)]
	yield* Effect.annotateCurrentSpan({
		"suggestions.scope": scope === undefined ? "all" : String(scope.length),
	})
	if (scope !== undefined && scope.length === 0) return { channels: 0, open: 0, autoLinked: 0 }
	// No accounts: nothing to suggest, and no reason to wake the org.
	const anyAccount = yield* db.first(
		SQLite.from(schema.customerAccountsTable)
			.select("id")
			.where(($) => [$.deletedAt.isNull()])
			.limit(1),
	)
	// When the evidence was asked for: a refresh that applied since is newer than this one.
	const fetchedAt = new Date(yield* Clock.currentTimeMillis)
	if (Option.isNone(anyAccount)) return yield* applySuggestions(organizationId, [], scope, fetchedAt)
	const target = orgTarget(organizationId)
	if (scope === undefined) {
		const evidence = yield* callObject(ChannelEvidenceCall, target, { organizationId })
		return yield* applySuggestions(
			organizationId,
			yield* withHostEvidence(organizationId, evidence),
			scope,
			fetchedAt,
		)
	}
	const scoped = yield* withHostEvidence(
		organizationId,
		yield* callObject(ChannelEvidenceCall, target, { organizationId, channelIds: scope }),
	)
	const keys = siblingKeys(scoped)
	const linkedIds =
		keys.length === 0
			? []
			: (yield* db.run(
					SQLite.from(schema.customerChannelLinksTable)
						.select("channelId")
						.where(($) => [$.deletedAt.isNull()]),
				))
					.map((row) => row.channelId)
					.filter((channelId) => !scope.includes(channelId))
	const siblings =
		linkedIds.length === 0
			? []
			: yield* callObject(ChannelEvidenceCall, target, {
					organizationId,
					channelIds: linkedIds,
					workspaceKeys: keys,
				})
	return yield* applySuggestions(organizationId, [...scoped, ...siblings], scope, fetchedAt)
})

/**
 * Channels this org mounted from another org's Connect share hold none of its people: their
 * host answers (`org.connectGuestEvidence`), one call per host for all its conversations, and its
 * participants join the channel's external members. Outside any transaction. A host that cannot
 * be reached is logged and its channels keep what this org saw (no Connect guests: no auto-link).
 */
const withHostEvidence = Effect.fn("CustomersObject.hostEvidence")(function* (
	organizationId: OrganizationId,
	evidence: ReadonlyArray<ChannelEvidence>,
) {
	const byHost = new Map<OrganizationId, Array<ConnectConversationId>>()
	for (const entry of evidence) {
		if (entry.connect === undefined) continue
		const list = byHost.get(entry.connect.hostOrganizationId) ?? []
		list.push(entry.connect.conversationId)
		byHost.set(entry.connect.hostOrganizationId, list)
	}
	if (byHost.size === 0) return evidence
	const answers = yield* Effect.forEach(
		[...byHost],
		([hostOrganizationId, conversationIds]) =>
			callObject(ConnectGuestEvidenceCall, orgTarget(hostOrganizationId), {
				organizationId: hostOrganizationId,
				guestOrganizationId: organizationId,
				conversationIds,
			}).pipe(
				// Unreachable or failing (a defect on the host too): that host's channels go without its
				// people (so none of them links automatically) and the other hosts' still count.
				Effect.catchCause((cause) =>
					// Any interruption in the cause (alone or with a failure) stops the refresh as it was.
					Cause.hasInterrupts(cause)
						? Effect.failCause(cause)
						: Effect.logWarning("Connect host evidence unavailable", {
								hostOrganizationId,
								cause: Cause.pretty(cause),
							}).pipe(Effect.as([])),
				),
			),
		{ concurrency: 4 },
	)
	const hostPeople = new Map(answers.flat().map((answer) => [answer.conversationId, answer] as const))
	yield* Effect.annotateCurrentSpan({ "suggestions.connect_hosts": byHost.size })
	return evidence.map((entry): ChannelEvidence => {
		const people = entry.connect === undefined ? undefined : hostPeople.get(entry.connect.conversationId)
		if (people === undefined) return entry
		return {
			...entry,
			externalMembers: [...people.members, ...entry.externalMembers].slice(0, MAX_EVIDENCE_MEMBERS),
			externalMemberCount:
				people.memberCount + (entry.externalMemberCount ?? entry.externalMembers.length),
		}
	})
})

/**
 * The transaction half of a refresh, over evidence asked for before it. Everything the store
 * decides is read here, inside the transaction: a link, accept or dismiss that ran while the org
 * was asked is seen, so no open row is written for a channel linked meanwhile and no channel with
 * a link or a decision is linked automatically.
 *
 * Open suggestions are upserted (only while still open), ones no longer produced deleted, decided
 * ones left alone, and the snapshot published once after the automatic links.
 */
export const applySuggestions = Effect.fn("CustomersObject.applySuggestions")(function* (
	organizationId: OrganizationId,
	evidence: ReadonlyArray<ChannelEvidence>,
	scope: ReadonlyArray<ChannelId> | undefined,
	/** When the evidence was asked for; a channel a later refresh already wrote is left to it. */
	fetchedAt?: Date,
) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	return yield* db.transaction(
		Effect.gen(function* () {
			const customers = yield* loadCustomers
			const ownerOf = (accountId: CustomerAccountId) => customers.ownerOf.get(accountId)
			const links = yield* db.run(
				SQLite.from(schema.customerChannelLinksTable)
					.select("channelId", "accountId", "deletedAt")
					.where(($) => [
						scope === undefined
							? undefined
							: SQLite.or($.deletedAt.isNull(), inList($.channelId, scope)),
					]),
			)
			// Live: a link of a live account, as the snapshot projects them. Any row (a deleted
			// account's too) is history that keeps a channel from linking automatically.
			const liveLinks = links.filter(
				(link) => link.deletedAt === null && customers.ownerOf.has(link.accountId),
			)
			const linked = new Set(liveLinks.map((link) => link.channelId))
			const everLinked = new Set(links.map((link) => link.channelId))

			const existing = yield* db.run(
				SQLite.from(schema.customerChannelSuggestionsTable)
					.select("id", "channelId", "accountId", "status", "computedAt")
					.where(($) => [scope === undefined ? undefined : inList($.channelId, scope)]),
			)
			// Channels a refresh that asked the org after this one already wrote: its scores stand.
			const newer = new Set(
				fetchedAt === undefined
					? []
					: existing
							.filter((row) => row.computedAt.getTime() > fetchedAt.getTime())
							.map((row) => row.channelId),
			)

			const evidenceOf = new Map(evidence.map((entry) => [entry.channelId, entry] as const))
			const targets = (scope ?? evidence.map((entry) => entry.channelId)).flatMap((channelId) => {
				const entry = evidenceOf.get(channelId)
				return entry === undefined || linked.has(channelId) || newer.has(channelId) ? [] : [entry]
			})

			// Contacts, only those an external member could be.
			const emails = [
				...new Set(
					targets.flatMap((entry) =>
						entry.externalMembers.flatMap((member) =>
							member.email === null ? [] : [member.email.trim().toLowerCase()],
						),
					),
				),
			]
			const contacts =
				emails.length === 0
					? []
					: yield* db.run(
							SQLite.from(schema.customerContactsTable)
								.select("accountId", "email")
								.where(($) => [
									$.deletedAt.isNull(),
									SQLite.sql
										.cond`lower(trim(${$.email}, char(9, 10, 13, 32))) IN (SELECT value FROM json_each(${JSON.stringify(emails)}))`,
								]),
						)
			const index = buildSuggestionIndex({
				accounts: customers.accounts,
				contacts: contacts.flatMap((contact) => {
					const owner = ownerOf(contact.accountId)
					return owner === undefined ? [] : [{ accountId: owner, email: contact.email }]
				}),
				links: liveLinks.flatMap((link) => {
					const owner = ownerOf(link.accountId)
					const entry = evidenceOf.get(link.channelId)
					return owner === undefined || entry === undefined
						? []
						: [{ accountId: owner, workspaces: entry.workspaces }]
				}),
			})

			// A decision for any account of a group is one for its customer (regrouping keeps it).
			const decidedOf = new Map<ChannelId, Set<CustomerAccountId>>()
			const open: Array<(typeof existing)[number]> = []
			for (const row of existing) {
				if (row.status === "open") {
					open.push(row)
					continue
				}
				const set = decidedOf.get(row.channelId) ?? new Set<CustomerAccountId>()
				set.add(ownerOf(row.accountId) ?? row.accountId)
				decidedOf.set(row.channelId, set)
			}

			const scored = targets.flatMap((entry) =>
				scoreChannel(entry, index, decidedOf.get(entry.channelId) ?? new Set()),
			)
			const produced = new Set(scored.map((s) => `${s.channelId}:${s.accountId}`))
			const stale = open.filter(
				(row) => !newer.has(row.channelId) && !produced.has(`${row.channelId}:${row.accountId}`),
			)
			const autoLinks = scored.filter(
				(suggestion) =>
					suggestion.autoLink &&
					!everLinked.has(suggestion.channelId) &&
					!decidedOf.has(suggestion.channelId),
			)

			for (const suggestion of scored) {
				const values = {
					score: suggestion.score,
					reasons: suggestion.reasons,
					// When the evidence was asked for, not written: a refresh that asked later wins
					// even if it commits first (the superseded check above compares the same clock).
					computedAt: fetchedAt ?? now,
					updatedAt: now,
				}
				// Another refresh may have written the pair: update it while it is still open.
				yield* db.run(
					SQLite.insertInto(schema.customerChannelSuggestionsTable)
						.values({
							organizationId,
							channelId: suggestion.channelId,
							accountId: suggestion.accountId,
							...values,
						})
						.onConflictDoUpdate({
							target: ["channelId", "accountId"],
							set: values,
							where: (row) => row.status.eq("open"),
						}),
				)
			}
			if (stale.length > 0) {
				yield* db.run(
					SQLite.deleteFrom(schema.customerChannelSuggestionsTable).where(($) => [
						$.status.eq("open"),
						inList(
							$.id,
							stale.map((row) => row.id),
						),
					]),
				)
			}
			let autoLinked = 0
			for (const suggestion of autoLinks) {
				if (yield* autoLink(organizationId, suggestion, now)) autoLinked += 1
			}
			if (autoLinked > 0) yield* publishChannelCustomers(organizationId)

			const openCount = scored.length - autoLinked
			yield* Effect.annotateCurrentSpan({
				"suggestions.channels": targets.length,
				"suggestions.open": openCount,
				"suggestions.removed": stale.length,
				"suggestions.auto_linked": autoLinked,
			})
			return { channels: targets.length, open: openCount, autoLinked }
		}),
	)
})

/**
 * A clear Connect match: linked by nobody, its suggestion accepted, why on the event (name-free).
 * Inside the refresh's transaction; nothing when the channel got a link meanwhile.
 */
const autoLink = (organizationId: OrganizationId, suggestion: ScoredSuggestion, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const account = yield* db.first(
			SQLite.from(schema.customerAccountsTable)
				.select("id", "primaryAccountId")
				.where(($) => [$.id.eq(suggestion.accountId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isNone(account)) return false
		const row = yield* db.first(
			SQLite.from(schema.customerChannelSuggestionsTable)
				.select("id")
				.where(($) => [$.channelId.eq(suggestion.channelId), $.accountId.eq(suggestion.accountId)])
				.limit(1),
		)
		const link = yield* linkChannel({
			organizationId,
			account: account.value,
			channelId: suggestion.channelId,
			actor: null,
			now,
			suggestionId: Option.getOrUndefined(Option.map(row, (r) => r.id)),
			onlyIfUnlinked: true,
			publish: false,
			event: {
				title: autoLinkTitle,
				data: {
					automatic: true,
					score: suggestion.score,
					reasons: eventReasons(suggestion.reasons),
				},
			},
		})
		return Option.isSome(link)
	})

/**
 * A refresh's plain failure is logged and left for the next compute. Any interruption (alone or
 * with a failure) stops the compute: the rest of the cause is logged, then the fiber interrupts.
 */
export const logRefreshFailure = <A, E, R>(refresh: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
	refresh.pipe(
		Effect.asVoid,
		Effect.catchCause((cause) =>
			Cause.hasInterruptsOnly(cause)
				? Effect.interrupt
				: Effect.logError("Customers suggestion refresh failed", { cause: Cause.pretty(cause) }).pipe(
						Effect.andThen(Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.void),
					),
		),
	)

/**
 * At the end of every compute: all channels. Its own failure is logged and never fails the
 * compute (the org may be unreachable for a moment; the next compute retries).
 */
export const refreshSuggestionsAfterCompute = Effect.gen(function* () {
	const self = yield* readObjectMeta("id").pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.isNone(self)) return
	yield* refreshSuggestions(self.value as OrganizationId)
}).pipe((refresh) => logRefreshFailure(refresh))

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Open suggestions, best first, for the channels `userId` sees: all, one customer's (any account
 * of its group), or one channel's. Named by the customer (the group's live primary).
 */
export const openSuggestions = Effect.fn("CustomersObject.openSuggestions")(function* (input: {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	readonly accountId?: CustomerAccountId | undefined
	readonly channelId?: ChannelId | undefined
}) {
	const db = yield* Database.Database
	const customers = yield* loadCustomers
	const owner = input.accountId === undefined ? undefined : customers.ownerOf.get(input.accountId)
	if (input.accountId !== undefined && owner === undefined) return []
	const rows = yield* db.run(
		SQLite.from(schema.customerChannelSuggestionsTable)
			.select()
			.where(($) => [
				$.status.eq("open"),
				input.channelId === undefined ? undefined : $.channelId.eq(input.channelId),
			])
			.orderBy(($) => [
				[$.score, "desc"],
				[$.computedAt, "desc"],
				[$.id, "asc"],
			]),
	)
	const decided = yield* decidedPairs(customers, input.channelId)
	const names = new Map(customers.accounts.map((account) => [account.id, account.name] as const))
	// Rows come best first: after a regrouping two rows can name one customer for a channel, and the
	// better one is kept.
	const seen = new Set<string>()
	const named = rows.flatMap((row) => {
		const customer = customers.ownerOf.get(row.accountId)
		const name = customer === undefined ? undefined : names.get(customer)
		if (customer === undefined || name === undefined || (owner !== undefined && customer !== owner))
			return []
		const key = `${row.channelId}:${customer}`
		// Its customer already decided this channel (through another account of the group).
		if (seen.has(key) || decided.has(key)) return []
		seen.add(key)
		return [{ row, customer, name }]
	})
	if (named.length === 0) return []
	const visible = new Set(
		yield* callObject(VisibleChannelsCall, orgTarget(input.organizationId), {
			organizationId: input.organizationId,
			userId: input.userId,
			channelIds: [...new Set(named.map(({ row }) => row.channelId))],
		}),
	)
	return named
		.filter(({ row }) => visible.has(row.channelId))
		.map(({ row, customer, name }): ChannelSuggestion => ({
			id: row.id,
			channelId: row.channelId,
			accountId: customer,
			accountName: name,
			score: row.score,
			strength: row.score >= STRONG_SUGGESTION_SCORE ? "strong" : "possible",
			reasons: row.reasons,
			computedAt: row.computedAt,
		}))
})

/**
 * `channel:customer` for every decided suggestion (dismissed or accepted), under the account's
 * customer as `applySuggestions` counts them: a decision for any account of a group is the group's.
 */
const decidedPairs = (customers: Customers, channelId?: ChannelId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const rows = yield* db.run(
			SQLite.from(schema.customerChannelSuggestionsTable)
				.select("channelId", "accountId")
				.where(($) => [
					$.status.neq("open"),
					channelId === undefined ? undefined : $.channelId.eq(channelId),
				]),
		)
		return new Set(
			rows.map((row) => `${row.channelId}:${customers.ownerOf.get(row.accountId) ?? row.accountId}`),
		)
	})

/** Whether an open suggestion's customer already has a decision for its channel. */
export const decidedForCustomer = (row: Pick<schema.CustomerChannelSuggestion, "channelId" | "accountId">) =>
	Effect.gen(function* () {
		const customers = yield* loadCustomers
		const decided = yield* decidedPairs(customers, row.channelId)
		return decided.has(`${row.channelId}:${customers.ownerOf.get(row.accountId) ?? row.accountId}`)
	})

/** An open suggestion by id. */
export const openSuggestion = (suggestionId: schema.CustomerChannelSuggestion["id"]) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.customerChannelSuggestionsTable)
				.select()
				.where(($) => [$.id.eq(suggestionId), $.status.eq("open")])
				.limit(1),
		),
	)
