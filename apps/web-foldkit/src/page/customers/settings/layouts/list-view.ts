import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatCount, formatDate } from "../../../../customers/format"
import type { LayoutRow } from "../../../../customers/overview/rows"
import { ruleChips } from "../../../../customers/overview/rules"
import { STARTERS, starterMetricCount } from "../../../../customers/overview/starters"
import { IconArrowDown, IconArrowUp } from "../../../../customers/ui/icons"
import {
	IconCheck,
	IconCopy,
	IconCube,
	IconDashboard,
	IconLightbulb,
	IconPlus,
	IconRocket,
	IconServers,
	IconTrash,
} from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { ariaButton, button } from "../../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import * as Modal from "../../../../ui/modal"
import { textField } from "../../../../ui/text-field"
import type { Shared } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { Message } from "./message"
import { layoutById, listOrder, type Model, NEW_NAME_ID } from "./model"
import { chipClass } from "./panel-view"

/** The layouts list (Wonder `rom`): the order rules are tried in, who each gets, the default last. */

type H = HtmlBuilder<Message>

const icon = { attributes: { "data-slot": "icon" } }

// THUMBNAIL

const THUMB_SPAN = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4" } as const

const THUMB_LOOK = {
	stat: "h-1.5 bg-muted-fg/40",
	chart: "h-4 bg-primary/70",
	metric_table: "h-4 border-muted-fg/40 border-t-2 bg-muted-fg/15",
	built_in: "h-2.5 bg-muted-fg/20",
} as const satisfies Record<Customers.OverviewWidget["_tag"], string>

/** The widget grid in miniature. */
export const layoutThumbnail = (
	h: H,
	widgets: ReadonlyArray<Customers.OverviewWidget>,
	className?: string,
): Html =>
	h.div(
		[
			h.AriaHidden(true),
			h.Class(
				twMerge(
					"grid h-16 w-20 shrink-0 grid-cols-4 content-start gap-0.5 overflow-hidden rounded-md border border-border bg-secondary/40 p-1.5",
					className,
				),
			),
		],
		widgets
			.slice(0, 12)
			.map((widget) =>
				h.span([
					h.Key(widget.id),
					h.Class(twMerge("rounded-xs", THUMB_SPAN[widget.span], THUMB_LOOK[widget._tag])),
				]),
			),
	)

// ROWS

const chip = (h: H, text: string): Html =>
	h.span(
		[h.Class("whitespace-nowrap rounded-md border border-border px-1.5 py-0.5 text-fg text-xs")],
		[text],
	)

const COLUMNS =
	"grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-x-4 px-4 @3xl:grid-cols-[2rem_auto_minmax(0,1fr)_6rem_8rem_10rem_2rem]"

const layoutRow = (
	h: H,
	model: Model,
	layout: LayoutRow,
	index: number,
	count: number,
	shared: Shared,
): Html => {
	const isAdmin = isCustomersAdmin(shared)
	const orgSlug = shared.orgSlug ?? ""
	const chips = layout.isDefault
		? ["Every other customer"]
		: ruleChips(layout.rule, model.metrics ?? [], model.currency)
	const editor = model.members.find((member) => member.id === layout.updatedBy)?.name ?? "Hazel"
	const move = (step: -1 | 1, label: string, glyph: Html, isDisabled: boolean) =>
		button(
			h,
			{
				intent: "plain",
				size: "xs",
				// One reorder at a time: answers landing out of order cannot scramble the list.
				isDisabled: isDisabled || !isAdmin || model.pendingOrder !== null,
				onPress: Message.PressedMoveLayout({ layoutId: layout.id, step }),
				attributes: [h.AriaLabel(`${label}: ${layout.name}`)],
				className: "px-1",
			},
			[glyph],
		)
	return h.li(
		[
			h.Key(layout.id),
			h.Class(twMerge(COLUMNS, "relative min-h-20 py-3 transition-colors hover:bg-secondary/40")),
		],
		[
			layout.isDefault
				? h.span([])
				: h.span(
						[h.Class("relative z-10 flex flex-col items-center")],
						[
							move(-1, "Move up", IconArrowUp(h, { className: "size-3.5" }), index === 0),
							move(
								1,
								"Move down",
								IconArrowDown(h, { className: "size-3.5" }),
								index === count - 1,
							),
						],
					),
			layoutThumbnail(h, layout.widgets),
			h.div(
				[h.Class("flex min-w-0 flex-col gap-1.5")],
				[
					h.span(
						[h.Class("flex items-center gap-2")],
						[
							h.a(
								[
									h.Href(
										hrefOf(
											AppRoute.CustomersSettingsLayout({
												orgSlug,
												layoutId: layout.id,
												preview: Option.none(),
											}),
										),
									),
									h.Class(
										"truncate font-medium text-fg text-sm outline-hidden after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/70",
									),
								],
								[layout.name],
							),
							...(layout.isDefault
								? [
										h.span(
											[
												h.Class(
													"rounded-md bg-secondary px-1.5 py-0.5 text-muted-fg text-xs",
												),
											],
											["Fallback"],
										),
									]
								: []),
						],
					),
					h.span(
						[h.Class("flex flex-wrap items-center gap-1.5 text-muted-fg text-xs")],
						[
							"Applies when",
							...(chips.length === 0
								? [chip(h, "Every customer")]
								: chips.map((text) => chip(h, text))),
						],
					),
				],
			),
			h.span(
				[h.Class("hidden text-right text-muted-fg text-sm tabular-nums @3xl:block")],
				[`${layout.widgets.length} ${layout.widgets.length === 1 ? "widget" : "widgets"}`],
			),
			h.span(
				[h.Class("whitespace-nowrap text-right font-medium text-fg text-sm tabular-nums")],
				[
					`${formatCount(layout.accountCount)} ${layout.accountCount === 1 ? "customer" : "customers"}`,
				],
			),
			h.span(
				[h.Class("hidden truncate text-right text-muted-fg text-xs @3xl:block")],
				[`${editor} · ${formatDate(new Date(layout.updatedAtMs), { now: new Date(shared.nowMs) })}`],
			),
			layout.isDefault || !isAdmin
				? h.span([h.Class("hidden @3xl:block")])
				: h.span(
						[h.Class("relative z-10 hidden @3xl:block")],
						[
							button(
								h,
								{
									intent: "plain",
									size: "xs",
									onPress: Message.PressedDeleteLayout({ layoutId: layout.id }),
									attributes: [h.AriaLabel(`Delete ${layout.name}`)],
									className: "px-1.5",
								},
								[IconTrash(h, icon)],
							),
						],
					),
		],
	)
}

// THE NEW LAYOUT DIALOG

const STARTER_ICON = new Map([
	["observability", IconServers],
	["trial_onboarding", IconRocket],
	["feature_adoption", IconLightbulb],
	["seats_revenue", IconCube],
])

const startCard = (
	h: H,
	options: Readonly<{
		isSelected: boolean
		onPress: Message
		glyph: Html
		title: string
		description: string
		meta: string
		extra?: Html
	}>,
): Html =>
	h.div(
		[
			h.Class(
				twMerge(
					"relative flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-secondary/40",
					options.isSelected && "border-primary bg-primary-subtle/30 hover:bg-primary-subtle/30",
				),
			),
		],
		[
			ariaButton(
				h,
				{
					onPress: options.onPress,
					className:
						"flex cursor-pointer flex-col gap-3 text-left outline-hidden after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/70",
					attributes: [h.Role("radio"), h.AriaChecked(options.isSelected)],
				},
				[
					h.span(
						[h.Class("flex items-start gap-3")],
						[
							h.span(
								[
									h.AriaHidden(true),
									h.Class(
										"inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-fg-2",
									),
								],
								[options.glyph],
							),
							h.span(
								[h.Class("flex min-w-0 flex-1 flex-col gap-0.5 pr-6")],
								[
									h.span([h.Class("font-semibold text-fg text-sm")], [options.title]),
									h.span([h.Class("text-muted-fg text-sm")], [options.description]),
								],
							),
						],
					),
					h.span([h.Class("text-muted-fg text-xs")], [options.meta]),
				],
			),
			...(options.extra === undefined ? [] : [h.div([h.Class("relative z-10")], [options.extra])]),
			...(options.isSelected
				? [
						h.span(
							[
								h.AriaHidden(true),
								h.Class(
									"absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-fg",
								),
							],
							[IconCheck(h, { className: "size-3" })],
						),
					]
				: []),
		],
	)

const newLayoutModal = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.newModal,
		toParentMessage: (message) => Message.GotNewModalMessage({ message }),
		size: "3xl",
		toContent: (closeAttributes) => {
			const { newLayout } = model
			const others = listOrder(model)
			const copied = layoutById(model, newLayout.copyOf)
			const widgets = (count: number) => `${count} ${count === 1 ? "widget" : "widgets"}`
			return [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.newModal.id), text: "New layout" },
					description:
						"Name it and pick a starting point. You choose which customers get it and arrange widgets in the editor, with a live preview.",
				}),
				dialogBody(h, [
					h.div(
						[h.Class("flex flex-col gap-5")],
						[
							textField(
								h,
								{
									id: NEW_NAME_ID,
									value: newLayout.name,
									onInput: (value) => Message.ChangedNewName({ value }),
								},
								(parts) => [
									parts.label(["Name"]),
									parts.input({
										placeholder: "Enterprise expansion",
										attributes: [h.Attribute("autocomplete", "off")],
									}),
								],
							),
							h.div(
								[h.Class("flex flex-col gap-2")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], ["Start from"]),
									h.div(
										[
											h.Role("radiogroup"),
											h.AriaLabel("Start from"),
											h.Class("grid gap-3 sm:grid-cols-2"),
										],
										[
											startCard(h, {
												isSelected: newLayout.from === "blank",
												onPress: Message.ClickedNewFrom({ from: "blank" }),
												glyph: IconPlus(h, { className: "size-4" }),
												title: "Blank",
												description: "No widgets. Add them one at a time.",
												meta: widgets(0),
											}),
											...(others.length === 0
												? []
												: [
														startCard(h, {
															isSelected: newLayout.from === "copy",
															onPress: Message.ClickedNewFrom({ from: "copy" }),
															glyph: IconCopy(h, { className: "size-4" }),
															title: "Copy of a layout",
															description:
																"Its widgets and rule, under a new name.",
															meta:
																copied === undefined
																	? "Pick a layout"
																	: widgets(copied.widgets.length),
															extra:
																newLayout.from === "copy"
																	? h.div(
																			[
																				h.Class(
																					"flex flex-wrap gap-1.5",
																				),
																			],
																			others.map((layout) =>
																				button(
																					h,
																					{
																						intent: "outline",
																						className: chipClass(
																							layout.id ===
																								newLayout.copyOf,
																						),
																						size: "xs",
																						onPress:
																							Message.ClickedCopyOf(
																								{
																									layoutId:
																										layout.id,
																								},
																							),
																						attributes: [
																							h.AriaPressed(
																								layout.id ===
																									newLayout.copyOf
																									? "true"
																									: "false",
																							),
																						],
																					},
																					[layout.name],
																				),
																			),
																		)
																	: undefined,
														}),
													]),
											...STARTERS.map((starter) => {
												const count = starterMetricCount(starter)
												return startCard(h, {
													isSelected: newLayout.from === starter.key,
													onPress: Message.ClickedNewFrom({ from: starter.key }),
													glyph: (STARTER_ICON.get(starter.key) ?? IconDashboard)(
														h,
														{ className: "size-4" },
													),
													title: starter.name,
													description: starter.description,
													meta: `${widgets(starter.widgets.length)} · ${count === 0 ? "built-in metrics" : `uses ${count} ${count === 1 ? "metric" : "metrics"}`}`,
												})
											}),
										],
									),
								],
							),
						],
					),
				]),
				dialogFooter(h, [
					h.p(
						[h.Class("mr-auto max-w-sm text-muted-fg text-xs")],
						[
							"A starter needs its metrics. Missing ones show in the editor, with a link to create them.",
						],
					),
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(
						h,
						{
							onPress: Message.PressedCreateAndEdit(),
							isDisabled:
								newLayout.name.trim() === "" ||
								(newLayout.from === "copy" && copied === undefined),
						},
						["Create and edit"],
					),
				]),
			]
		},
	})

const deleteModal = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.deleteModal,
		toParentMessage: (message) => Message.GotDeleteModalMessage({ message }),
		size: "md",
		toContent: (closeAttributes) => {
			const layout = layoutById(model, model.deletingId)
			return [
				dialogHeader(h, {
					title: {
						id: Modal.titleId(model.deleteModal.id),
						text: `Delete ${layout?.name ?? "layout"}?`,
					},
					description: `Its ${formatCount(layout?.accountCount ?? 0)} customers get the next layout that matches them; pinned ones go back to their rules.`,
				}),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(h, { intent: "danger", onPress: Message.PressedConfirmDelete() }, [
						"Delete layout",
					]),
				]),
			]
		},
	})

// PAGE

export const listView = (h: H, model: Model, shared: Shared): Html => {
	const isAdmin = isCustomersAdmin(shared)
	const layouts = listOrder(model)
	const others = layouts.filter((layout) => !layout.isDefault)
	const accounts = model.accounts ?? []
	const pinned = accounts.filter((account) => account.pinnedLayoutId !== null).length
	return h.div(
		[h.Class("h-full")],
		[
			settingsPage(h, [
				settingsHeader(h, {
					title: "Overview layouts",
					subtitle:
						"What a customer's Overview tab shows. The first layout whose rule matches is used; Default covers everyone else.",
					actions: isAdmin
						? [
								button(h, { onPress: Message.PressedNewLayout() }, [
									IconPlus(h, icon),
									"New layout",
								]),
							]
						: [],
				}),
				...(isAdmin ? [] : [readOnlyNotice(h, "Overview layouts")]),
				model.layouts === null
					? h.div(
							[
								h.Class(
									"rounded-xl border border-border bg-bg px-5 py-10 text-center text-muted-fg text-sm",
								),
							],
							["Loading layouts…"],
						)
					: h.div(
							[h.Class("@container overflow-hidden rounded-xl border border-border bg-bg")],
							[
								h.ul(
									[
										h.AriaLabel("Layouts, in the order rules are tried"),
										h.Class("divide-y divide-border"),
									],
									layouts.map((layout, index) =>
										layoutRow(h, model, layout, index, others.length, shared),
									),
								),
								h.p(
									[h.Class("border-border border-t px-4 py-3 text-muted-fg text-xs")],
									[
										`A customer can be pinned to another layout from its Overview tab. ${formatCount(accounts.length)} customers, ${formatCount(pinned)} pinned.`,
									],
								),
							],
						),
			]),
			newLayoutModal(h, model),
			deleteModal(h, model),
		],
	)
}
