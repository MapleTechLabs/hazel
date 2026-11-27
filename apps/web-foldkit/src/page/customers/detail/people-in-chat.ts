import * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { CustomerAuthorInfo, ChatParticipantRow } from "../../../customers/chat-authors"
import * as Menu from "../../../ui/menu"
import { customerOfAccount, type Model } from "./model"

/**
 * The sidebar's "People in chat" (`docs/customers/author-side.md`): who wrote for the customer in its
 * linked channels, newest first, and anyone a member marked as our team, so the mark can be undone.
 */

/** Someone shown in the section; `side` and `override` are the org's latest (its author row). */
export interface ChatPerson {
	readonly userId: UserId
	readonly name: string
	readonly avatarUrl: string | null
	readonly side: Customers.AuthorSide
	readonly reason: Customers.AuthorSideReason
	readonly override: Customers.AuthorSideOverride | null
	readonly contactId: CustomerContactId | null
	readonly lastMessageAtMs: number
}

/**
 * The customer's people: its participants on the customer side, or marked as our team, once each.
 * Rows filed under any account of the customer count (`customerOf`): a link moves to a new primary,
 * its participants stay. The author row (the org source) wins over the participant's copy, which
 * follows it through the outbox.
 */
export const chatPeopleOf = (
	participants: ReadonlyArray<ChatParticipantRow>,
	authors: ReadonlyArray<CustomerAuthorInfo>,
	customerId: CustomerAccountId,
	customerOf: (accountId: CustomerAccountId) => CustomerAccountId,
): ReadonlyArray<ChatPerson> => {
	const authorsById = new Map(authors.map((author) => [author.userId, author]))
	const newest = new Map<UserId, ChatParticipantRow>()
	for (const participant of participants) {
		if (customerOf(participant.accountId) !== customerId) continue
		const held = newest.get(participant.userId)
		if (held === undefined || participant.lastMessageAtMs > held.lastMessageAtMs)
			newest.set(participant.userId, participant)
	}
	return [...newest.values()]
		.flatMap((participant): ReadonlyArray<ChatPerson> => {
			const author = authorsById.get(participant.userId)
			const side = author?.side ?? participant.side
			const override = author?.override ?? null
			// Bots stay bots whatever the override.
			if (side === "bot" || (side !== "customer" && override !== "team")) return []
			return [
				{
					userId: participant.userId,
					name: participant.name,
					avatarUrl: participant.avatarUrl,
					side,
					reason: author?.reason ?? participant.reason,
					override,
					contactId: participant.contactId,
					lastMessageAtMs: participant.lastMessageAtMs,
				},
			]
		})
		.sort((left, right) => right.lastMessageAtMs - left.lastMessageAtMs)
}

/** This page's customer's people (linked channels are the customer's, on its primary). */
export const chatPeopleOfModel = (model: Model): ReadonlyArray<ChatPerson> => {
	const customerOf = customerOfAccount(model)
	return chatPeopleOf(model.chatParticipants, model.chatAuthors, customerOf(model.accountId), customerOf)
}

/** The customer has a linked channel (any of its accounts' links, as the Channels section counts). */
const hasLinkedChannel = (model: Model): boolean => {
	const customerOf = customerOfAccount(model)
	const customer = customerOf(model.accountId)
	return model.channelLinks.some((link) => customerOf(link.accountId) === customer)
}

/** Who the section lists: participants are history, shown only while a channel is still linked. */
export const shownChatPeople = (model: Model): ReadonlyArray<ChatPerson> =>
	hasLinkedChannel(model) ? chatPeopleOfModel(model) : []

// MENU

export const ChatPersonKey = Schema.Literals(["mark_team", "mark_customer", "reset"])
export type ChatPersonKey = typeof ChatPersonKey.Type

/** The override each key sets (`null` clears it). */
export const CHAT_PERSON_SIDE = {
	mark_team: "team",
	mark_customer: "customer",
	reset: null,
} as const satisfies Record<ChatPersonKey, Customers.AuthorSideOverride | null>

/** The other side, and Reset while a member's mark is set. */
export const chatPersonEntries = (person: ChatPerson): ReadonlyArray<Menu.Entry> => [
	Menu.item(person.side === "customer" ? "mark_team" : "mark_customer"),
	...(person.override === null ? [] : [Menu.separator, Menu.item("reset")]),
]
