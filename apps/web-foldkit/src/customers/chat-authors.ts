/**
 * Who writes in channels linked to customers (`docs/customers/author-side.md`), client side: the
 * org's authors with their side (`customer_chat_authors`, the org source), each account's
 * participants (`customer_chat_participants`, the Customers source), and marking someone as our
 * team or the customer.
 */
import * as Customers from "@hazel/domain/customers"
import type { CustomerChatAuthor } from "@hazel/domain/models"
import { ChannelId, CustomerAccountId, CustomerContactId, type OrganizationId, UserId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { eq, inArray } from "@tanstack/db"
import { Clock, Effect, Schema, Stream } from "effect"
import {
	channelCustomerCollection,
	customerChatAuthorCollection,
	customerChatParticipantCollection,
} from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import { HazelRpc } from "../rpc"
import { msOf, withCustomersSource } from "./queries"

// ROWS

/** An author of the org's linked channels: their side, why, and a member's override. */
export const CustomerAuthorInfo = Schema.Struct({
	userId: UserId,
	side: Customers.AuthorSide,
	reason: Customers.AuthorSideReason,
	override: Schema.NullOr(Customers.AuthorSideOverride),
})
export type CustomerAuthorInfo = typeof CustomerAuthorInfo.Type

/** Someone who wrote in an account's linked channels. */
export const ChatParticipantRow = Schema.Struct({
	accountId: CustomerAccountId,
	userId: UserId,
	side: Customers.AuthorSide,
	reason: Customers.AuthorSideReason,
	contactId: Schema.NullOr(CustomerContactId),
	name: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	lastMessageAtMs: Schema.Finite,
	lastChannelId: ChannelId,
})
export type ChatParticipantRow = typeof ChatParticipantRow.Type

// QUERIES

/** Every author of the org's linked channels (the org source, members only). */
export const chatAuthorsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (authors: ReadonlyArray<CustomerAuthorInfo>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<CustomerChatAuthor.Type, Message>(
		(q) =>
			q
				.from({ author: customerChatAuthorCollection })
				.where(({ author }) => eq(author.organizationId, organizationId)),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					userId: row.userId,
					side: row.side,
					reason: row.reason,
					override: row.override,
				})),
			),
	)

/** Every account's participants (the Customers source). */
export const chatParticipantsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (participants: ReadonlyArray<ChatParticipantRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.ChatParticipant, Message>(
			(q) =>
				q
					.from({ participant: customerChatParticipantCollection })
					.where(({ participant }) => eq(participant.organizationId, organizationId)),
			(rows) =>
				toMessage(
					rows.map((row) => ({
						accountId: row.accountId,
						userId: row.userId,
						side: row.side,
						reason: row.reason,
						contactId: row.contactId,
						name: row.name,
						avatarUrl: row.avatarUrl,
						lastMessageAtMs: msOf(row.lastMessageAt),
						lastChannelId: row.lastChannelId,
					})),
				),
		),
	)

/**
 * The org's authors while any of `channelIds` (a channel, and a thread's parent) is linked to a
 * customer; null while none is.
 */
export const linkedChannelAuthorsStream = <Message>(
	organizationId: OrganizationId,
	channelIds: ReadonlyArray<ChannelId>,
	toMessage: (authors: ReadonlyArray<CustomerAuthorInfo> | null) => Message,
): Stream.Stream<Message> => {
	const isLinked = liveQueryStream<{ readonly channelId: ChannelId }, boolean>(
		(q) =>
			q
				.from({ customer: channelCustomerCollection })
				.where(({ customer }) => inArray(customer.channelId, [...channelIds]))
				.select(({ customer }) => ({ channelId: customer.channelId })),
		(rows) => rows.length > 0,
	).pipe(Stream.changes)
	return isLinked.pipe(
		Stream.switchMap((linked) =>
			linked ? chatAuthorsStream(organizationId, toMessage) : Stream.make(toMessage(null)),
		),
	)
}

// ACTIONS

interface SetSideProps {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	readonly side: Customers.AuthorSideOverride | null
}

const requestSetSide = (props: SetSideProps) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const result = yield* client("customers.chatAuthor.setSide", props)
		return { data: result, transactionId: result.transactionId }
	})

/** The author row's key in the collection (the server's `organizationId, userId`). */
const authorKeyOf = (props: SetSideProps) => `${props.organizationId}:${props.userId}` as const

const setSideOptimistically = optimisticAction({
	collections: [customerChatAuthorCollection],
	onMutate: (props: SetSideProps & { readonly by: UserId; readonly at: Date }) => {
		customerChatAuthorCollection.update(authorKeyOf(props), (row) => {
			row.override = props.side
			row.overrideBy = props.side === null ? null : props.by
			row.overrideAt = props.side === null ? null : props.at
			// A bot stays a bot; clearing waits for the server's automatic side.
			if (props.side !== null && row.side !== "bot") {
				row.side = props.side
				row.reason = "override"
			}
		})
		return { userId: props.userId }
	},
	mutate: ({ by: _by, at: _at, ...props }) => requestSetSide(props),
})

/**
 * Mark someone as our team or the customer in the org's linked channels, or clear the mark
 * (`side` null). Applied to their author row at once when it is held; else the row arrives synced.
 */
export const setChatAuthorSideAction = (props: SetSideProps & { readonly by: UserId }) =>
	Effect.gen(function* () {
		if (customerChatAuthorCollection.has(authorKeyOf(props))) {
			const at = new Date(yield* Clock.currentTimeMillis)
			return yield* setSideOptimistically({ ...props, at })
		}
		const { by: _by, ...request } = props
		return yield* requestSetSide(request)
	})
