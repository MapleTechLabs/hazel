import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import { badge } from "../../../ui/badge"
import { card, cardBody, cardHeader } from "../../../ui/card"
import { iconTile } from "../../../ui/icon-tile"
import { pageHeader } from "../../../ui/page-header"
import { statusDot } from "../../../ui/status-dot"
import type { Connection } from "../chat-sync/model"
import { PROVIDERS } from "../chat-sync/providers"
import { formatSyncedAt } from "../chat-sync/rpc"
import { Message } from "./model"
import { outlineIcon } from "./parts"
import { heading } from "../../../ui/heading"

/** The connection detail header and its Connection status card. */

const STATUS_CONFIG = {
	active: { label: "Active", intent: "success", tone: "success" },
	paused: { label: "Paused", intent: "warning", tone: "warning" },
	error: { label: "Error", intent: "danger", tone: "danger" },
	disabled: { label: "Disabled", intent: "muted", tone: "neutral" },
} as const

export const header = (h: HtmlBuilder<Message>, connection: Connection): Html => {
	const status = STATUS_CONFIG[connection.status]
	const provider = PROVIDERS[connection.provider]
	return pageHeader(h, {
		title: connection.displayName,
		subtitle: `${provider.workspaceIdLabel}: ${connection.externalWorkspaceId}`,
		size: "title",
		leading: h.div(
			[
				h.Class(
					`flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-md ring-1 ring-black/8 ${provider.tintClass}`,
				),
			],
			[provider.logo(h, "size-10")],
		),
		badges: [badge(h, { intent: status.intent }, [statusDot(h, { tone: status.tone }), status.label])],
	})
}

const disconnectButton = (h: HtmlBuilder<Message>, label: string): Html =>
	button(h, { intent: "danger", size: "sm", onPress: Message.ClickedDisconnect() }, [label])

export const connectionCard = (h: HtmlBuilder<Message>, connection: Connection): Html =>
	card(h, {}, [
		cardHeader(h, [heading(h, { variant: "subsection" }, ["Connection"])], "py-3"),
		cardBody(h, [
			connection.status === "error"
				? h.div(
						[h.Class("flex items-start gap-3")],
						[
							iconTile(
								h,
								{ intent: "danger", size: "md" },
								outlineIcon(h, {
									className: "",
									d: "M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z",
								}),
							),
							h.div(
								[h.Class("flex flex-1 flex-col gap-1")],
								[
									h.p([h.Class("font-medium text-fg text-sm")], ["Connection Error"]),
									h.p(
										[h.Class("text-muted-fg text-sm")],
										[
											connection.errorMessage ||
												"An unknown error occurred with this connection.",
										],
									),
								],
							),
							disconnectButton(h, "Remove"),
						],
					)
				: h.div(
						[h.Class("flex items-center justify-between gap-4")],
						[
							h.div(
								[h.Class("flex items-center gap-3")],
								[
									iconTile(
										h,
										{ intent: "success", size: "md" },
										outlineIcon(h, { className: "", d: "M5 13l4 4L19 7" }),
									),
									h.div(
										[h.Class("flex flex-col gap-0.5")],
										[
											h.p(
												[h.Class("font-medium text-fg text-sm")],
												[`Connected to ${PROVIDERS[connection.provider].name}`],
											),
											h.p(
												[h.Class("text-muted-fg text-xs")],
												[
													connection.lastSyncedAtMs === null
														? "Waiting for first sync"
														: `Last synced ${formatSyncedAt(connection.lastSyncedAtMs)}`,
												],
											),
										],
									),
								],
							),
							disconnectButton(h, "Disconnect"),
						],
					),
		]),
	])
