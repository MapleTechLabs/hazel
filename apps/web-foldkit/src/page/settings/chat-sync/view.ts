import { Submodel } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { buttonStyles } from "~/components/ui/button.styles"
import { IconArrowPath, IconChevronDown, IconPlus, IconTrash, IconWarning } from "../../../icons"
import { badge } from "../../../ui/badge"
import { emptyState } from "../../../ui/empty-state"
import { loader } from "../../../ui/loader"
import type * as Menu from "../../../ui/menu"
import { menuTriggerClassName, view as menuView } from "../../../ui/menu-view"
import type * as Modal from "../../../ui/modal"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../../ui/section-header"
import type { PageViewInputs } from "../../contract"
import { discordLogo, slackLogo } from "./brand-icons"
import { addConnectionModal } from "./add-connection-view"
import { confirmDialog } from "./confirm-dialog"
import { formatSyncedAt } from "./rpc"
import { type Connection, Message, type Model, STATUS_CONFIG } from "./model"

/** Port of `settings/chat-sync/index.tsx`. */

const toAddMenuMessage = (message: Menu.Message) => Message.GotAddMenuMessage({ message })
const toEmptyAddMenuMessage = (message: Menu.Message) => Message.GotEmptyAddMenuMessage({ message })
const toDeleteModalMessage = (message: Modal.Message) => Message.GotDeleteModalMessage({ message })

const header = (h: HtmlBuilder<Message>, actions: ReadonlyArray<Html>): Html =>
	sectionHeaderRoot(h, { className: "border-none pb-0" }, [
		sectionHeaderGroup(h, {}, [
			h.div(
				[h.Class("flex flex-1 flex-col justify-center gap-1")],
				[
					sectionHeaderHeading(h, {}, ["Chat Sync"]),
					sectionHeaderSubheading(h, {}, ["Sync messages between Hazel and external platforms."]),
				],
			),
			...actions,
		]),
	])

const addMenuContent =
	(h: HtmlBuilder<Message>) =>
	(key: string): ReadonlyArray<Html | string> =>
		key === "discord"
			? [discordLogo(h, "size-5 shrink-0"), "Discord"]
			: [
					slackLogo(h, "size-5 shrink-0"),
					h.span(
						[h.Class("flex items-center gap-2")],
						["Slack", badge(h, { intent: "secondary", size: "sm" }, ["Coming Soon"])],
					),
				]

/** `AddConnectionDropdown`: a MenuTrigger styled as a primary button. */
const addConnectionDropdown = (
	h: HtmlBuilder<Message>,
	slotId: string,
	menu: Menu.Model,
	toParentMessage: (message: Menu.Message) => Message,
): Html =>
	h.submodel({
		slotId,
		model: menu,
		view: menuView,
		viewInputs: {
			toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
				h.button(
					[
						...attributes,
						h.Class(menuTriggerClassName(buttonStyles({ intent: "primary", size: "md" }))),
						h.Attribute("data-rac", ""),
						h.Attribute("data-react-aria-pressable", "true"),
						h.Attribute("data-slot", "menu-trigger"),
						h.Attribute("tabindex", "0"),
						h.Attribute("type", "button"),
					],
					[
						IconPlus(h, { className: "size-4" }),
						"Add Third Party Connection",
						IconChevronDown(h, { className: "size-3.5 opacity-70" }),
						overlay,
					],
				),
			content: addMenuContent(h),
			className: "min-w-56",
			itemClassName: () => "gap-3",
		},
		toParentMessage,
	})

const connectionCard = (h: HtmlBuilder<Message>, connection: Connection): Html => {
	const statusConfig = STATUS_CONFIG[connection.status]
	return h.keyed("div")(
		connection.id,
		[
			h.Class(
				"group relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg transition-all duration-200 hover:border-border-hover hover:shadow-md",
			),
		],
		[
			h.button(
				[
					h.Class("flex flex-1 flex-col gap-4 p-5 text-left"),
					h.Type("button"),
					h.OnClick(Message.ClickedConnection({ connectionId: connection.id })),
				],
				[
					h.div(
						[h.Class("flex items-start justify-between gap-3")],
						[
							h.div(
								[h.Class("flex items-center gap-3")],
								[
									h.div(
										[
											h.Class(
												"flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/8",
											),
										],
										[discordLogo(h, "size-8")],
									),
									h.div(
										[h.Class("flex flex-col gap-0.5")],
										[
											h.h3(
												[h.Class("font-semibold text-fg text-sm")],
												[connection.displayName],
											),
											h.div(
												[h.Class("flex items-center gap-1.5")],
												[
													h.div(
														[
															h.Class(
																`size-1.5 rounded-full ${statusConfig.dotClass}`,
															),
														],
														[],
													),
													h.span(
														[h.Class(`text-xs ${statusConfig.textClass}`)],
														[statusConfig.label],
													),
												],
											),
										],
									),
								],
							),
						],
					),
					h.div(
						[h.Class("flex flex-col gap-1 text-muted-fg text-xs")],
						[
							h.span([], ["Guild ID: ", connection.externalWorkspaceId]),
							...(connection.lastSyncedAtMs === null
								? []
								: [
										h.span(
											[],
											["Last synced:", " ", formatSyncedAt(connection.lastSyncedAtMs)],
										),
									]),
						],
					),
				],
			),
			h.div(
				[
					h.Class(
						"flex items-center justify-between border-border border-t bg-bg-muted/50 px-5 py-3",
					),
				],
				[
					h.span(
						[
							h.Class(
								"font-medium text-fg text-xs opacity-0 transition-opacity group-hover:opacity-100",
							),
						],
						["Manage"],
					),
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.button(
								[
									h.Class(
										"rounded-sm p-1 text-muted-fg opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100",
									),
									h.Title("Delete connection"),
									h.Type("button"),
									h.OnClick(
										Message.ClickedDeleteConnection({
											target: { id: connection.id, name: connection.displayName },
										}),
									),
								],
								[IconTrash(h, { className: "size-4" })],
							),
							h.svg(
								[
									h.Class(
										"size-4 text-muted-fg transition-transform group-hover:translate-x-0.5",
									),
									h.Attribute("fill", "none"),
									h.Attribute("stroke", "currentColor"),
									h.Attribute("stroke-width", "2"),
									h.Attribute("viewBox", "0 0 24 24"),
								],
								[
									h.path([
										h.Attribute("d", "M9 5l7 7-7 7"),
										h.Attribute("stroke-linecap", "round"),
										h.Attribute("stroke-linejoin", "round"),
									]),
								],
							),
						],
					),
				],
			),
		],
	)
}

const deleteModal = (h: HtmlBuilder<Message>, model: Model): Html =>
	confirmDialog(h, {
		slotId: "delete-connection",
		modal: model.deleteModal,
		icon: IconWarning(h, { className: "size-6 text-danger" }),
		title: "Delete Connection",
		description: [
			"Are you sure you want to delete the connection to",
			model.deleteTarget?.name ?? "",
			"? This will also remove all linked channels. This action cannot be undone.",
		],
		confirmLabel: "Delete Connection",
		pendingLabel: "Deleting...",
		isPending: model.isDeleting,
		onConfirm: Message.ClickedConfirmDelete(),
		toParentMessage: toDeleteModalMessage,
	})

/** Legacy returns a fragment into the column layout; `display: contents` keeps its children flex items. */
const fragment = (h: HtmlBuilder<Message>, children: ReadonlyArray<Html>): Html =>
	h.div([h.Attribute("style", "display: contents;")], [...children])

const loadingState = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex items-center justify-center py-16")],
		[
			h.div(
				[h.Class("flex items-center gap-3 text-muted-fg")],
				[
					loader(h, { className: "size-6" }),
					h.span([h.Class("text-sm")], ["Loading connections..."]),
				],
			),
		],
	)

const loadedBody = (h: HtmlBuilder<Message>, model: Model, connections: ReadonlyArray<Connection>): Html =>
	connections.length === 0
		? emptyState(h, {
				icon: (className) => IconArrowPath(h, { className }),
				title: "No sync connections yet",
				description: "Connect an external platform to start syncing messages with Hazel channels.",
				action: addConnectionDropdown(
					h,
					"add-connection-empty",
					model.emptyAddMenu,
					toEmptyAddMenuMessage,
				),
			})
		: h.div(
				[h.Class("grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3")],
				connections.map((connection) => connectionCard(h, connection)),
			)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const connections = model.connections
	if (connections._tag === "Loading") return fragment(h, [header(h, []), loadingState(h)])
	if (connections._tag === "Failed")
		return fragment(h, [
			header(h, []),
			emptyState(h, {
				title: "Failed to load connections",
				description: "Something went wrong loading your sync connections. Please try refreshing.",
			}),
		])
	return fragment(h, [
		header(h, [addConnectionDropdown(h, "add-connection", model.addMenu, toAddMenuMessage)]),
		loadedBody(h, model, connections.connections),
		addConnectionModal(h, model),
		deleteModal(h, model),
	])
})
