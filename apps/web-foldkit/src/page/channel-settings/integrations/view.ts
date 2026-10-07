import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconPlus } from "../../../icons"
import { button } from "../../../ui/button"
import { dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import * as Modal from "../../../ui/modal"
import type { PageViewInputs } from "../../contract"
import { tabHeader } from "../section-header"
import { gitHubCard } from "./cards"
import { rssCard } from "./rss-card"
import { Message } from "./message"
import type { Model, RowKind } from "./model"
import { providerCard } from "./provider-card"
import { customWebhooksCard } from "./webhooks"

/** Port of `channels/$channelId/settings/integrations.tsx`. */

const toConfirmModalMessage = (message: Modal.Message) => Message.GotConfirmModalMessage({ message })

const CONFIRM_COPY: Readonly<Record<RowKind, { title: string; description: string; action: string }>> = {
	webhook: {
		title: "Delete webhook?",
		description: "This webhook URL will stop working immediately.",
		action: "Delete",
	},
	rss: {
		title: "Remove feed?",
		description: "This will stop posting updates from this RSS feed.",
		action: "Remove",
	},
	github: {
		title: "Remove subscription?",
		description: "This will stop posting GitHub events to this channel.",
		action: "Remove",
	},
}

/** Each row's `<ModalContent role="alertdialog" size="xs">` delete confirmation. */
const confirmModal = (h: HtmlBuilder<Message>, model: Model): Html => {
	const copy = CONFIRM_COPY[model.confirmTarget?.kind ?? "webhook"]
	return h.submodel({
		slotId: "integration-row-remove",
		model: model.confirmModal,
		view: Modal.view,
		viewInputs: {
			toTrigger: (_attributes, overlay) => overlay,
			role: "alertdialog",
			size: "xs",
			toContent: (closeAttributes) => [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.confirmModal.id), text: copy.title },
					description: copy.description,
				}),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(
						h,
						{
							intent: "danger",
							isPending: model.isConfirmPending,
							onPress: Message.ClickedConfirmRemove(),
						},
						[copy.action],
					),
				]),
			],
		},
		toParentMessage: toConfirmModalMessage,
	})
}

const comingSoon = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[
			h.Class(
				"flex items-center gap-3 rounded-xl border border-border border-dashed bg-secondary/30 p-4",
			),
		],
		[
			h.div(
				[h.Class("flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary")],
				[IconPlus(h, { className: "size-5 text-muted-fg" })],
			),
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					h.span([h.Class("font-medium text-muted-fg")], ["More integrations coming soon"]),
					h.span([h.Class("text-muted-fg/70 text-sm")], ["Slack, Linear, and more"]),
				],
			),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const regular = model.webhooks.items.filter(
		(webhook) => webhook.name !== "OpenStatus" && webhook.name !== "Railway",
	)
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			tabHeader(h, "Integrations", "Connect external services to this channel."),
			h.div(
				[h.Class("flex flex-col gap-4")],
				[
					gitHubCard(h, model),
					rssCard(h, model),
					providerCard(h, model, "openstatus", shared),
					providerCard(h, model, "railway", shared),
					customWebhooksCard(h, model, regular, shared),
					comingSoon(h),
				],
			),
			confirmModal(h, model),
		],
	)
})
