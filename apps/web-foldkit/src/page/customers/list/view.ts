import { CustomerAccountId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Submodel } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatCount, formatDeltaPct, formatMoney, formatRelative } from "../../../customers/format"
import { accountLabelOf, nestedIdsOf } from "../../../customers/groups"
import type { AccountRow, SignalRow } from "../../../customers/queries"
import { environmentBadge, healthBadge, severityGlyph } from "../../../customers/ui/badges"
import { connectCard } from "../../../customers/ui/connect-card"
import { dataTable } from "../../../customers/ui/data-table"
import {
	addFilterButton,
	filterBar,
	filterChip,
	searchBox,
	sortTrigger,
	viewTabs,
} from "../../../customers/ui/filter-bar"
import { companyLogo, menuAvatar, personLabel } from "../../../customers/ui/identity"
import { kbd } from "../../../customers/ui/shortcuts"
import { dragGhost, sortableList, sortableRow } from "../../../customers/ui/sortable"
import { lookPicker, viewGlyph } from "../../../customers/ui/view-look"
import { isInSidebar, layoutOf } from "../../../customers/view-layout"
import * as Customers from "@hazel/domain/customers"
import { DragAndDrop } from "@foldkit/ui"
import { freshness, pageHeader } from "../../../customers/ui/surface"
import {
	IconClose,
	IconDots,
	IconDownload,
	IconMagnifier3,
	IconOffice,
	IconPlus,
	IconUser,
} from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { button, buttonClassName } from "../../../ui/button"
import { checkbox } from "../../../ui/checkbox"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import { emptyState } from "../../../ui/empty-state"
import { input } from "../../../ui/input"
import * as Menu from "../../../ui/menu"
import { menuLabel, view as menuView } from "../../../ui/menu-view"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"
import type { PageViewInputs } from "../../contract"
import { LetModifierClicksThrough, PositionHoverCard, ScrollListRowIntoView } from "./commands"
import { chipOf, columnPicker, filterBuilder } from "./controls"
import { Message } from "./message"
import {
	accountsPerOwner,
	activeFields,
	bestFilterToRemove,
	canDeleteView,
	canUpdateView,
	COLUMN_NAME,
	ALL_VIEW_KEY,
	currentTab,
	effectiveFilters,
	HOVER_CARD_ID,
	isEdited,
	layoutKeyOf,
	type Model,
	orderedTabsOf,
	OWNER_ME,
	OWNER_NONE,
	ownerEntries,
	parseSortKey,
	ROW_PAGE,
	SEARCH_ID,
	TAB_LIST_ID,
	shownColumns,
	sortEntries,
	sortLabel,
	userIdOfOwnerKey,
	viewMenuEntries,
	type Viewer,
	viewTabCounts,
	visibleAccounts,
} from "./model"
import { shortName, type TableContext, tableColumns } from "./table"
import { viewerOf } from "./update"

/** The customers list (Wonder: List — all, at risk, filter builder, columns, bulk, hover, no results, first run). */

const TABLE_ID = "customers-list-table"
const icon = { attributes: { "data-slot": "icon" } }
const PROVIDERS = ["clerk", "stripe", "autumn", "maple"] as const

const nameAnchorId = (accountId: string) => `customers-list-name-${accountId}`

// MENUS AND POPOVERS

const menu = (
	h: HtmlBuilder<Message>,
	model: Menu.Model,
	options: Readonly<{
		entries: ReadonlyArray<Menu.Entry>
		trigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
		content: (key: string) => ReadonlyArray<Html | string>
		toMessage: (message: Menu.Message) => Message
		className?: string
	}>,
): Html =>
	h.submodel({
		slotId: model.id,
		model,
		view: menuView,
		viewInputs: {
			entries: options.entries,
			toTrigger: options.trigger,
			content: options.content,
			className: options.className,
		},
		toParentMessage: options.toMessage,
	})

const popover = (
	h: HtmlBuilder<Message>,
	model: Popover.Model,
	options: Readonly<{
		trigger: (attributes: ReadonlyArray<ChildAttribute>) => Html
		content: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>
		toMessage: (message: Popover.Message) => Message
		placement?: "bottom start" | "bottom end" | "top"
		className?: string
	}>,
): Html =>
	h.submodel({
		slotId: model.id,
		model,
		view: Popover.view,
		viewInputs: {
			toTrigger: options.trigger,
			toContent: options.content,
			placement: options.placement ?? "bottom start",
			className: twMerge("max-w-none p-0", options.className),
		},
		toParentMessage: options.toMessage,
	})

// HEADER

const header = (
	h: HtmlBuilder<Message>,
	model: Model,
	viewer: Viewer,
	rows: ReadonlyArray<AccountRow>,
): Html => {
	const tab = currentTab(model)
	const mrr = rows.reduce((sum, account) => sum + account.mrrMinor, 0)
	const subtitle =
		model.accounts === null
			? "Loading…"
			: tab.key === ALL_VIEW_KEY
				? "Every account from Clerk, Stripe, Autumn and Maple, in one list."
				: `${formatCount(rows.length)} account${rows.length === 1 ? "" : "s"} in ${tab.name}, worth ${formatMoney(mrr, model.reportingCurrency)} MRR.`
	return pageHeader(h, {
		title: "Customers",
		subtitle,
		actions: [
			...(model.lastComputedAtMs === null
				? []
				: [
						h.span(
							[h.Class("mr-1 inline-flex items-center max-md:hidden")],
							[
								freshness(
									h,
									`Synced ${formatRelative(new Date(model.lastComputedAtMs), new Date(viewer.nowMs))}`,
								),
							],
						),
					]),
			button(h, { intent: "outline", size: "sm", onPress: Message.PressedExport({ scope: "all" }) }, [
				IconDownload(h, icon),
				"Export CSV",
			]),
		],
	})
}

const VIEW_MENU_LABEL = {
	save: "Save changes to this view",
	save_as: "Save as a new view…",
	edit: "Edit name and icon…",
	reset: "Discard changes",
	restore_default: "Reset to default",
	delete: "Delete view",
} as const

const viewMenuLabel = (model: Model, key: string): string =>
	key === "sidebar"
		? isInSidebar(layoutOf(model.layout), layoutKeyOf(currentTab(model)))
			? "Hide from sidebar"
			: "Show in sidebar"
		: (VIEW_MENU_LABEL[key as keyof typeof VIEW_MENU_LABEL] ?? key)

/** The view tabs, in my order: drag one (or Alt+←/→) to move it; the sidebar follows. */
const tabsRow = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): Html => {
	const counts = viewTabCounts(model, viewer)
	const tabs = orderedTabsOf(model)
	const current = currentTab(model)
	const edited = isEdited(model)
	const draggedKey = Option.getOrNull(DragAndDrop.maybeDraggedItemId(model.tabDrag))
	const dragged = tabs.find((tab) => layoutKeyOf(tab) === draggedKey)
	return viewTabs(h, {
		ariaLabel: "Saved views",
		tabs: tabs.map((tab) => ({
			key: layoutKeyOf(tab),
			label: tab.name,
			count: model.accounts === null ? undefined : counts.get(tab.key),
			leading: viewGlyph(h, tab.look, "size-3.5"),
		})),
		selected: layoutKeyOf(current),
		onSelect: (key) =>
			Message.ClickedViewTab({ key: tabs.find((tab) => layoutKeyOf(tab) === key)?.key ?? null }),
		className: "overflow-x-auto",
		listAttributes: [sortableList(h, TAB_LIST_ID)],
		tabProps: (tab, index) =>
			sortableRow(h, {
				drag: model.tabDrag,
				containerId: TAB_LIST_ID,
				itemId: tab.key,
				index,
				count: tabs.length,
				orientation: "Horizontal",
				toDragMessage: (message) => Message.GotTabDragMessage({ message }),
				onStep: (step) => Message.SteppedViewTab({ key: tab.key, step }),
			}),
		trailing: h.div(
			[h.Class("flex shrink-0 items-center gap-1")],
			[
				...(edited
					? [
							button(
								h,
								{
									intent: "plain",
									size: "xs",
									className: "text-primary",
									onPress: Message.PressedSaveView(),
								},
								[IconPlus(h, icon), "Save view"],
							),
						]
					: []),
				dragged === undefined
					? h.empty
					: dragGhost(h, model.tabDrag, [
							viewGlyph(h, dragged.look, "size-3.5"),
							h.span([], [dragged.name]),
						]),
				menu(h, model.viewMenu, {
					entries: viewMenuEntries(model, viewer),
					trigger: (attributes, overlay) =>
						button(
							h,
							{
								intent: "plain",
								size: "xs",
								className: "size-7 p-0",
								attributes: [...attributes, h.AriaLabel("View actions")],
							},
							[IconDots(h, icon), overlay],
						),
					content: (key) => [menuLabel(h, model.viewMenu.id, key, viewMenuLabel(model, key))],
					toMessage: (message) => Message.GotViewMenuMessage({ message }),
					className: "min-w-56",
				}),
			],
		),
	})
}

// CONTROLS

const controls = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer, count: number): Html => {
	const currency = model.reportingCurrency
	return filterBar(h, {
		start: [
			searchBox(h, {
				id: SEARCH_ID,
				value: model.search,
				placeholder: "Search name or domain…",
				onInput: (value) => Message.ChangedSearch({ value }),
				onClear: Message.ClearedSearch(),
			}),
			...activeFields(model.draft.filters).flatMap((field) => {
				const chip = chipOf(field, model.draft.filters, model.members, currency)
				return chip === null
					? []
					: [
							filterChip(h, {
								...chip,
								attributes: [h.OnClick(Message.PressedEditFilter({ field }))],
								onRemove: Message.ClearedFilter({ field }),
							}),
						]
			}),
			popover(h, model.filterPopover, {
				trigger: (attributes) => addFilterButton(h, { attributes }),
				content: (closeAttributes) =>
					model.builder === null
						? []
						: filterBuilder(h, {
								builder: model.builder,
								accounts: model.accounts ?? [],
								members: model.members,
								search: model.search,
								currency,
								viewer,
								closeAttributes,
							}),
				toMessage: (message) => Message.GotFilterPopoverMessage({ message }),
			}),
		],
		end: [
			h.span(
				[h.Class("text-muted-fg text-sm tabular-nums max-lg:hidden")],
				[`${formatCount(count)} ${count === 1 ? "customer" : "customers"}`],
			),
			menu(h, model.sortMenu, {
				entries: sortEntries,
				trigger: (attributes, overlay) =>
					sortTrigger(h, { label: sortLabel(model.draft.sort), attributes, overlay }),
				content: (key) => {
					const sort = parseSortKey(key)
					return [menuLabel(h, model.sortMenu.id, key, sort === null ? key : sortLabel(sort))]
				},
				toMessage: (message) => Message.GotSortMenuMessage({ message }),
				className: "max-h-96 min-w-56",
			}),
			popover(h, model.columnsPopover, {
				trigger: (attributes) =>
					button(h, { intent: "outline", size: "sm", attributes }, ["Columns"]),
				content: () => columnPicker(h, model.draft.columns),
				toMessage: (message) => Message.GotColumnsPopoverMessage({ message }),
				placement: "bottom end",
			}),
		],
	})
}

// HOVER CARD

const hoverCard = (h: HtmlBuilder<Message>, model: Model, account: AccountRow, viewer: Viewer): Html => {
	const signals = (model.signals ?? []).filter(
		(signal: SignalRow) => signal.accountId === account.id && signal.status === "open",
	)
	const top = signals[0]
	const owner =
		account.ownerUserId === null
			? null
			: (model.members.find((member) => member.id === account.ownerUserId) ?? null)
	const stat = (label: string, value: Html | string) =>
		h.div(
			[h.Class("flex min-w-0 flex-col gap-0.5 px-3 py-2.5 first:pl-4")],
			[
				h.span([h.Class("text-muted-fg text-xs")], [label]),
				h.span([h.Class("font-semibold text-fg")], [value]),
			],
		)
	return h.keyed("div")(
		`hover-${account.id}`,
		[
			h.Id(HOVER_CARD_ID),
			h.Role("tooltip"),
			h.Class(
				"pointer-events-none invisible fixed z-50 flex w-84 flex-col overflow-hidden rounded-xl border border-border bg-overlay text-sm shadow-lg",
			),
			h.OnMount(PositionHoverCard({ anchorId: nameAnchorId(account.id) })),
		],
		[
			h.div(
				[h.Class("flex items-start gap-3 p-4")],
				[
					companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "md" }),
					h.div(
						[h.Class("flex min-w-0 flex-1 flex-col")],
						[
							h.span(
								[h.Class("flex min-w-0 items-center gap-2")],
								[
									h.span(
										[h.Class("truncate font-semibold text-base text-fg")],
										[account.name],
									),
									...(account.environment === null
										? []
										: [environmentBadge(h, account.environment)]),
								],
							),
							h.span(
								[h.Class("truncate text-muted-fg text-xs")],
								[
									[
										account.domain,
										account.planName,
										account.seatsLimit === null ? null : `${account.seatsLimit} seats`,
									]
										.filter((part) => part !== null)
										.join(" · "),
								],
							),
						],
					),
					healthBadge(h, { status: account.healthStatus, score: account.healthScore }),
				],
			),
			h.div(
				[h.Class("grid grid-cols-3 divide-x divide-border border-border border-y")],
				[
					stat("MRR", formatMoney(account.mrrMinor, account.currency)),
					stat(
						"Active 30d",
						h.span(
							[],
							[
								String(account.activeUsers30d),
								...(account.activeUsersTrendPct === null
									? []
									: [
											h.span(
												[
													h.Class(
														twMerge(
															"ml-1 font-normal text-xs",
															account.activeUsersTrendPct < 0
																? "text-danger-subtle-fg"
																: "text-success-subtle-fg",
														),
													),
												],
												[formatDeltaPct(Math.round(account.activeUsersTrendPct))],
											),
										]),
							],
						),
					),
					stat(
						"Last active",
						account.lastActiveAtMs === null
							? "Never"
							: formatRelative(new Date(account.lastActiveAtMs), new Date(viewer.nowMs)),
					),
				],
			),
			...(top === undefined
				? []
				: [
						h.div(
							[h.Class("flex flex-col gap-1.5 px-4 py-3")],
							[
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[`Top signal · ${signals.length} open`],
								),
								h.div(
									[h.Class("flex items-center gap-2")],
									[
										severityGlyph(h, top.severity),
										h.span([h.Class("font-medium text-fg")], [top.title]),
									],
								),
								h.p([h.Class("line-clamp-2 text-muted-fg text-xs")], [top.reason]),
							],
						),
					]),
			h.div(
				[
					h.Class(
						"flex items-center justify-between gap-2 border-border border-t bg-wash px-4 py-2.5",
					),
				],
				[
					personLabel(h, owner),
					h.span(
						[h.Class("inline-flex items-center gap-2 text-muted-fg text-xs")],
						["Open customer", kbd(h, "Enter")],
					),
				],
			),
		],
	)
}

// BULK BAR

const bulkBar = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer, total: number): Html =>
	h.div(
		[
			h.Role("toolbar"),
			h.AriaLabel("Bulk actions"),
			// A phone: the screen's width, wrapping, above the tab bar.
			h.Class(
				"fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-overlay p-1.5 text-sm shadow-lg " +
					"max-md:inset-x-2 max-md:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] max-md:translate-none max-md:flex-wrap max-md:justify-center",
			),
		],
		[
			h.span(
				[
					h.Class(
						"whitespace-nowrap rounded-md bg-primary-subtle px-2 py-1 font-medium text-primary-subtle-fg tabular-nums",
					),
				],
				[`${formatCount(model.selected.length)} selected`],
			),
			...(model.selected.length < total
				? [
						button(h, { intent: "plain", size: "xs", onPress: Message.PressedSelectAll() }, [
							`Select all ${formatCount(total)}`,
						]),
					]
				: []),
			h.span([h.Class("mx-1 h-5 w-px bg-border max-md:hidden")]),
			menu(h, model.ownerMenu, {
				entries: ownerEntries(model.members, viewer),
				trigger: (attributes, overlay) =>
					button(h, { intent: "plain", size: "xs", attributes }, [
						IconUser(h, icon),
						"Assign owner",
						overlay,
					]),
				content: (key) => {
					const member = model.members.find((entry) => entry.id === userIdOfOwnerKey(key))
					const person =
						key === OWNER_ME
							? (model.members.find((entry) => entry.id === viewer.userId) ?? { name: "Me" })
							: (member ?? null)
					const count =
						accountsPerOwner(model.accounts).get(
							key === OWNER_ME ? viewer.userId : (member?.id ?? null),
						) ?? 0
					return [
						menuAvatar(h, key === OWNER_NONE ? null : person),
						menuLabel(
							h,
							model.ownerMenu.id,
							key,
							[
								key === OWNER_NONE ? "Remove owner" : (person?.name ?? key),
								...(key === OWNER_NONE
									? []
									: [
											h.span(
												[h.Class("text-muted-fg text-xs tabular-nums")],
												[key === OWNER_ME ? `You · ${count}` : String(count)],
											),
										]),
							],
							"flex items-center justify-between gap-4",
						),
					]
				},
				toMessage: (message) => Message.GotOwnerMenuMessage({ message }),
				className: "min-w-64",
			}),
			popover(h, model.tagPopover, {
				trigger: (attributes) =>
					button(h, { intent: "plain", size: "xs", attributes }, [IconPlus(h, icon), "Add tag"]),
				content: () => [
					h.form(
						[
							h.Class("flex w-64 flex-col gap-2 p-3"),
							h.OnSubmit(Message.SubmittedTag({ tag: model.tagInput })),
						],
						[
							input(h, {
								placeholder: "Tag name",
								attributes: [
									h.AriaLabel("Tag name"),
									h.Value(model.tagInput),
									h.OnInput((value) => Message.ChangedTagInput({ value })),
								],
							}),
							h.div(
								[h.Class("flex flex-wrap gap-1")],
								[...new Set((model.accounts ?? []).flatMap((account) => account.tags))]
									.sort()
									.slice(0, 12)
									.map((tag) =>
										h.button(
											[
												h.Type("button"),
												h.OnClick(Message.SubmittedTag({ tag })),
												h.Class(
													"cursor-pointer rounded bg-secondary px-1.5 py-0.5 text-secondary-fg text-xs hover:bg-secondary/70",
												),
											],
											[tag],
										),
									),
							),
							button(
								h,
								{
									size: "sm",
									isDisabled: model.tagInput.trim() === "",
									attributes: [h.Type("submit")],
								},
								[`Tag ${formatCount(model.selected.length)} customers`],
							),
						],
					),
				],
				toMessage: (message) => Message.GotTagPopoverMessage({ message }),
				placement: "top",
			}),
			button(
				h,
				{ intent: "plain", size: "xs", onPress: Message.PressedExport({ scope: "selected" }) },
				["Export CSV"],
			),
			h.button(
				[
					h.Type("button"),
					h.AriaLabel("Clear selection"),
					h.OnClick(Message.ClearedSelection()),
					// A phone: first, beside the count, so the wrapped bar takes two rows, not three.
					h.Class(
						"inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-fg hover:bg-secondary hover:text-fg max-md:order-first max-md:size-9",
					),
				],
				[IconClose(h, { className: "size-3.5" })],
			),
		],
	)

// SAVE DIALOG

const saveDialog = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): Html =>
	Modal.controlledModal(h, {
		model: model.saveModal,
		toParentMessage: (message) => Message.GotSaveModalMessage({ message }),
		size: "sm",
		toContent: (closeAttributes) => {
			const form = model.saveForm
			if (form === null) return []
			const isEdit = form.mode === "edit"
			return [
				dialogHeader(h, {
					title: {
						id: Modal.titleId(model.saveModal.id),
						text: isEdit ? "Edit view" : "Save view",
					},
					description: isEdit
						? undefined
						: "Keeps these filters, the sort and the columns as a tab and in the sidebar.",
				}),
				dialogBody(h, [
					h.form(
						[
							h.Id("customers-save-view"),
							h.Class("flex flex-col gap-3"),
							h.OnSubmit(Message.SubmittedSave()),
						],
						[
							input(h, {
								placeholder: "View name",
								attributes: [
									h.AriaLabel("View name"),
									h.Value(form.name),
									h.Attribute("maxlength", "80"),
									h.OnInput((value) => Message.ChangedSaveName({ value })),
								],
							}),
							lookPicker(h, {
								look: { icon: form.icon, color: form.color },
								icons: Customers.ViewIcon.literals,
								colors: Customers.ViewColor.literals,
								onPick: (look) => Message.PickedSaveLook(look),
							}),
							...(isEdit || !viewer.isAdmin
								? []
								: [
										checkbox(
											h,
											{
												id: "customers-save-view-shared",
												isSelected: form.isShared,
												onChange: (isShared) =>
													Message.ToggledSaveShared({ isShared }),
											},
											"Share with everyone in the workspace",
										),
									]),
						],
					),
				]),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(
						h,
						{
							isDisabled: form.name.trim() === "",
							attributes: [h.Type("submit"), h.Attribute("form", "customers-save-view")],
						},
						[isEdit ? "Save" : "Save view"],
					),
				]),
			]
		},
	})

// DELETE DIALOG

const deleteDialog = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.deleteModal,
		toParentMessage: (message) => Message.GotDeleteModalMessage({ message }),
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => {
			const tab = currentTab(model)
			return [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.deleteModal.id), text: `Delete ${tab.name}?` },
					description:
						tab.row?.ownerUserId === null
							? "It goes for everyone in the workspace. This can't be undone."
							: "This can't be undone.",
				}),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(h, { intent: "danger", onPress: Message.PressedConfirmDeleteView() }, [
						"Delete view",
					]),
				]),
			]
		},
	})

// BODY

const firstRun = (h: HtmlBuilder<Message>, orgSlug: string, nowMs: number): Html =>
	h.div(
		[h.Class("flex flex-col gap-8")],
		[
			pageHeader(h, {
				title: "Customers",
				subtitle: "Your customer accounts, built from the tools you already use.",
				actions: [
					h.a(
						[
							h.Href(hrefOf(AppRoute.CustomersSettingsSources({ orgSlug }))),
							h.Class(buttonClassName({ intent: "outline", size: "sm" })),
						],
						["Data sources settings"],
					),
				],
			}),
			emptyState(h, {
				title: "No customers yet",
				icon: (className) => IconOffice(h, { className }),
				description:
					"Connect Clerk first: each organization becomes a customer account and its users become contacts. Stripe, Autumn and Maple then add revenue, limits and usage to the same accounts.",
			}),
			h.div(
				[h.Class("mx-auto grid w-full max-w-3xl gap-4 md:grid-cols-2")],
				PROVIDERS.map((provider) =>
					connectCard(h, {
						provider,
						now: new Date(nowMs),
						status: { _tag: "NotConnected", onConnect: Message.PressedConnect({ provider }) },
						className: provider === "clerk" ? "border-primary" : undefined,
					}),
				),
			),
			h.p(
				[
					h.Class(
						"mx-auto w-full max-w-3xl rounded-xl border border-border border-dashed px-4 py-3 text-muted-fg text-sm",
					),
				],
				[
					h.span([h.Class("mr-2 font-medium text-fg")], ["How sources merge"]),
					"Records join an account by shared ID first (Stripe metadata.clerk_org_id, Autumn customer ID, Maple GroupId), then by domain. Anything left over waits in Data sources for you to link by hand.",
				],
			),
		],
	)

const noResults = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): Html => {
	const best = bestFilterToRemove(model, viewer)
	const chip =
		best === null ? null : chipOf(best.field, model.draft.filters, model.members, model.reportingCurrency)
	const label = chip === null ? null : `${chip.field} ${chip.operator} ${chip.value}`.replace(/\s+/g, " ")
	return emptyState(h, {
		title: "No customers match",
		icon: (className) => IconMagnifier3(h, { className }),
		description:
			model.search.trim() === ""
				? "No account matches every filter. Remove one to widen the list."
				: `Nothing matches “${model.search.trim()}” with these filters. Try a domain instead of a name.`,
		action: h.div(
			[h.Class("flex flex-wrap items-center justify-center gap-2")],
			[
				...(best === null || label === null
					? []
					: [
							button(
								h,
								{
									intent: "outline",
									size: "sm",
									onPress: Message.ClearedFilter({ field: best.field }),
								},
								[
									`Remove “${label}”`,
									h.span(
										[h.Class("text-muted-fg tabular-nums")],
										[formatCount(best.count)],
									),
								],
							),
						]),
				button(h, { intent: "plain", size: "sm", onPress: Message.ClearedFilters() }, [
					"Clear filters",
				]),
			],
		),
	})
}

const table = (
	h: HtmlBuilder<Message>,
	model: Model,
	viewer: Viewer,
	rows: ReadonlyArray<AccountRow>,
	orgSlug: string,
): Html => {
	const context: TableContext = {
		orgSlug,
		currency: model.reportingCurrency,
		nowMs: viewer.nowMs,
		membersById: new Map(model.members.map((member) => [member.id, member])),
		sparklines: model.sparklines,
		nestedIds: nestedIdsOf(rows),
		nameCell: (account, cell) =>
			h.div(
				[
					h.Id(nameAnchorId(account.id)),
					h.Class("min-w-0 max-w-72"),
					h.OnMouseEnter(Message.HoveredRow({ accountId: account.id })),
					h.OnMouseLeave(Message.UnhoveredRow()),
				],
				[cell],
			),
	}
	const columns = tableColumns(h, shownColumns(model.draft.columns), rows, context)
	const isLoading = model.accounts === null
	return h.div(
		[h.Id(TABLE_ID), h.OnMount(LetModifierClicksThrough())],
		[
			dataTable(h, {
				ariaLabel: "Customers",
				id: "customers-list",
				columns,
				rows: rows.slice(0, model.rowLimit),
				rowKey: (account) => account.id,
				sort: { key: model.draft.sort.column, direction: model.draft.sort.direction },
				onSort: (column) => Message.ClickedSortHeader({ column }),
				selection: {
					selected: new Set(model.selected),
					onToggle: (key, isSelected) =>
						Message.ToggledRow({
							accountId: Schema.decodeSync(CustomerAccountId)(key),
							isSelected,
						}),
					onToggleAll: (isSelected) => Message.ToggledAllRows({ isSelected }),
					rowLabel: (account) => accountLabelOf(account),
				},
				onRowPress: (account) => Message.ClickedRow({ accountId: account.id }),
				focusedKey: model.focusedId,
				stickyHeader: true,
				// The frame is the container its columns drop by (`COLUMN_LAYOUT`).
				className: "@container rounded-none border-x-0",
				loadingRows: isLoading ? 12 : undefined,
			}),
			...(rows.length > model.rowLimit
				? [
						h.div(
							[h.Class("flex items-center justify-center gap-3 py-4 text-muted-fg text-sm")],
							[
								`Showing ${formatCount(model.rowLimit)} of ${formatCount(rows.length)}`,
								button(
									h,
									{ intent: "outline", size: "sm", onPress: Message.PressedShowMoreRows() },
									[
										`Show ${formatCount(Math.min(ROW_PAGE, rows.length - model.rowLimit))} more`,
									],
								),
							],
						),
					]
				: []),
			...(model.focusedId === null
				? []
				: [
						h.keyed("span")(`scroll-${model.focusedId}`, [
							h.Class("hidden"),
							h.OnMount(ScrollListRowIntoView({ tableId: TABLE_ID })),
						]),
					]),
		],
	)
}

// PAGE

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const viewer = viewerOf(shared)
	const orgSlug = shared.orgSlug ?? ""
	const isFirstRun =
		model.accounts !== null &&
		model.accounts.length === 0 &&
		model.connectedProviders !== null &&
		model.connectedProviders.length === 0
	if (isFirstRun)
		return h.div(
			[h.Class("h-full overflow-y-auto")],
			[
				h.div(
					[h.Class("mx-auto w-full max-w-7xl px-4 py-6 lg:px-8")],
					[firstRun(h, orgSlug, shared.nowMs)],
				),
			],
		)
	const rows = visibleAccounts(model, viewer)
	const hovered =
		model.hoveredId === null ? undefined : rows.find((account) => account.id === model.hoveredId)
	const hasNoResults = model.accounts !== null && rows.length === 0
	return h.div(
		[h.Class("relative h-full overflow-y-auto")],
		[
			h.div(
				[h.Class("flex flex-col gap-4 px-4 pt-6 lg:px-8")],
				[
					header(h, model, viewer, rows),
					tabsRow(h, model, viewer),
					controls(h, model, viewer, rows.length),
				],
			),
			h.div(
				[h.Class("mt-3 pb-24")],
				[
					hasNoResults
						? h.div([], [table(h, model, viewer, [], orgSlug), noResults(h, model, viewer)])
						: table(h, model, viewer, rows, orgSlug),
				],
			),
			...(model.selected.length > 0 ? [bulkBar(h, model, viewer, rows.length)] : []),
			// A tap fires mouseenter too; a phone has no hover to preview with.
			...(hovered === undefined || shared.isMobile ? [] : [hoverCard(h, model, hovered, viewer)]),
			saveDialog(h, model, viewer),
			deleteDialog(h, model),
		],
	)
})
