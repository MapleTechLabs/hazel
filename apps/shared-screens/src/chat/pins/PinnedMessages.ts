// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel header's pinned messages (today's `page/chat/pinned.ts`, `PinnedMessagesModal`): a pin
 * button that opens a popover of the channel's pins, newest pin first. A pin jumps to its message
 * (the channel page's) and its unpin button removes it.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { ChannelId, MessageId, PinnedMessageId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { ShowToast } from "../../app/requests"
import { withData } from "../../app/live"
import { formatTime, initialsOf } from "../format"

export const Pin = Schema.Struct({
	pinnedId: PinnedMessageId,
	messageId: MessageId,
	authorId: UserId,
	authorName: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	content: Schema.String,
	createdAtMs: Schema.Finite,
	updatedAtMs: Schema.NullOr(Schema.Finite),
	pinnedAtMs: Schema.Finite,
})
export type Pin = typeof Pin.Type

export const PinnedMessagesMessage = UiSchema.TaggedEnum({
	UpdatedPins: { pins: Schema.Array(Pin) },
	PressedPinsButton: {},
	DismissedPins: {},
	/** The channel's pins shortcut (the page's hotkey). */
	PressedPinsHotkey: {},
	PressedPin: { messageId: MessageId },
	PressedUnpin: { pinnedId: PinnedMessageId },
	FailedUnpin: { reason: Schema.Literals(["PinNotFound", "Other"]) },
})
export type PinnedMessagesMessage = typeof PinnedMessagesMessage.Type

export const PinnedMessagesProps = Schema.Struct({ channelId: ChannelId })
export type PinnedMessagesProps = typeof PinnedMessagesProps.Type

export const PinnedMessagesModel = Schema.Struct({
	isOpen: Schema.Boolean,
	pins: Schema.Array(Pin),
})
export type PinnedMessagesModel = typeof PinnedMessagesModel.Type

const msOf = (value: Date | string | null | undefined) =>
	value === null || value === undefined ? null : new Date(value).getTime()

interface PinRow {
	readonly pinned: {
		readonly id: PinnedMessageId
		readonly messageId: MessageId
		readonly pinnedAt: Date | string
	}
	readonly message: {
		readonly authorId: UserId
		readonly content: string
		readonly createdAt: Date | string
		readonly updatedAt?: Date | string | null
	}
	readonly author?: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	}
}

/** The channel's pins with their messages, newest pin first (`sortedPins`). */
const pinsQuery = (channelId: ChannelId) =>
	withData((data) =>
		data.liveQueryStream<PinRow, PinnedMessagesMessage>(
			(q) =>
				q
					.from({ pinned: data.collections.pinnedMessageCollection })
					.where(({ pinned }) => eq(pinned.channelId, channelId))
					.innerJoin({ message: data.collections.messageCollection }, ({ pinned, message }) =>
						eq(pinned.messageId, message.id),
					)
					.leftJoin({ author: data.collections.userCollection }, ({ message, author }) =>
						eq(message.authorId, author.id),
					)
					.orderBy(({ pinned }) => pinned.pinnedAt, "desc"),
			(rows) =>
				PinnedMessagesMessage.UpdatedPins({
					pins: rows.map(({ pinned, message, author }) => ({
						pinnedId: pinned.id,
						messageId: pinned.messageId,
						authorId: message.authorId,
						authorName: author === undefined ? null : `${author.firstName} ${author.lastName}`,
						authorAvatarUrl: author?.avatarUrl ?? null,
						content: message.content,
						createdAtMs: new Date(message.createdAt).getTime(),
						updatedAtMs: msOf(message.updatedAt),
						pinnedAtMs: new Date(pinned.pinnedAt).getTime(),
					})),
				}),
		),
	)

/**
 * Keeps the pinned messages loaded by id while the popover's query runs: the snapshot sends every
 * pin but only the messages of the loaded window.
 */
const pinnedLoad = (channelId: ChannelId): Stream.Stream<never, never, ClientData> =>
	withData((data) =>
		data
			.liveQueryStream<{ messageId: MessageId }, ReadonlyArray<MessageId>>(
				(q) =>
					q
						.from({ pinned: data.collections.pinnedMessageCollection })
						.where(({ pinned }) => eq(pinned.channelId, channelId))
						.select(({ pinned }) => ({ messageId: pinned.messageId })),
				(rows) => [...new Set(rows.map((row) => row.messageId))].sort(),
			)
			.pipe(
				Stream.changesWith((a, b) => a.length === b.length && a.every((id, i) => id === b[i])),
				Stream.switchMap((ids) =>
					ids.length === 0
						? Stream.empty
						: Stream.callback<never>(() =>
								Effect.acquireRelease(
									Effect.sync(() => data.collections.messageCollection.utils.loadByIds(channelId, ids)),
									(demand) => Effect.sync(() => demand.release()),
								).pipe(Effect.flatMap(() => Effect.never)),
							),
				),
			),
	)

/** Removes a pin (`pinnedMessage.delete`, optimistic: the row leaves at once, back on failure). */
export class UnpinMessage extends Command.Service<UnpinMessage>()("hazel/chat/pins/UnpinMessage", {
	args: { pinnedId: PinnedMessageId },
	success: Schema.Union([PinnedMessagesMessage, Component.Noop]),
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return ({ pinnedId }) =>
				data.actions.unpinMessageAction({ pinnedMessageId: pinnedId }).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.as(Component.noop),
					Effect.catchTags({
						PinnedMessageNotFoundError: () =>
							Effect.succeed(PinnedMessagesMessage.FailedUnpin({ reason: "PinNotFound" })),
					}),
					// BOUNDARY: any other failure rolls the pin back and says so once.
					Effect.tapCause((cause) => Effect.logWarning("unpin failed", cause)),
					Effect.catchCause(() => Effect.succeed(PinnedMessagesMessage.FailedUnpin({ reason: "Other" }))),
				)
		}),
	)
}

/** Asks the channel page to scroll to a pinned message (the page owns the list's position). */
export class JumpToPin extends Command.Service<JumpToPin>()("hazel/chat/pins/JumpToPin", {
	args: { messageId: MessageId },
	success: Component.Noop,
}) {
	static readonly layerWith = (jump: (messageId: MessageId) => void) =>
		this.toLayer(
			Effect.succeed(({ messageId }) =>
				Effect.sync(() => {
					jump(messageId)
					return Component.noop
				}),
			),
		)
}

/** The page's pins shortcut, which opens the popover from anywhere in the channel. */
export class PinsHotkey extends Context.Service<PinsHotkey, Stream.Stream<void>>()("hazel/chat/pins/PinsHotkey") {}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const pad = (value: number) => String(value).padStart(2, "0")

/** "Mar 12 at 2:05 PM" in the local time zone. */
export const formatPinnedAt = (ms: number) => {
	const date = new Date(ms)
	const hours = date.getHours()
	const period = hours < 12 ? "AM" : "PM"
	return `${MONTHS[date.getMonth()]} ${date.getDate()} at ${hours % 12 || 12}:${pad(date.getMinutes())} ${period}`
}

export const PinnedMessages = Hazel.component({
	name: "PinnedMessages",
	props: PinnedMessagesProps,
	model: PinnedMessagesModel,
	message: PinnedMessagesMessage,
}).make({
	init: () => ({ isOpen: false, pins: [] }),
	update: {
		UpdatedPins: ($, { pins }) => $.evolve({ pins: () => pins }),
		PressedPinsButton: ($) => $.evolve({ isOpen: (isOpen) => !isOpen }),
		PressedPinsHotkey: ($) => $.evolve({ isOpen: (isOpen) => !isOpen }),
		DismissedPins: ($) => $.evolve({ isOpen: () => false }),
		PressedPin: ($, { messageId }) => $.evolve({ isOpen: () => false }).run(JumpToPin.make({ messageId })),
		PressedUnpin: ($, { pinnedId }) => $.run(UnpinMessage.make({ pinnedId })),
		FailedUnpin: ($, { reason }) =>
			$.run(
				ShowToast.make({
					toast:
						reason === "PinNotFound"
							? {
									intent: "error",
									title: "Message not found",
									description: "This message may have been deleted.",
								}
							: { intent: "error", title: "Something went wrong", description: "Please try again." },
				}),
			),
	},
	subscriptions: ({ props }) => [
		Subscription.make("pins", [props.channelId], ([channelId]) => pinsQuery(channelId)),
		Subscription.make("pins-load", [props.channelId], ([channelId]) => pinnedLoad(channelId)),
		Subscription.make(
			"pins-hotkey",
			Stream.unwrap(
				Effect.map(Effect.service(PinsHotkey), (presses) =>
					presses.pipe(Stream.map(() => PinnedMessagesMessage.PressedPinsHotkey())),
				),
			),
		),
	],
	view: (h, model) => {
		const trigger = h.button
			.label("View pinned messages")
			.icon("pin")
			.iconOnly()
			.variant("ghost")
			.size("small")
			.selected(model.isOpen)
			.on("press", PinnedMessagesMessage.PressedPinsButton())
		const count = model.pins.length
		const heading = h.stack
			.key("heading")
			.axis("horizontal")
			.align("center")
			.density("compact")
			.children(
				h.icon.name("pin"),
				h.heading.level("3").children("Pinned messages"),
				h.spacer,
				h.badge
					.label(`${count} ${count === 1 ? "pin" : "pins"}`)
					.style("quiet")
					.pill(),
			)
		// HAZEL-GAP(pins-row-meta): the row's time, "(edited)" and "Pinned Mar 12 at 2:05 PM" lines.
		const row = (pin: Pin) => {
			const name = pin.authorName ?? "Unknown user"
			const isEdited = pin.updatedAtMs !== null && pin.updatedAtMs > pin.createdAtMs
			return h.item
				.key(pin.pinnedId)
				.title(name)
				.subtitle(pin.content)
				.subtitleLines("2")
				.leadingSize("large")
				.leading(
					h.avatar
						.name(pin.authorName ?? "")
						.initials(initialsOf(name))
						.src(pin.authorAvatarUrl ?? undefined)
						.size("medium"),
				)
				.trailing(
					h.text
						.role("caption")
						.tone("muted")
						.numeric()
						.children(`${formatTime(pin.createdAtMs)}${isEdited ? " (edited)" : ""}`),
				)
				.actions(
					h.button
						.label("Unpin message")
						.icon("close")
						.iconOnly()
						.variant("ghost")
						.size("xsmall")
						.on("press", PinnedMessagesMessage.PressedUnpin({ pinnedId: pin.pinnedId })),
				)
				.on("press", PinnedMessagesMessage.PressedPin({ messageId: pin.messageId }))
		}
		const body =
			count === 0
				? h.emptyState
						.key("empty")
						.title("No pinned messages yet")
						.description("Pin a message from its menu to keep it here for everyone in the channel.")
				: h.section
						.key("pins")
						.style("list")
						.children(...model.pins.map(row))
		// HAZEL-GAP(pins-panel-size): today's panel is 384px wide and scrolls past 400px.
		return h.popover
			.open(model.isOpen)
			.anchor(trigger)
			.on("dismiss", PinnedMessagesMessage.DismissedPins())
			.children(h.frame.surface("overlay").children(heading, body))
	},
})

/** The pins' Commands and the page's shortcut, from the host's data instance. */
export const pinnedMessagesLayer = (
	jump: (messageId: MessageId) => void,
	hotkey: Stream.Stream<void>,
) =>
	Layer.mergeAll(UnpinMessage.layer, JumpToPin.layerWith(jump), Layer.succeed(PinsHotkey, hotkey))

