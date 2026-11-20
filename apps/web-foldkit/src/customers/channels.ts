/**
 * Channels linked to customers (`docs/customers/channels.md`), client side: the live links (the
 * Customers source), the org's linkable channels with where each comes from (Hazel, Slack,
 * Discord or Connect), each channel's customer as chat sees it (`channel_customers`, the org
 * source), and the optimistic link / unlink actions.
 */
import type * as Customers from "@hazel/domain/customers"
import type { Channel } from "@hazel/domain/models"
import {
	ChannelId,
	CustomerAccountId,
	CustomerChannelLinkId,
	type OrganizationId,
	UserId,
} from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { and, eq, inArray, isNull } from "@tanstack/db"
import { Clock, Effect, Schema, Stream } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
	channelCollection,
	channelCustomerCollection,
	chatSyncChannelLinkCollection,
	chatSyncConnectionCollection,
	connectConversationChannelCollection,
	customerChannelLinkCollection,
} from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import { IconHashtag, IconLock } from "../icons"
import { discordLogo, slackLogo } from "../page/settings/chat-sync/brand-icons"
import { HazelRpc } from "../rpc"
import { withCustomersSource } from "./queries"

// ROWS

/** Where a channel's conversation happens: in Hazel, mirrored from Slack or Discord, or shared over Connect. */
export const ChannelOrigin = Schema.Literals(["hazel", "slack", "discord", "connect"])
export type ChannelOrigin = typeof ChannelOrigin.Type

export const ORIGIN_LABEL = {
	hazel: "Hazel",
	slack: "Slack",
	discord: "Discord",
	connect: "Hazel Connect",
} as const satisfies Record<ChannelOrigin, string>

/** A channel of the org the user sees that a customer can be linked to (not a thread or DM). */
export const ChannelOption = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	isPrivate: Schema.Boolean,
	origin: ChannelOrigin,
})
export type ChannelOption = typeof ChannelOption.Type

export const ChannelLinkRow = Schema.Struct({
	id: CustomerChannelLinkId,
	accountId: CustomerAccountId,
	channelId: ChannelId,
	/** Who linked it; null when it was linked automatically (a Connect channel of the account's contacts). */
	linkedBy: Schema.NullOr(UserId),
})
export type ChannelLinkRow = typeof ChannelLinkRow.Type

/** A channel's customer, as chat shows it. */
export const ChannelCustomerRow = Schema.Struct({
	channelId: ChannelId,
	accountId: CustomerAccountId,
	accountName: Schema.String,
})
export type ChannelCustomerRow = typeof ChannelCustomerRow.Type

// QUERIES

interface ProviderRow {
	readonly channelId: ChannelId
	readonly provider: string
}

/**
 * A channel shared over Connect is Connect's, even when chat sync mirrors it too (as the backend's
 * channel evidence counts it, so the mark matches a suggestion's reasons); else one mirrored from
 * Slack or Discord is that platform's.
 */
export const originOf = (
	channelId: ChannelId,
	synced: ReadonlyMap<ChannelId, ChannelOrigin>,
	connected: ReadonlySet<ChannelId>,
): ChannelOrigin => (connected.has(channelId) ? "connect" : (synced.get(channelId) ?? "hazel"))

/**
 * The org's linkable channels the user sees, by name, each with its origin. Combines the channels,
 * their active Slack / Discord links and their Connect mounts (all in the org source).
 */
export const channelOptionsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (channels: ReadonlyArray<ChannelOption>) => Message,
): Stream.Stream<Message> => {
	const channels = liveQueryStream<Channel.Type, ReadonlyArray<Channel.Type>>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) =>
					and(
						eq(channel.organizationId, organizationId),
						inArray(channel.type, ["public", "private"]),
						isNull(channel.deletedAt),
					),
				)
				.orderBy(({ channel }) => channel.name, "asc"),
		(rows) => rows,
	)
	const synced = liveQueryStream<ProviderRow, ReadonlyMap<ChannelId, ChannelOrigin>>(
		(q) =>
			q
				.from({ link: chatSyncChannelLinkCollection })
				.innerJoin({ connection: chatSyncConnectionCollection }, ({ link, connection }) =>
					eq(link.syncConnectionId, connection.id),
				)
				.where(({ link, connection }) =>
					and(
						eq(connection.organizationId, organizationId),
						inArray(connection.provider, ["discord", "slack"]),
						eq(link.isActive, true),
						isNull(link.deletedAt),
						isNull(connection.deletedAt),
					),
				)
				.select(({ link, connection }) => ({
					channelId: link.hazelChannelId,
					provider: connection.provider,
				})),
		(rows) =>
			new Map(
				rows.map((row) => [row.channelId, row.provider === "slack" ? "slack" : "discord"] as const),
			),
	)
	const connected = liveQueryStream<{ readonly channelId: ChannelId }, ReadonlySet<ChannelId>>(
		(q) =>
			q
				.from({ mount: connectConversationChannelCollection })
				.where(({ mount }) =>
					and(
						eq(mount.organizationId, organizationId),
						eq(mount.isActive, true),
						isNull(mount.deletedAt),
					),
				)
				.select(({ mount }) => ({ channelId: mount.channelId })),
		(rows) => new Set(rows.map((row) => row.channelId)),
	)
	return Stream.zipLatestAll(channels, synced, connected).pipe(
		Stream.map(([rows, syncedBy, connectedSet]) =>
			toMessage(
				rows.map((channel) => ({
					id: channel.id,
					name: channel.name,
					isPrivate: channel.type === "private",
					origin: originOf(channel.id, syncedBy, connectedSet),
				})),
			),
		),
	)
}

/** Every live link of the org (the Customers source). */
export const channelLinksStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (links: ReadonlyArray<ChannelLinkRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.ChannelLink, Message>(
			(q) =>
				q
					.from({ link: customerChannelLinkCollection })
					.where(({ link }) =>
						and(eq(link.organizationId, organizationId), isNull(link.deletedAt)),
					),
			(rows) =>
				toMessage(
					rows.map((row) => ({
						id: row.id,
						accountId: row.accountId,
						channelId: row.channelId,
						linkedBy: row.linkedBy,
					})),
				),
		),
	)

/** The channel's customer as chat sees it (null: not linked), from the org source. */
export const channelCustomerStream = <Message>(
	channelId: ChannelId,
	toMessage: (customer: ChannelCustomerRow | null) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ChannelCustomerRow, Message>(
		(q) =>
			q
				.from({ customer: channelCustomerCollection })
				.where(({ customer }) => eq(customer.channelId, channelId))
				.select(({ customer }) => ({
					channelId: customer.channelId,
					accountId: customer.accountId,
					accountName: customer.accountName,
				})),
		(rows) => toMessage(rows[0] ?? null),
	)

/** `options` matching `search` (case and accents ignored), best first, at most `limit`. */
export const searchOptions = <A extends { readonly name: string }>(
	options: ReadonlyArray<A>,
	search: string,
	limit = 8,
): ReadonlyArray<A> => {
	const fold = (text: string) =>
		text
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase()
	const query = fold(search.trim().replace(/^#/, ""))
	if (query === "") return options.slice(0, limit)
	const scored = options
		.map((option) => ({ option, at: fold(option.name).indexOf(query) }))
		.filter((entry) => entry.at !== -1)
	// A name that starts with the text first, then where it matches.
	scored.sort((a, b) => a.at - b.at)
	return scored.slice(0, limit).map((entry) => entry.option)
}

// ACTIONS

export interface LinkProps {
	readonly organizationId: OrganizationId
	readonly accountId: CustomerAccountId
	readonly channelId: ChannelId
	readonly userId: UserId
}

interface Stamp {
	readonly id: CustomerChannelLinkId
	readonly at: Date
}

/** Shows the link at once: the channel's link to another account moves here. */
const showLink = (props: LinkProps & Stamp) => {
	for (const row of customerChannelLinkCollection.toArray) {
		if (row.channelId === props.channelId && row.deletedAt === null) {
			customerChannelLinkCollection.update(row.id, (link) => {
				link.deletedAt = props.at
			})
		}
	}
	customerChannelLinkCollection.insert({
		id: props.id,
		organizationId: props.organizationId,
		accountId: props.accountId,
		channelId: props.channelId,
		linkedBy: props.userId,
		createdAt: props.at,
		updatedAt: props.at,
		deletedAt: null,
	} as Customers.ChannelLink)
	return { id: props.id }
}

/**
 * A link that shows at once and settles once the synced links hold the server's (whose row
 * replaces the optimistic one). `write` is the RPC that links: a plain link, or an accepted
 * suggestion.
 */
export const optimisticLinkAction = <Props extends LinkProps, E, R>(
	write: (
		props: Props & Stamp,
	) => Effect.Effect<{ readonly data: Customers.ChannelLink; readonly transactionId: string }, E, R>,
) => {
	const action = optimisticAction({
		collections: [customerChannelLinkCollection],
		onMutate: (props: Props & Stamp) => showLink(props),
		mutate: (props) => Effect.map(write(props), ({ data, transactionId }) => ({ data, transactionId })),
	})
	return (props: Props) =>
		Effect.gen(function* () {
			const id = CustomerChannelLinkId.make(crypto.randomUUID())
			const at = new Date(yield* Clock.currentTimeMillis)
			return yield* action({ ...props, id, at })
		})
}

/** Link the channel to the account (a link to another account moves). */
export const linkChannelAction = optimisticLinkAction((props: LinkProps & Stamp) =>
	HazelRpc.use((client) =>
		client("customers.channel.link", {
			organizationId: props.organizationId,
			id: props.id,
			accountId: props.accountId,
			channelId: props.channelId,
		}),
	),
)

const unlinkChannel = optimisticAction({
	collections: [customerChannelLinkCollection],
	onMutate: (props: {
		readonly organizationId: OrganizationId
		readonly channelId: ChannelId
		readonly at: Date
	}) => {
		for (const row of customerChannelLinkCollection.toArray) {
			if (row.channelId === props.channelId && row.deletedAt === null) {
				customerChannelLinkCollection.update(row.id, (link) => {
					link.deletedAt = props.at
				})
			}
		}
		return { channelId: props.channelId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.channel.unlink", {
				organizationId: props.organizationId,
				channelId: props.channelId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

/** Unlink the channel from its customer. */
export const unlinkChannelAction = (props: {
	readonly organizationId: OrganizationId
	readonly channelId: ChannelId
}) => Effect.flatMap(Clock.currentTimeMillis, (ms) => unlinkChannel({ ...props, at: new Date(ms) }))

// VIEW

/** The channel's mark: its platform's logo, or `#` / a lock for a Hazel or Connect channel. */
export const channelMark = <Message>(
	h: HtmlBuilder<Message>,
	channel: Pick<ChannelOption, "origin" | "isPrivate">,
	className = "size-3.5",
): Html => {
	switch (channel.origin) {
		case "slack":
			return slackLogo(h, `${className} shrink-0`)
		case "discord":
			return discordLogo(h, `${className} shrink-0`)
		default:
			return (channel.isPrivate ? IconLock : IconHashtag)(h, {
				className: `${className} shrink-0 text-muted-fg`,
			})
	}
}
