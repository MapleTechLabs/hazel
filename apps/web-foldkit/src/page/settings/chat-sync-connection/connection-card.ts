import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../../ui/section-header"
import { discordLogo } from "../chat-sync/brand-icons"
import type { Connection } from "../chat-sync/model"
import { formatSyncedAt } from "../chat-sync/rpc"
import { Message } from "./model"
import { outlineIcon } from "./parts"

/** The connection detail header and its Connection status card. */

const STATUS_CONFIG = {
	active: { label: "Active", badgeClass: "bg-success-subtle text-success-subtle-fg", dot: "bg-success" },
	paused: { label: "Paused", badgeClass: "bg-warning-subtle text-warning-subtle-fg", dot: "bg-warning" },
	error: { label: "Error", badgeClass: "bg-danger-subtle text-danger-subtle-fg", dot: "bg-danger" },
	disabled: { label: "Disabled", badgeClass: "bg-muted text-muted-fg", dot: "bg-muted-fg" },
} as const

export const header = (h: HtmlBuilder<Message>, connection: Connection): Html => {
	const status = STATUS_CONFIG[connection.status]
	return sectionHeaderRoot(h, { className: "border-none pb-0" }, [
		sectionHeaderGroup(h, {}, [
			h.div(
				[h.Class("flex items-center gap-4")],
				[
					h.div(
						[
							h.Class(
								"flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-md ring-1 ring-black/8",
							),
							// React writes `${DISCORD_BRAND_COLOR}10` as rgba.
							h.Attribute("style", "background-color: rgba(88, 101, 242, 0.063);"),
						],
						[discordLogo(h, "size-10")],
					),
					h.div(
						[h.Class("flex flex-col gap-1")],
						[
							h.div(
								[h.Class("flex items-center gap-3")],
								[
									sectionHeaderHeading(h, {}, [connection.displayName]),
									h.span(
										[
											h.Class(
												`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-0.5 font-medium text-xs ${status.badgeClass}`,
											),
										],
										[
											h.span([h.Class(`size-1.5 rounded-full ${status.dot}`)], []),
											status.label,
										],
									),
								],
							),
							sectionHeaderSubheading(h, {}, ["Guild ID: ", connection.externalWorkspaceId]),
						],
					),
				],
			),
		]),
	])
}

const cardHeader = (h: HtmlBuilder<Message>, title: string): Html =>
	h.div(
		[h.Class("border-border border-b bg-bg-muted/30 px-5 py-3")],
		[h.h3([h.Class("font-semibold text-fg text-sm")], [title])],
	)

const disconnectButton = (h: HtmlBuilder<Message>, label: string): Html =>
	button(h, { intent: "danger", size: "sm", onPress: Message.ClickedDisconnect() }, [label])

export const connectionCard = (h: HtmlBuilder<Message>, connection: Connection): Html =>
	h.div(
		[h.Class("overflow-hidden rounded-xl border border-border bg-bg")],
		[
			cardHeader(h, "Connection"),
			h.div(
				[h.Class("p-5")],
				[
					connection.status === "error"
						? h.div(
								[h.Class("flex items-start gap-3")],
								[
									h.div(
										[
											h.Class(
												"flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger-subtle",
											),
										],
										[
											outlineIcon(h, {
												className: "size-5 text-danger-subtle-fg",
												d: "M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z",
											}),
										],
									),
									h.div(
										[h.Class("flex flex-1 flex-col gap-1")],
										[
											h.p(
												[h.Class("font-medium text-fg text-sm")],
												["Connection Error"],
											),
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
											h.div(
												[
													h.Class(
														"flex size-10 items-center justify-center rounded-xl bg-success-subtle",
													),
												],
												[
													outlineIcon(h, {
														className: "size-5 text-success-subtle-fg",
														d: "M5 13l4 4L19 7",
													}),
												],
											),
											h.div(
												[h.Class("flex flex-col gap-0.5")],
												[
													h.p(
														[h.Class("font-medium text-fg text-sm")],
														["Connected to Discord"],
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
				],
			),
		],
	)
