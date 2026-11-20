import * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { ChatAuthorRow, ChatParticipantRow } from "../../../customers/chat-authors"
import { formatRelative } from "../../../customers/format"
import { personAvatar } from "../../../customers/ui/identity"
import { IconDots } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import * as Menu from "../../../ui/menu"
import { menuLabel } from "../../../ui/menu-view"
import { Message } from "./message"
import { customerOfAccount, type Model } from "./model"
import { type Context, icon, menu } from "./parts"

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
 * The customer's people: its participants on the customer side, or marked as our team. The author
 * row (the org source) wins over the participant's copy, which follows it through the outbox.
 */
export const chatPeopleOf = (
	participants: ReadonlyArray<ChatParticipantRow>,
	authors: ReadonlyArray<ChatAuthorRow>,
	customerId: CustomerAccountId,
): ReadonlyArray<ChatPerson> => {
	const authorsById = new Map(authors.map((author) => [author.userId, author]))
	return participants
		.flatMap((participant): ReadonlyArray<ChatPerson> => {
			if (participant.accountId !== customerId) return []
			const author = authorsById.get(participant.userId)
			const side = author?.side ?? participant.side
			const override = author?.override ?? null
			if (side !== "customer" && override !== "team") return []
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
export const chatPeopleOfModel = (model: Model): ReadonlyArray<ChatPerson> =>
	chatPeopleOf(model.chatParticipants, model.chatAuthors, customerOfAccount(model)(model.accountId))

// MENU

export const ChatPersonKey = Schema.Literals(["mark_team", "mark_customer", "reset"])
export type ChatPersonKey = typeof ChatPersonKey.Type

const CHAT_PERSON_LABEL = {
	mark_team: "Mark as team",
	mark_customer: "Mark as customer",
	reset: "Reset to automatic",
} as const satisfies Record<ChatPersonKey, string>

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

// VIEW

const personRow = (h: HtmlBuilder<Message>, model: Model, context: Context, person: ChatPerson): Html => {
	const isTeam = person.side !== "customer"
	const label = `More for ${person.name}`
	return h.div(
		[h.Key(person.userId), h.Class("flex min-h-11 items-center gap-2.5 py-1")],
		[
			h.div(
				[
					h.Class(twMerge("flex min-w-0 flex-1 items-center gap-2.5", isTeam && "opacity-60")),
					h.Title(Customers.authorSideReasonLabel[person.reason]),
				],
				[
					personAvatar(h, person, { size: "md" }),
					h.div(
						[h.Class("flex min-w-0 flex-1 flex-col")],
						[
							h.span(
								[h.Class("flex min-w-0 items-center gap-1.5")],
								[
									h.span([h.Class("truncate font-medium text-fg text-sm")], [person.name]),
									...(isTeam
										? [badge(h, { intent: "secondary", size: "sm" }, ["Team"])]
										: []),
								],
							),
							h.span(
								[h.Class("truncate text-muted-fg text-xs")],
								[
									`Last message ${formatRelative(new Date(person.lastMessageAtMs), new Date(context.nowMs))}`,
								],
							),
						],
					),
				],
			),
			model.activeChatPersonId === person.userId
				? menu(h, model.chatPersonMenu, {
						entries: chatPersonEntries(person),
						trigger: (attributes, overlay) =>
							button(
								h,
								{
									intent: "plain",
									size: "sq-xs",
									attributes: [...attributes, h.AriaLabel(label)],
								},
								[IconDots(h, icon), overlay],
							),
						content: (key) => [
							menuLabel(
								h,
								model.chatPersonMenu.id,
								key,
								CHAT_PERSON_LABEL[
									ChatPersonKey.literals.find((literal) => literal === key) ?? "reset"
								],
							),
						],
						toMessage: (message) => Message.GotChatPersonMenuMessage({ message }),
					})
				: button(
						h,
						{
							intent: "plain",
							size: "sq-xs",
							onPress: Message.PressedChatPersonMenu({ userId: person.userId }),
							attributes: [h.AriaLabel(label)],
						},
						[IconDots(h, icon)],
					),
		],
	)
}

/** The section's rows, or the empty line. */
export const peopleInChat = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
): ReadonlyArray<Html> => {
	const people = chatPeopleOfModel(model)
	return people.length === 0
		? [
				h.p(
					[h.Class("text-muted-fg text-sm")],
					["No one from this customer has written in its linked channels yet."],
				),
			]
		: people.map((person) => personRow(h, model, context, person))
}
