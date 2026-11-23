import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { type CommonReason, commonMessage, isRetryableReason } from "~/lib/error-messages"
import * as SuggestionPrompt from "../../../customers/suggestion-prompt"
import { IconPlus } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader } from "../../../ui/card"
import { emptyState } from "../../../ui/empty-state"
import { loadingState } from "../../../ui/loader"
import type { PageViewInputs } from "../../contract"
import type * as ConfirmAction from "../../shared/confirm-action"
import { confirmDialog } from "../chat-sync/confirm-dialog"
import { isRetryable, PROVIDERS } from "../chat-sync/providers"
import type { Connection } from "../chat-sync/model"
import {
	type ChannelLink,
	type ListLinksFailure,
	listedLinks,
	listLinksFailureMessage,
	Message,
	type Model,
} from "./model"
import { addLinkModal } from "./add-link-view"
import { connectionCard, header } from "./connection-card"
import { aboutCard, channelLinkRow, outlineIcon } from "./parts"
import { heading } from "../../../ui/heading"

/** Port of `settings/chat-sync/$connectionId.tsx`. */

const WARNING_PATH =
	"M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
const LINK_PATH =
	"M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"

const toRemoveLinkConfirmMessage = (message: ConfirmAction.Message) =>
	Message.GotRemoveLinkConfirmMessage({ message })
const toDisconnectConfirmMessage = (message: ConfirmAction.Message) =>
	Message.GotDisconnectConfirmMessage({ message })

const backLink = (h: HtmlBuilder<Message>): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sm",
			className: "-ml-2 w-fit text-muted-fg",
			onPress: Message.ClickedBack(),
		},
		[outlineIcon(h, { className: "size-4", d: "M15 19l-7-7 7-7" }), "Back to Chat Sync"],
	)

const linkChannelButton = (h: HtmlBuilder<Message>, intent: "primary" | "secondary"): Html =>
	button(h, { intent, size: "sm", onPress: Message.ClickedLinkChannel() }, [
		IconPlus(h, { attributes: { "data-slot": "icon" } }),
		"Link Channel",
	])

const linksBody = (
	h: HtmlBuilder<Message>,
	model: Model,
	connection: Connection,
	links: ReadonlyArray<ChannelLink>,
): Html =>
	links.length === 0
		? emptyState(h, {
				icon: (className) => outlineIcon(h, { className, d: LINK_PATH, strokeWidth: "1.5" }),
				title: "No channels linked",
				description: `Link a Hazel channel to a ${PROVIDERS[connection.provider].name} channel to start syncing messages.`,
				action: linkChannelButton(h, "primary"),
				className: "px-5 py-12",
			})
		: h.div(
				[h.Class("divide-y divide-border")],
				links.map((link) =>
					channelLinkRow(
						h,
						link,
						connection.provider,
						model.channelNames[link.hazelChannelId],
						model.linkMenus.find((menu) => menu.id.endsWith(link.id)),
					),
				),
			)

/** A first links list that failed: what went wrong, with "Try again" when it may pass. */
const linksFailed = (h: HtmlBuilder<Message>, reason: ListLinksFailure): Html => {
	const message = listLinksFailureMessage(reason)
	return emptyState(h, {
		title: "Failed to load channel links",
		description: message.description ?? message.title,
		action: isRetryable(reason)
			? button(
					h,
					{ intent: "secondary", size: "sm", onPress: Message.ClickedRetryListChannelLinks() },
					["Try again"],
				)
			: undefined,
		className: "px-5 py-12",
	})
}

const linksCard = (h: HtmlBuilder<Message>, model: Model, connection: Connection): Html => {
	const links = listedLinks(model)
	const loading = () => loadingState(h, { label: "Loading channel links...", className: "py-8" })
	return card(h, {}, [
		cardHeader(
			h,
			[
				h.div(
					[h.Class("flex items-center gap-2")],
					[
						heading(h, { variant: "subsection" }, ["Channel Links"]),
						...(links.length > 0 ? [badge(h, { intent: "secondary" }, [`${links.length}`])] : []),
					],
				),
				linkChannelButton(h, "secondary"),
			],
			"flex-row items-center justify-between gap-3 py-3",
		),
		AsyncData.match(model.links, {
			onIdle: loading,
			onLoading: loading,
			onFailure: (reason) => linksFailed(h, reason),
			onRefreshing: (data) => linksBody(h, model, connection, data),
			onStale: ({ data }) => linksBody(h, model, connection, data),
			onSuccess: (data) => linksBody(h, model, connection, data),
		}),
	])
}

const warningIcon = (h: HtmlBuilder<Message>) =>
	outlineIcon(h, { className: "", d: WARNING_PATH, strokeWidth: "1.5" })

const toSuggestionMessage = (message: SuggestionPrompt.Message) => Message.GotSuggestionMessage({ message })

const detail = (h: HtmlBuilder<Message>, model: Model, connection: Connection): Html =>
	h.div(
		[h.Class("flex flex-col gap-6")],
		[
			backLink(h),
			header(h, connection),
			h.div(
				[h.Class("grid gap-8 lg:grid-cols-[1fr_320px]")],
				[
					h.div(
						[h.Class("flex flex-col gap-8")],
						[
							connectionCard(h, connection),
							SuggestionPrompt.view(h, model.suggestion, {
								toParentMessage: toSuggestionMessage,
								subject:
									model.suggestionChannelName === null
										? undefined
										: `#${model.suggestionChannelName}`,
							}),
							linksCard(h, model, connection),
						],
					),
					aboutCard(h, connection.provider),
				],
			),
			addLinkModal(h, model, connection.provider),
			confirmDialog(h, {
				slotId: "remove-link",
				confirm: model.removeLinkConfirm,
				icon: warningIcon(h),
				title: "Remove Channel Link",
				description: (target) => [
					"Are you sure you want to remove the link to",
					target.name,
					"? Messages will stop syncing between these channels.",
				],
				confirmLabel: "Remove Link",
				pendingLabel: "Removing...",
				onConfirm: Message.ClickedConfirmRemoveLink(),
				toParentMessage: toRemoveLinkConfirmMessage,
			}),
			confirmDialog(h, {
				slotId: "disconnect",
				confirm: model.disconnectConfirm,
				icon: warningIcon(h),
				title: `Disconnect from ${PROVIDERS[connection.provider].name}`,
				description: () => [
					"Are you sure you want to disconnect",
					connection.displayName,
					"? All channel links will be removed and messages will stop syncing. This action cannot be undone.",
				],
				confirmLabel: "Disconnect",
				pendingLabel: "Disconnecting...",
				onConfirm: Message.ClickedConfirmDisconnect(),
				toParentMessage: toDisconnectConfirmMessage,
			}),
		],
	)

const goBack = (h: HtmlBuilder<Message>): Html =>
	button(h, { intent: "secondary", onPress: Message.ClickedBack() }, ["Go back"])

const notFound = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex flex-col gap-6")],
		[
			backLink(h),
			emptyState(h, {
				title: "Connection not found",
				description: "This sync connection may have been deleted.",
				action: goBack(h),
			}),
		],
	)

/** The connection list failed: say why and offer "Try again" when it may pass, never "not found". */
const loadFailed = (h: HtmlBuilder<Message>, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return h.div(
		[h.Class("flex flex-col gap-6")],
		[
			backLink(h),
			emptyState(h, {
				title: "Failed to load connection",
				description: message.description ?? message.title,
				action: isRetryableReason(reason)
					? [
							button(h, { intent: "primary", onPress: Message.ClickedRetryLoadConnection() }, [
								"Try again",
							]),
							goBack(h),
						]
					: goBack(h),
			}),
		],
	)
}

const found = (h: HtmlBuilder<Message>, model: Model, connection: Connection | null): Html =>
	connection === null ? notFound(h) : detail(h, model, connection)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	AsyncData.match(model.connection, {
		onIdle: () => loadingState(h, { label: "Loading connection...", className: "py-24" }),
		onLoading: () => loadingState(h, { label: "Loading connection...", className: "py-24" }),
		onFailure: (reason) => loadFailed(h, reason),
		// A refresh (or a failed one, which toasts) keeps the shown connection.
		onRefreshing: (connection) => found(h, model, connection),
		onStale: ({ data }) => found(h, model, data),
		onSuccess: (connection) => found(h, model, connection),
	}),
)
