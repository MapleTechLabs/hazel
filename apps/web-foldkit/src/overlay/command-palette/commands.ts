import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import { createChannelAction, joinChannelAction } from "~/db/actions"
import { HazelRpc } from "../../rpc"
import { runAction, toastForCause } from "../action"
import { Message } from "./message"
import { ChannelType } from "./model"

/** Side effects of the palette pages, each the call legacy makes from the same handler. */

const done = Effect.as(Message.CompletedEffect())

/** `createChannelAction` from `CreateChannelView.handleSubmit`. */
export const CreateChannel = Command.define("CreateChannel", {
	args: { name: Schema.String, type: ChannelType, organizationId: OrganizationId, currentUserId: UserId },
	messages: [Message.SucceededCreateChannel, Message.FailedCreateChannel],
	execute: ({ name, type, organizationId, currentUserId }) =>
		runAction(createChannelAction, {
			name,
			icon: null,
			type,
			organizationId,
			parentChannelId: null,
			currentUserId,
		}).pipe(
			Effect.map((result) => Message.SucceededCreateChannel({ channelId: result.data.channelId })),
			Effect.catchCause((cause) => Effect.succeed(Message.FailedCreateChannel({ toast: toastForCause(cause) }))),
		),
})

/** `joinChannelAction` from `JoinChannelView.handleJoinChannel`. */
export const JoinChannel = Command.define("JoinChannel", {
	args: { channelId: ChannelId, userId: UserId },
	messages: [Message.SucceededJoinChannel, Message.FailedJoinChannel],
	execute: ({ channelId, userId }) =>
		runAction(joinChannelAction, { channelId, userId }).pipe(
			Effect.as(Message.SucceededJoinChannel()),
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedJoinChannel({
						toast: toastForCause(cause, {
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

/** `usePresence().setStatus` (the RPC part; manual status tracking lives with presence). */
export const SetPresenceStatus = Command.define("SetPresenceStatus", {
	args: { status: Schema.Literals(["online", "away", "busy", "dnd"]) },
	messages: [Message.CompletedEffect],
	execute: ({ status }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("userPresenceStatus.update", { status, customMessage: null })
		}).pipe(Effect.ignoreCause, done),
})

const RECENT_CHANNELS_KEY = "recentChannels"
const MAX_RECENT_CHANNELS = 8

const readJson = (key: string) =>
	Effect.try(() => {
		const raw = localStorage.getItem(key)
		return raw === null ? null : (JSON.parse(raw) as unknown)
	}).pipe(Effect.orElseSucceed(() => null))


const RecentChannels = Schema.Array(Schema.Struct({ channelId: Schema.String, visitedAt: Schema.Number }))
const decodeRecent = Schema.decodeUnknownOption(RecentChannels)

/** `recentChannelsAtom`: the palette's `trackChannel`, newest first, at most eight. */
export const TrackRecentChannel = Command.define("TrackRecentChannel", {
	args: { channelId: Schema.String },
	messages: [Message.CompletedEffect],
	execute: ({ channelId }) =>
		readJson(RECENT_CHANNELS_KEY).pipe(
			Effect.map((raw) => Option.getOrElse(decodeRecent(raw), () => [])),
			Effect.map((channels) =>
				[{ channelId, visitedAt: Date.now() }, ...channels.filter((entry) => entry.channelId !== channelId)].slice(
					0,
					MAX_RECENT_CHANNELS,
				),
			),
			Effect.flatMap((channels) => Effect.sync(() => localStorage.setItem(RECENT_CHANNELS_KEY, JSON.stringify(channels)))),
			Effect.ignoreCause,
			done,
		),
})

/** The recent channel ids, as `recentChannelsAtom` reads them. */
export const readRecentChannelIds = readJson(RECENT_CHANNELS_KEY).pipe(
	Effect.map((raw) => Option.getOrElse(decodeRecent(raw), () => []).map((entry) => entry.channelId)),
)

/** `autoFocus` on a form page's input, after the page renders. */
export const FocusInput = Command.define("FocusInput", {
	args: { selector: Schema.String },
	messages: [Message.CompletedEffect],
	execute: ({ selector }) => Dom.focus(selector).pipe(Effect.ignoreCause, done),
})
