/**
 * Channels linked to customer accounts (`docs/customers/channels.md`), on the `CustomersObject`
 * side: the live links (`customer_channel_links`) and their projection to the `OrgObject`
 * (`org.setChannelCustomers`, a full snapshot of channel → account id and name).
 *
 * The snapshot is sent when it changes: after a link or unlink, after a rename by hand, and at
 * the end of every compute (which catches names set by a source, and accounts a source deleted).
 * Only live links of live accounts are projected.
 *
 * A link belongs to the customer, not to one environment: it is stored on the group's primary
 * (`linkOwnerOf`), regrouping moves it (`./groups.ts`), and the snapshot names the primary.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type {
	ChannelId,
	CustomerAccountId,
	CustomerChannelLinkId,
	CustomerChannelSuggestionId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { type ChannelCustomerEntry, ChannelCustomerOrgEffects } from "../org/channel-customers"
import { inList } from "./sql"

/** The fingerprint of the last snapshot sent, and its version. */
const SENT_KEY = "channelCustomersSent"
const VERSION_KEY = "channelCustomersVersion"

/**
 * The account a link of `account`'s customer is stored on: its group's live primary, else itself
 * (standalone, a primary, or an environment whose primary is gone).
 */
export const linkOwnerOf = (account: Pick<schema.CustomerAccount, "id" | "primaryAccountId">) =>
	Effect.gen(function* () {
		const primaryId = account.primaryAccountId
		if (primaryId === null) return account.id
		const db = yield* Database.Database
		const primary = yield* db.first(
			SQLite.from(schema.customerAccountsTable)
				.select("id")
				.where(($) => [$.id.eq(primaryId), $.deletedAt.isNull()]),
		)
		return Option.match(primary, { onNone: () => account.id, onSome: (row) => row.id })
	})

/**
 * Every live link of a live account, under its customer (the group's live primary), ordered by
 * channel (a stable fingerprint). A link still stored on an environment shows under its primary too.
 */
export const channelCustomerSnapshot = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.run(
		SQLite.from(schema.customerChannelLinksTable, "l")
			.innerJoin(schema.customerAccountsTable, "a", (l, a) =>
				SQLite.and(a.id.eq(l.accountId), a.deletedAt.isNull()),
			)
			.select(($) => ({
				channelId: $.channelId,
				accountId: $.accountId,
				accountName: $.a.name,
				accountLogoUrl: $.a.logoUrl,
				primaryAccountId: $.a.primaryAccountId,
			}))
			.where(($) => [$.deletedAt.isNull()]),
	)
	const primaryIds = [
		...new Set(rows.flatMap((row) => (row.primaryAccountId === null ? [] : [row.primaryAccountId]))),
	]
	const primaries = new Map<CustomerAccountId, { readonly name: string; readonly logoUrl: string | null }>(
		primaryIds.length === 0
			? []
			: (yield* db.run(
					SQLite.from(schema.customerAccountsTable)
						.select("id", "name", "logoUrl")
						.where(($) => [inList($.id, primaryIds), $.deletedAt.isNull()]),
				)).map((row) => [row.id, { name: row.name, logoUrl: row.logoUrl ?? null }] as const),
	)
	// Named and pictured by the group's primary: its logo, else the environment's own.
	const links: Array<ChannelCustomerEntry> = rows.map((row) => {
		const primaryId = row.primaryAccountId
		const primary = primaryId === null ? undefined : primaries.get(primaryId)
		return primaryId === null || primary === undefined
			? {
					channelId: row.channelId,
					accountId: row.accountId,
					accountName: row.accountName,
					accountLogoUrl: row.accountLogoUrl ?? null,
				}
			: {
					channelId: row.channelId,
					accountId: primaryId,
					accountName: primary.name,
					accountLogoUrl: primary.logoUrl ?? row.accountLogoUrl ?? null,
				}
	})
	return links.sort((a, b) => (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0))
})

const fingerprint = (links: ReadonlyArray<ChannelCustomerEntry>) =>
	Effect.promise(() =>
		crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(
				JSON.stringify(
					links.map((link) => [
						link.channelId,
						link.accountId,
						link.accountName,
						link.accountLogoUrl,
					]),
				),
			),
		),
	).pipe(
		Effect.map((digest) =>
			[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
		),
	)

/**
 * Send the org the current snapshot unless it is the one last sent. Joins the caller's
 * transaction (the outbox row commits with the change that caused it).
 */
export const publishChannelCustomers = Effect.fn("CustomersObject.publishChannelCustomers")(function* (
	organizationId: OrganizationId,
) {
	const links = yield* channelCustomerSnapshot
	const print = yield* fingerprint(links)
	const sent = yield* readObjectMeta(SENT_KEY).pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.getOrUndefined(sent) === print) return
	const last = Option.getOrElse(
		Option.map(
			yield* readObjectMeta(VERSION_KEY).pipe(Effect.mapError(Database.toDatabaseError)),
			Number,
		),
		() => 0,
	)
	// Past the last one and at least the clock, so it increases across restarts.
	const version = Math.max(last + 1, yield* Clock.currentTimeMillis)
	yield* enqueueEffect(ChannelCustomerOrgEffects.setChannelCustomers, orgTarget(organizationId), {
		organizationId,
		links,
		version,
	})
	yield* writeObjectMeta(VERSION_KEY, String(version)).pipe(Effect.mapError(Database.toDatabaseError))
	yield* writeObjectMeta(SENT_KEY, print).pipe(Effect.mapError(Database.toDatabaseError))
})

/** After a compute: the object's own id is its organization's. In its own transaction. */
export const publishChannelCustomersAfterCompute = Effect.gen(function* () {
	const db = yield* Database.Database
	const self = yield* readObjectMeta("id").pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.isNone(self)) return
	const organizationId = self.value as OrganizationId
	yield* db.transaction(publishChannelCustomers(organizationId))
})

/**
 * Link `channelId` to `account`'s customer: the one path for a link by hand, an accepted suggestion
 * and an automatic one. Runs in the caller's transaction, after the caller checked the channel.
 *
 * Stored on the group's primary (`linkOwnerOf`). A channel has one customer, so a live link to
 * another account is moved (`channel.unlinked` on it); `channel.linked` on the new one. The pair's
 * suggestion is marked accepted and the channel's other open suggestions are dropped; the snapshot
 * is published. Linking again to the same customer changes nothing and answers the live link.
 *
 * `None` only with `onlyIfUnlinked` when the channel already has a live link (the automatic path:
 * a link made by hand while the refresh asked the org wins). `publish: false` leaves the snapshot
 * to the caller (one publish after several links).
 */
export const linkChannel = Effect.fn("CustomersObject.linkChannel")(function* (input: {
	readonly organizationId: OrganizationId
	readonly account: Pick<schema.CustomerAccount, "id" | "primaryAccountId">
	readonly channelId: ChannelId
	/** Null: linked automatically. */
	readonly actor: UserId | null
	readonly now: Date
	/** The new link's id (`undefined`: the column's default). */
	readonly id?: CustomerChannelLinkId | undefined
	/** What `channel.linked` says beyond the channel (an accepted or automatic suggestion). */
	readonly event?: { readonly title: string; readonly data: Record<string, unknown> }
	/** The suggestion being accepted, marked `accepted` whichever account it names. */
	readonly suggestionId?: CustomerChannelSuggestionId
	/** Do nothing when the channel already has a live link. */
	readonly onlyIfUnlinked?: boolean
	/** Default true; false: the caller publishes the snapshot. */
	readonly publish?: boolean
}) {
	const db = yield* Database.Database
	const { organizationId, channelId, actor, now } = input
	const owner = yield* linkOwnerOf(input.account)
	const event = (
		accountId: CustomerAccountId,
		type: string,
		title: string,
		data: Record<string, unknown>,
	) =>
		db.run(
			SQLite.insertInto(schema.customerEventsTable).values({
				accountId,
				provider: "hazel",
				type,
				title,
				data,
				occurredAt: now,
				actorUserId: actor,
			}),
		)
	const current = yield* db.first(
		SQLite.from(schema.customerChannelLinksTable)
			.select()
			.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()])
			.limit(1),
	)
	if (input.onlyIfUnlinked === true && Option.isSome(current))
		return Option.none<schema.CustomerChannelLink>()
	let link: schema.CustomerChannelLink
	if (Option.isSome(current) && current.value.accountId === owner) {
		link = current.value
	} else {
		if (Option.isSome(current)) {
			yield* db.run(
				SQLite.update(schema.customerChannelLinksTable)
					.set({ deletedAt: now, updatedAt: now })
					.where(($) => [$.id.eq(current.value.id)]),
			)
			yield* event(current.value.accountId, "channel.unlinked", "Channel unlinked", {
				channelId,
				movedTo: owner,
			})
		}
		const [inserted] = yield* db.run(
			SQLite.insertInto(schema.customerChannelLinksTable)
				.values({ id: input.id, organizationId, accountId: owner, channelId, linkedBy: actor })
				.returning(),
		)
		if (inserted === undefined) return yield* Effect.die("customer_channel_links insert returned no row")
		link = inserted
		yield* event(owner, "channel.linked", input.event?.title ?? "Channel linked", {
			channelId,
			...input.event?.data,
		})
	}
	yield* settleSuggestions({ channelId, accountId: owner, suggestionId: input.suggestionId, actor, now })
	if (input.publish !== false) yield* publishChannelCustomers(organizationId)
	return Option.some(link)
})

/** `linkChannel` for the paths that always link (by hand, an accepted suggestion). */
export const linkChannelNow = (input: Omit<Parameters<typeof linkChannel>[0], "onlyIfUnlinked">) =>
	linkChannel(input).pipe(
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.die("linkChannel skipped a link it was not allowed to skip"),
				onSome: Effect.succeed,
			}),
		),
	)

/**
 * A channel got its customer: the pair's suggestion (or the accepted one) becomes `accepted`, and
 * the channel's other open suggestions go. Dismissed ones stay (a dismissal is forever).
 */
const settleSuggestions = (input: {
	readonly channelId: ChannelId
	readonly accountId: CustomerAccountId
	readonly suggestionId: CustomerChannelSuggestionId | undefined
	readonly actor: UserId | null
	readonly now: Date
}) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const { channelId, accountId, suggestionId, actor, now } = input
		yield* db.run(
			SQLite.update(schema.customerChannelSuggestionsTable)
				.set({ status: "accepted", decidedBy: actor, decidedAt: now, updatedAt: now })
				.where(($) => [
					$.channelId.eq(channelId),
					$.status.eq("open"),
					suggestionId === undefined
						? $.accountId.eq(accountId)
						: SQLite.or($.accountId.eq(accountId), $.id.eq(suggestionId)),
				]),
		)
		yield* db.run(
			SQLite.deleteFrom(schema.customerChannelSuggestionsTable).where(($) => [
				$.channelId.eq(channelId),
				$.status.eq("open"),
			]),
		)
	})
