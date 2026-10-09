import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import { createChannelAction, joinChannelAction } from "~/db/actions"
import { PresenceStatus } from "../../platform/presence/model"
import { HazelRpc } from "../../rpc"
import { Message } from "./message"
import { ChannelType } from "./model"
import { failureToast, runAtomFn } from "../../data/actions"

/** Side effects of the palette pages, each the call legacy makes from the same handler. */

/** `createChannelAction` from `CreateChannelView.handleSubmit`. */
export const CreateChannel = Command.define("CreateChannel", {
	args: { name: Schema.String, type: ChannelType, organizationId: OrganizationId, currentUserId: UserId },
	messages: [Message.SucceededCreateChannel, Message.FailedCreateChannel],
	execute: ({ name, type, organizationId, currentUserId }) =>
		runAtomFn(createChannelAction, {
			name,
			icon: null,
			type,
			organizationId,
			parentChannelId: null,
			currentUserId,
		}).pipe(
			Effect.map((result) => Message.SucceededCreateChannel({ channelId: result.data.channelId })),
			Effect.catchCause((cause) => Effect.succeed(Message.FailedCreateChannel({ toast: failureToast(cause, "friendly") }))),
		),
})

/** `joinChannelAction` from `JoinChannelView.handleJoinChannel`. */
export const JoinChannel = Command.define("JoinChannel", {
	args: { channelId: ChannelId, userId: UserId },
	messages: [Message.SucceededJoinChannel, Message.FailedJoinChannel],
	execute: ({ channelId, userId }) =>
		runAtomFn(joinChannelAction, { channelId, userId }).pipe(
			Effect.as(Message.SucceededJoinChannel()),
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedJoinChannel({
						toast: failureToast(cause, "friendly", {
							ChannelNotFoundError: {
								title: "Channel not found",
								description: "This channel may have been deleted.",
								isRetryable: false,
							},
						}),
					}),
				),
			),
		),
})

/** `usePresence().setStatus` (the RPC part; the manual status itself lives with presence). */
export const SetPresenceStatus = Command.define("SetPresenceStatus", {
	args: { status: PresenceStatus },
	messages: [Message.SucceededSetPresenceStatus, Message.FailedSetPresenceStatus],
	execute: ({ status }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("userPresenceStatus.update", { status, customMessage: null })
			return Message.SucceededSetPresenceStatus()
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(Message.FailedSetPresenceStatus({ reason: Cause.pretty(cause) })),
			),
		),
})

const RECENT_CHANNELS_KEY = "recentChannels"
const MAX_RECENT_CHANNELS = 8

const RecentChannels = Schema.Array(Schema.Struct({ channelId: Schema.String, visitedAt: Schema.Number }))
const decodeRecentJson = Schema.decodeUnknownOption(Schema.fromJsonString(RecentChannels))

/** The stored `recentChannels`, empty when missing or unreadable. */
const readRecentChannels = Effect.try(() => localStorage.getItem(RECENT_CHANNELS_KEY)).pipe(
	Effect.map((raw) => (raw === null ? [] : Option.getOrElse(decodeRecentJson(raw), () => []))),
	Effect.orElseSucceed(() => []),
)

/** `recentChannelsAtom`: the palette's `trackChannel`, newest first, at most eight. */
export const TrackRecentChannel = Command.define("TrackRecentChannel", {
	args: { channelId: ChannelId },
	messages: [Message.CompletedTrackRecentChannel],
	execute: ({ channelId }) =>
		readRecentChannels.pipe(
			Effect.map((channels) =>
				[{ channelId, visitedAt: Date.now() }, ...channels.filter((entry) => entry.channelId !== channelId)].slice(
					0,
					MAX_RECENT_CHANNELS,
				),
			),
			Effect.flatMap((channels) => Effect.sync(() => localStorage.setItem(RECENT_CHANNELS_KEY, JSON.stringify(channels)))),
			Effect.ignoreCause,
			Effect.as(Message.CompletedTrackRecentChannel()),
		),
})

const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

/** The recent channel ids, as `recentChannelsAtom` reads them, decoded at the storage boundary. */
export const readRecentChannelIds = readRecentChannels.pipe(
	Effect.map((channels) =>
		channels.flatMap((entry) =>
			Option.match(decodeChannelId(entry.channelId), { onNone: () => [], onSome: (id) => [id] }),
		),
	),
)

/** `autoFocus` on a form page's input, after the page renders. */
export const FocusInput = Command.define("FocusInput", {
	args: { selector: Schema.String },
	messages: [Message.CompletedFocusInput],
	execute: ({ selector }) => Dom.focus(selector).pipe(Effect.ignoreCause, Effect.as(Message.CompletedFocusInput())),
})
