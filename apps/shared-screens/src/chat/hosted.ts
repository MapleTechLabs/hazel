// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A conversation with its wiring, for every host: reply and edit go to its own composer, copies to
 * the clipboard, threads and links through `Navigator`. A host provides `MessageListHost` (each
 * request it alone decides, by name), `LiveConnection`, and the composer's files and drafts.
 */
import { Component } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Clipboard } from "@hazel/client-data/platform"
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Match, Stream } from "effect"
import { Navigator, openRoute } from "../app/navigator"
import { existingDm } from "../modals/CreateDmModal"
import { AppRequest, AppRequests } from "../app/requests"
import { AppRoute } from "../app/route"
import { ChannelScreen } from "./ChannelScreen"
import { botCommandsLayer } from "./composer/bot-commands"
import { ComposerHost, ComposerRequests } from "./composer/host"
import { messageListLayer } from "./live"
import type { HostRequest } from "./messages"
import { klipyGifsLayer } from "./pickers/klipy"
import { LiveConnection } from "./rich/live-replies"

/** What a conversation leaves to its host, each by name: a host that has not decided fails to compile. */
export class MessageListHost extends Context.Service<
	MessageListHost,
	{
		/** Delete, after the host's own confirmation (a dialog, an action sheet). */
		readonly deleteMessage: (channelId: ChannelId, messageId: MessageId) => Effect.Effect<void>
		/** A customer issue from the message (`issue`). */
		readonly createIssue: (channelId: ChannelId, messageId: MessageId) => Effect.Effect<void>
		/** An attachment opened: the host's viewer (lightbox) or the system's. */
		readonly openAttachment: (
			request: Extract<HostRequest, { readonly _tag: "OpenAttachment" }>,
		) => Effect.Effect<void>
		readonly retry: (channelId: ChannelId, messageId: MessageId) => Effect.Effect<void>
		readonly jumpToReply: (channelId: ChannelId, messageId: MessageId) => Effect.Effect<void>
	}
>()("hazel/chat/MessageListHost") {}

const messageListHostLayer = (orgSlug: string, channelId: ChannelId) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const navigator = yield* Navigator
			const clipboard = yield* Clipboard
			const composer = yield* ComposerRequests
			const host = yield* MessageListHost
			const live = yield* LiveConnection
			const requests = yield* AppRequests
			// A refused clipboard says so (as the web's copies do), never a silent no-op; `copied`
			// is the success toast, for copies that confirm.
			const copy = (text: string, copied: Effect.Effect<void> = Effect.void) =>
				clipboard.write(text).pipe(
					Effect.andThen(copied),
					Effect.catchTag("ClipboardError", () =>
						requests.send(
							AppRequest.ShowToast({
								toast: { intent: "error", title: "Couldn't copy", description: null },
							}),
						),
					),
				)
			const toast = (title: string) =>
				requests.send(
					AppRequest.ShowToast({ toast: { intent: "success", title, description: null } }),
				)
			/** The viewer's DM with `userId`: open it, or have the app create it (its toast and link). */
			const messageUser = (userId: UserId, viewerId: UserId, name: string) => {
				const organizationId = data.collections.channelCollection.state.get(channelId)?.organizationId
				if (organizationId === undefined) return Effect.void
				const dm = existingDm(data, organizationId, viewerId, [userId])
				return dm !== null
					? openRoute(navigator, AppRoute.ChatChannel({ orgSlug, channelId: dm }))
					: requests.send(AppRequest.CreateDm({ organizationId, orgSlug, userId, name }))
			}
			const handle = (request: HostRequest): Effect.Effect<void> =>
				Match.valueTags(request, {
					Action: ({ messageId, action, content, author, image }) =>
						Match.value(action).pipe(
							Match.when("reply", () =>
								composer.send(channelId, {
									_tag: "Reply",
									messageId,
									author,
									text: content,
								}),
							),
							Match.when("edit", () =>
								composer.send(channelId, { _tag: "Edit", messageId, content }),
							),
							Match.when("copy", () => copy(content)),
							Match.when("copyId", () => copy(messageId)),
							Match.whenOr("copyImage", "copyImageUrl", () => copy(image ?? "")),
							Match.when("delete", () => host.deleteMessage(channelId, messageId)),
							Match.when("issue", () => host.createIssue(channelId, messageId)),
							// The list runs the rest itself (react, pin, thread, select text).
							Match.orElse(() => Effect.void),
						),
					// A thread is a channel of its own.
					OpenThread: ({ threadChannelId }) =>
						threadChannelId === null
							? Effect.void
							: openRoute(
									navigator,
									AppRoute.ChatChannel({ orgSlug, channelId: threadChannelId }),
								),
					OpenLink: ({ url }) => navigator.open(url),
					EditProfile: () => openRoute(navigator, AppRoute.MySettingsProfile({ orgSlug })),
					MessageUser: ({ userId, viewerId, name }) => messageUser(userId, viewerId, name),
					ViewProfile: ({ userId }) => openRoute(navigator, AppRoute.Profile({ orgSlug, userId })),
					// The composer's own mention markup, as picking the person from `@` writes it.
					MentionUser: ({ userId }) =>
						composer.send(channelId, { _tag: "InsertText", text: `@[userId:${userId}] ` }),
					CopyProfileField: ({ field, text }) =>
						copy(text, toast(field === "email" ? "Email copied" : "User ID copied")),
					OpenAttachment: (open) => host.openAttachment(open),
					JumpToReply: ({ messageId }) => host.jumpToReply(channelId, messageId),
					Retry: ({ messageId }) => host.retry(channelId, messageId),
				})
			return messageListLayer(data, rpc, handle, live)
		}),
	)

/** The composer's host: its channel's requests; no drag and drop; a thread is its own conversation. */
const composerHostLayer = Layer.effect(
	ComposerHost,
	Effect.map(Effect.service(ComposerRequests), (requests) =>
		ComposerHost.of({
			requests: requests.of,
			// Each notice is a desktop key's (Escape, Shift+Tab) or the list's own: a sent message
			// already scrolls the phone's list to its end (it follows the bottom).
			notify: () => Effect.void,
			dragging: Stream.make(false),
			thread: Stream.make(null),
		}),
	),
)

/** A conversation: its list and composer wired (`ComposerFiles`, `Drafts` and the data from the host). */
export const HostedChannelScreen = Component.provide(ChannelScreen, (props) =>
	Layer.mergeAll(
		messageListHostLayer(props.orgSlug, props.channelId),
		composerHostLayer,
		botCommandsLayer,
		klipyGifsLayer,
	),
)
