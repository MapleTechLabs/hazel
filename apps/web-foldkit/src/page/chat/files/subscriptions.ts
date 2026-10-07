import { ChannelId } from "@hazel/schema"
import { Option } from "effect"
import { Subscription } from "foldkit"
import * as Interaction from "../../../ui/aria/interaction"
import { attachmentsStream, breakpointStream } from "./data"
import { Message, type Model } from "./page"

/** The Files tab's live query, breakpoint and interaction listeners; keys are `files`-prefixed. */

const data = Subscription.make<Model, Message>()((entry) => ({
	filesAttachments: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: (model) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				attachmentsStream(channelId, (attachments, nowMs) =>
					Message.UpdatedAttachments({ attachments, nowMs }),
				),
		},
	),
	filesBreakpoint: Subscription.persistent(
		breakpointStream((breakpoint) => Message.ResizedViewport({ breakpoint })),
	),
}))

const interaction = Subscription.lift(Interaction.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.interaction),
	toParentMessage: (message) => Message.GotInteractionMessage({ message }),
})

export const subscriptions = Subscription.aggregate(data, {
	filesInteractionModality: interaction.modality,
	filesInteractionPointerRelease: interaction.pointerRelease,
})
