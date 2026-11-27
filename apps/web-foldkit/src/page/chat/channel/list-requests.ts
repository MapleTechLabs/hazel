import type { HostRequest } from "@hazel/shared-screens/chat/messages"
import { Match, Stream } from "effect"
import { eventsOf } from "../../../root/bus"
import * as Overlays from "../overlays"
import { Message } from "./page"

const toOverlay = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })

/** What a row of the shared message list asks the page for; the rest the list does itself. */
type ListMessage = ReturnType<
	| typeof Message.GotOverlaysMessage
	| typeof Message.ClickedThreadPreview
	| typeof Message.ClickedEditProfile
>

export const listRequests = (request: HostRequest): ReadonlyArray<ListMessage> =>
	Match.valueTags(request, {
		Action: ({ messageId, action, image }) => {
			// Today's image entries copy the image under the pointer (`IMAGE_ACTIONS`).
			if ((action === "copyImage" || action === "copyImageUrl") && image !== undefined)
				return [
					toOverlay(
						Overlays.Message.ChoseImageAction({
							action: action === "copyImage" ? "copyImage" : "copyUrl",
							url: image,
						}),
					),
				]
			const value =
				action === "issue"
					? "create-issue"
					: action === "react"
						? "add-reaction"
						: action === "copyId"
							? "copy-id"
							: action
			return [toOverlay(Overlays.Message.ChoseNativeAction({ messageId, value }))]
		},
		OpenThread: ({ messageId, threadChannelId }) => [
			threadChannelId === null
				? toOverlay(Overlays.Message.ChoseNativeAction({ messageId, value: "thread" }))
				: Message.ClickedThreadPreview({ threadChannelId, messageId }),
		],
		OpenAttachment: ({ messageId, index, url }) => {
			if (index >= 0) return [toOverlay(Overlays.Message.ClickedAttachmentImage({ messageId, index }))]
			globalThis.open?.(url, "_blank", "noopener")
			return []
		},
		OpenLink: ({ url }) => {
			globalThis.open?.(url, "_blank", "noopener")
			return []
		},
		EditProfile: () => [Message.ClickedEditProfile()],
		// The jump to an unloaded reply lived in the Foldkit list.
		JumpToReply: () => [],
		Retry: () => [],
	})

/** The list's requests, which the shell renders as its own child and publishes on the bus. */
export const listRequestStream: Stream.Stream<ListMessage> = Stream.merge(
	eventsOf("MessageList").pipe(Stream.flatMap(({ request }) => Stream.fromIterable(listRequests(request)))),
	// A pin pressed in the shared channel header: the page scrolls to its message.
	eventsOf("JumpToPin").pipe(
		Stream.map(({ messageId }) => toOverlay(Overlays.Message.ClickedPinnedMessage({ messageId }))),
	),
)
