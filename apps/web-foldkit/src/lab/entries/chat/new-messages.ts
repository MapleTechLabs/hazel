import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { avatarButton, dateDividerView, messageRowView, type RowContext } from "../../../chat/message/row"
import { toDisplayRows, toDeriveContext } from "../../../page/chat/derive"
import { emptyLookups, type UserInfo } from "../../../page/chat/lookups"
import { type ChatMessage, ChatMessage as ChatMessageSchema, DisplayRow } from "../../../page/chat/rows"
import { defineLab } from "../../define"
import { labPage } from "../../frame"

/**
 * New messages rising into place: the channel's real row derivation (`toDisplayRows`) and row view.
 * "New message" arrives live and animates; "Catch-up burst" is a reconnect's batch and does not.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))

const PEOPLE: ReadonlyArray<UserInfo> = [
	{ firstName: "Ada", lastName: "Lovelace" },
	{ firstName: "Grace", lastName: "Hopper" },
	{ firstName: "Linus", lastName: "Torvalds" },
].map(({ firstName, lastName }, index) => ({
	id: Schema.decodeSync(UserId)(uuid(100 + index)),
	firstName,
	lastName,
	email: `${firstName.toLowerCase()}@hazel.sh`,
	avatarUrl: null,
	userType: "user",
	timezone: null,
}))

const LINES = [
	"Deploy is green on staging 🎉",
	"Nice, I'll kick off the smoke tests",
	"The new onboarding copy reads much better",
	"Can someone review #482 before lunch?",
	"On it",
	"Looks good to me, merging",
	"Release notes are in the doc",
	"Thanks all, shipping at 3pm",
]

const BASE = Date.UTC(2026, 10, 16, 9, 0)

/** Two messages per author in turn, so rows group as they do in a channel. */
const authorAt = (n: number): UserId =>
	Schema.decodeSync(UserId)(uuid(100 + (Math.floor(n / 2) % PEOPLE.length)))

const messageAt = (n: number): ChatMessage => ({
	id: Schema.decodeSync(MessageId)(uuid(1000 + n)),
	channelId,
	authorId: authorAt(n),
	content: LINES[n % LINES.length] ?? "",
	embeds: null,
	hasEmbeds: false,
	replyToMessageId: null,
	threadChannelId: null,
	createdAtMs: BASE + n * 30_000,
	updatedAtMs: null,
	isPinned: false,
	author: null,
})

const context = toDeriveContext({ ...emptyLookups, users: PEOPLE }, undefined)

const Model = Schema.Struct({
	/** Newest first, as the messages query returns them. */
	messages: Schema.Array(ChatMessageSchema),
	rows: Schema.Array(DisplayRow),
	next: Schema.Number,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	ClickedNewMessage: {},
	ClickedBurst: {},
	ClickedReset: {},
})
type Message = typeof Message.Type

/** Adds `count` messages at once, as one change from the sync. */
const arrive = (model: Model, count: number): Model => {
	const added = Array.from({ length: count }, (_, index) => messageAt(model.next + index)).reverse()
	const messages = [...added, ...model.messages]
	return { messages, rows: toDisplayRows(messages, [], context, model.rows), next: model.next + count }
}

const initial = (): Model => {
	const messages = Array.from({ length: 4 }, (_, index) => messageAt(index)).reverse()
	return { messages, rows: toDisplayRows(messages, [], context, []), next: 4 }
}

const update = (model: Model, message: Message): { model: Model } =>
	Message.match(message, {
		ClickedNewMessage: () => ({ model: arrive(model, 1) }),
		ClickedBurst: () => ({ model: arrive(model, 4) }),
		ClickedReset: () => ({ model: initial() }),
	})

const never = () => undefined as never

const rowContext = (h: HtmlBuilder<Message>): RowContext<Message> => ({
	tooltip: { active: null, hoveredKey: null, toMessage: never, userName: () => null, currentUserId: null },
	toOpenImage: never,
	toOpenEmbedImage: never,
	toOpenThread: never,
	reply: () => ({ toAuthor: (toTrigger) => toTrigger([]), onJump: never() }),
	toReact: never,
	contextMenu: (_row, render) => render([], h.empty),
	avatar: (row) => avatarButton(h, row, []),
	mention: () => (_mention, toTrigger) => toTrigger([]),
	toHtmlRenderMessage: never,
	toPressEmbedAction: never,
})

const button = (h: HtmlBuilder<Message>, label: string, message: Message, primary = false): Html =>
	h.button(
		[
			h.OnClick(message),
			h.Class(
				primary
					? "rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-fg text-sm hover:bg-primary/90"
					: "rounded-lg border border-border px-3 py-1.5 font-medium text-sm hover:bg-secondary",
			),
		],
		[label],
	)

export const lab = defineLab("New messages", {
	Model,
	init: () => ({ model: initial() }),
	update,
	view: (model, h) => {
		const context = rowContext(h)
		return labPage(
			h,
			{
				title: "New messages",
				description: "A live message rises into place; a first load or a catch-up burst does not.",
			},
			[
				h.div(
					[h.Class("mx-auto flex w-full max-w-2xl flex-col gap-4")],
					[
						h.div(
							[h.Class("flex gap-2")],
							[
								button(h, "New message", Message.ClickedNewMessage(), true),
								button(h, "Catch-up burst (4)", Message.ClickedBurst()),
								button(h, "Reset", Message.ClickedReset()),
							],
						),
						h.div(
							[h.Class("flex flex-col rounded-xl border border-border bg-bg p-3")],
							model.rows.map((row) =>
								h.keyed("div")(
									row.key,
									[],
									[
										row._tag === "DateHeader"
											? dateDividerView(h, row.label, false)
											: messageRowView(h, row, context),
									],
								),
							),
						),
					],
				),
			],
		)
	},
})
