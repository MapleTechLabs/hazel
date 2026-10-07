import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconPlus } from "../../../icons"
import { button } from "../../../ui/button"
import { emptyState } from "../../../ui/empty-state"
import type * as Modal from "../../../ui/modal"
import type { PageViewInputs } from "../../contract"
import { confirmDialog } from "../chat-sync/confirm-dialog"
import type { Connection } from "../chat-sync/model"
import { type ChannelLink, Message, type Model } from "./model"
import { connectionCard, header } from "./connection-card"
import { aboutCard, channelLinkRow, outlineIcon } from "./parts"

/** Port of `settings/chat-sync/$connectionId.tsx`. */

const WARNING_PATH =
	"M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
const LINK_PATH =
	"M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"

const toDeleteLinkModalMessage = (message: Modal.Message) => Message.GotDeleteLinkModalMessage({ message })
const toDisconnectModalMessage = (message: Modal.Message) => Message.GotDisconnectModalMessage({ message })

const backLink = (h: HtmlBuilder<Message>): Html =>
	h.button(
		[
			h.Type("button"),
			h.OnClick(Message.ClickedBack()),
			h.Class(
				"-ml-1 flex w-fit items-center gap-1 text-muted-fg text-sm transition-colors hover:text-fg",
			),
		],
		[outlineIcon(h, { className: "size-4", d: "M15 19l-7-7 7-7" }), h.span([], ["Back to Chat Sync"])],
	)

const spinner = (h: HtmlBuilder<Message>, size: string, text: string, padding: string): Html =>
	h.div(
		[h.Class(`flex items-center justify-center ${padding}`)],
		[
			h.div(
				[h.Class("flex items-center gap-3 text-muted-fg")],
				[
					h.div(
						[
							h.Class(
								`${size} animate-spin rounded-full border-2 border-border border-t-primary`,
							),
						],
						[],
					),
					h.span([h.Class("text-sm")], [text]),
				],
			),
		],
	)

const linkChannelButton = (h: HtmlBuilder<Message>, intent: "primary" | "secondary"): Html =>
	button(h, { intent, size: "sm", onPress: Message.ClickedLinkChannel() }, [
		IconPlus(h, { attributes: { "data-slot": "icon" } }),
		"Link Channel",
	])

const linksBody = (h: HtmlBuilder<Message>, model: Model, links: ReadonlyArray<ChannelLink>): Html =>
	links.length === 0
		? h.div(
				[h.Class("flex flex-col items-center justify-center px-5 py-12 text-center")],
				[
					h.div(
						[h.Class("mb-4 flex size-12 items-center justify-center rounded-xl bg-bg-muted")],
						[
							outlineIcon(h, {
								className: "size-6 text-muted-fg",
								d: LINK_PATH,
								strokeWidth: "1.5",
							}),
						],
					),
					h.p([h.Class("mb-1 font-medium text-fg text-sm")], ["No channels linked"]),
					h.p(
						[h.Class("mb-4 text-muted-fg text-sm")],
						["Link a Hazel channel to a Discord channel to start syncing messages."],
					),
					linkChannelButton(h, "primary"),
				],
			)
		: h.div(
				[h.Class("divide-y divide-border")],
				links.map((link) =>
					channelLinkRow(
						h,
						link,
						model.channelNames[link.hazelChannelId],
						model.linkMenus.find((menu) => menu.id.endsWith(link.id)),
					),
				),
			)

const linksCard = (h: HtmlBuilder<Message>, model: Model): Html => {
	const links = model.links._tag === "Loaded" ? model.links.links : []
	return h.div(
		[h.Class("overflow-hidden rounded-xl border border-border bg-bg")],
		[
			h.div(
				[
					h.Class(
						"flex items-center justify-between border-border border-b bg-bg-muted/30 px-5 py-3",
					),
				],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.h3([h.Class("font-semibold text-fg text-sm")], ["Channel Links"]),
							...(links.length > 0
								? [
										h.span(
											[
												h.Class(
													"rounded-sm bg-secondary px-2 py-0.5 text-muted-fg text-xs",
												),
											],
											[`${links.length}`],
										),
									]
								: []),
						],
					),
					linkChannelButton(h, "secondary"),
				],
			),
			model.links._tag === "Loading"
				? spinner(h, "size-5", "Loading channel links...", "p-8")
				: linksBody(h, model, links),
		],
	)
}

const warningIcon = (h: HtmlBuilder<Message>) =>
	outlineIcon(h, { className: "size-6 text-danger", d: WARNING_PATH, strokeWidth: "1.5" })

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
						[connectionCard(h, connection), linksCard(h, model)],
					),
					aboutCard(h),
				],
			),
			confirmDialog(h, {
				slotId: "remove-link",
				modal: model.deleteLinkModal,
				icon: warningIcon(h),
				title: "Remove Channel Link",
				description: [
					"Are you sure you want to remove the link to",
					model.deleteTarget?.name ?? "",
					"? Messages will stop syncing between these channels.",
				],
				confirmLabel: "Remove Link",
				pendingLabel: "Removing...",
				isPending: model.isDeletingLink,
				onConfirm: Message.ClickedConfirmRemoveLink(),
				toParentMessage: toDeleteLinkModalMessage,
			}),
			confirmDialog(h, {
				slotId: "disconnect",
				modal: model.disconnectModal,
				icon: warningIcon(h),
				title: "Disconnect from Discord",
				description: [
					"Are you sure you want to disconnect",
					connection.displayName,
					"? All channel links will be removed and messages will stop syncing. This action cannot be undone.",
				],
				confirmLabel: "Disconnect",
				pendingLabel: "Disconnecting...",
				isPending: model.isDisconnecting,
				onConfirm: Message.ClickedConfirmDisconnect(),
				toParentMessage: toDisconnectModalMessage,
			}),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	if (model.connection._tag === "Loading") return spinner(h, "size-6", "Loading connection...", "py-24")
	const connection = model.connection.connection
	if (connection === null)
		return h.div(
			[h.Class("flex flex-col gap-6")],
			[
				backLink(h),
				emptyState(h, {
					title: "Connection not found",
					description: "This sync connection may have been deleted.",
					action: button(h, { intent: "secondary", onPress: Message.ClickedBack() }, ["Go back"]),
				}),
			],
		)
	return detail(h, model, connection)
})
