import type * as Customers from "@hazel/domain/customers"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Option } from "effect"
import { twMerge } from "tailwind-merge"
import type { BuiltInContext } from "../../../../customers/overview/built-ins"
import type * as OverviewData from "../../../../customers/overview/data"
import { BLOCKS } from "../../../../customers/overview/starters"
import { type WidgetContext, widgetGrid } from "../../../../customers/overview/widgets"
import { breadcrumb } from "../../../../customers/ui/surface"
import { segmented } from "../../../../customers/ui/filter-bar"
import { IconArrowDown, IconArrowUp } from "../../../../customers/ui/icons"
import {
	IconChevronDown,
	IconChevronRight,
	IconCopy,
	IconDashboard,
	IconDots,
	IconEye,
	IconPlus,
	IconTrash,
} from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { ariaButton, button } from "../../../../ui/button"
import { input } from "../../../../ui/input"
import * as Popover from "../../../../ui/popover"
import type { Shared } from "../../../contract"
import { isCustomersAdmin } from "../shared"
import { Message } from "./message"
import {
	type Editor,
	isDefaultEditor,
	isDirty,
	isValidDraft,
	matchSummary,
	type Model,
	previewAccount,
	selectedWidget,
} from "./model"
import { panel, SPAN_LABEL, spanOf, TYPE_LABEL, widgetTitle } from "./panel-view"
import { ruleChipsView, rulePopover } from "./rule-view"

/** The layout editor (Wonder `yez`, `bbw`, `gau`, `was`): top bar, who gets it, the canvas, the panel. */

type H = HtmlBuilder<Message>

const icon = { attributes: { "data-slot": "icon" } }

// TOP BAR

const NAME_ERROR_ID = "layout-name-error"

const topBar = (h: H, model: Model, editor: Editor, draft: Customers.LayoutDraft, shared: Shared): Html => {
	const isAdmin = isCustomersAdmin(shared)
	const dirty = isDirty(editor)
	const valid = isValidDraft(draft)
	const isNameMissing = draft.name.trim() === ""
	const status =
		editor.layoutId === null ? "Not saved yet" : dirty ? "Unsaved changes" : "All changes saved"
	return h.div(
		[h.Class("flex h-14 shrink-0 items-center justify-between gap-4 border-border border-b px-6")],
		[
			h.div(
				[h.Class("flex min-w-0 items-center gap-2")],
				[
					breadcrumb(h, [
						{
							label: "Overview layouts",
							href: hrefOf(
								AppRoute.CustomersSettingsLayouts({ orgSlug: shared.orgSlug ?? "" }),
							),
						},
					]),
					IconChevronRight(h, { className: "size-3 shrink-0 text-muted-fg" }),
					h.div(
						[h.Class("w-56")],
						[
							input(h, {
								isDisabled: !isAdmin,
								isInvalid: isNameMissing,
								attributes: [
									h.AriaLabel("Layout name"),
									h.Value(draft.name),
									h.Attribute("maxlength", "80"),
									h.OnInput((value) => Message.ChangedName({ value })),
									...(isNameMissing ? [h.AriaDescribedBy(NAME_ERROR_ID)] : []),
								],
							}),
						],
					),
					...(isNameMissing
						? [
								h.span(
									[
										h.Id(NAME_ERROR_ID),
										h.Class("whitespace-nowrap text-danger-subtle-fg text-xs"),
									],
									["Name the layout to save it"],
								),
							]
						: []),
					...(editor.layoutId === null
						? [
								h.span(
									[
										h.Class(
											"rounded-md bg-secondary px-1.5 py-0.5 font-medium text-muted-fg text-xs",
										),
									],
									["Draft"],
								),
							]
						: []),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					h.span([h.Class("text-muted-fg text-xs max-md:hidden")], [status]),
					button(h, { intent: "plain", size: "sm", onPress: Message.PressedDiscard() }, [
						editor.layoutId === null || dirty ? "Discard" : "Close",
					]),
					...(isAdmin
						? [
								button(
									h,
									{
										size: "sm",
										onPress: Message.PressedSave(),
										isDisabled: !dirty || !valid,
										isPending: editor.isSaving,
									},
									["Save layout"],
								),
							]
						: []),
				],
			),
		],
	)
}

// META BAR

const previewPicker = (h: H, model: Model, editor: Editor): Html => {
	const account = previewAccount(model, editor)
	const query = editor.previewSearch.trim().toLowerCase()
	const matching = new Set(
		Option.getOrUndefined(AsyncData.getData(editor.dryRun))?.matching.map((entry) => entry.accountId) ??
			[],
	)
	const candidates = [...(model.accounts ?? [])]
		.filter((each) => query === "" || each.name.toLowerCase().includes(query))
		.sort((left, right) => Number(matching.has(right.id)) - Number(matching.has(left.id)))
		.slice(0, 50)
	return h.submodel({
		slotId: model.previewPopover.id,
		model: model.previewPopover,
		view: Popover.view,
		viewInputs: {
			placement: "bottom end",
			toTrigger: (attributes) =>
				button(h, { intent: "outline", size: "sm", attributes }, [
					IconEye(h, icon),
					h.span([h.Class("text-muted-fg")], ["Preview with"]),
					account?.name ?? "a customer",
					IconChevronDown(h, { className: "size-3" }),
				]),
			toContent: () => [
				h.div(
					[h.Class("flex w-72 flex-col gap-1 p-2")],
					[
						input(h, {
							placeholder: "Search customers",
							attributes: [
								h.AriaLabel("Search customers"),
								h.Value(editor.previewSearch),
								h.OnInput((value) => Message.ChangedPreviewSearch({ value })),
							],
						}),
						h.div(
							[h.Class("flex max-h-72 flex-col gap-0.5 overflow-y-auto py-1")],
							candidates.length === 0
								? [
										h.p(
											[h.Class("px-2 py-3 text-muted-fg text-sm")],
											["No customer matches."],
										),
									]
								: candidates.map((each) =>
										ariaButton(
											h,
											{
												onPress: Message.PickedPreview({ accountId: each.id }),
												className: twMerge(
													"flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-fg text-sm outline-hidden hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70",
													each.id === editor.previewId && "bg-secondary",
												),
												attributes: [h.Key(each.id)],
											},
											[
												h.span([h.Class("truncate")], [each.name]),
												...(matching.has(each.id)
													? [
															h.span(
																[h.Class("shrink-0 text-muted-fg text-xs")],
																["matches"],
															),
														]
													: []),
											],
										),
									),
						),
					],
				),
			],
		},
		toParentMessage: (message: Popover.Message) => Message.GotPreviewPopoverMessage({ message }),
	})
}

const metaBar = (
	h: H,
	model: Model,
	editor: Editor,
	draft: Customers.LayoutDraft,
	isAdmin: boolean,
): Html => {
	const result = Option.getOrUndefined(AsyncData.getData(editor.dryRun))
	const isDefault = isDefaultEditor(model, editor)
	return h.div(
		[
			h.Class(
				"flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-border border-b px-4 py-1.5",
			),
		],
		[
			h.div(
				[h.Class("flex min-w-0 flex-wrap items-center gap-2")],
				isDefault
					? [
							h.span(
								[h.Class("px-2 text-muted-fg text-sm")],
								["Fallback: every customer no other layout takes."],
							),
						]
					: !isAdmin
						? [ruleChipsView(h, model, draft)]
						: [
								rulePopover(h, model, editor, draft),
								h.span(
									[h.Class("text-muted-fg text-sm tabular-nums")],
									[
										result === undefined
											? AsyncData.isFailure(editor.dryRun)
												? "Couldn't check matches"
												: "Checking…"
											: matchSummary(result),
									],
								),
							],
			),
			previewPicker(h, model, editor),
		],
	)
}

// CANVAS

const toolbar = (h: H, widget: Customers.OverviewWidget, index: number, count: number): Html => {
	const tool = (label: string, glyph: Html, onPress: Message, isDisabled = false) =>
		button(
			h,
			{
				intent: "plain",
				size: "xs",
				onPress,
				isDisabled,
				attributes: [h.AriaLabel(label), h.Title(label)],
				className: "px-1",
			},
			[glyph],
		)
	return h.div(
		[
			h.Role("toolbar"),
			h.AriaLabel("Widget"),
			h.Class(
				"absolute -top-4 left-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-bg py-0.5 pr-0.5 pl-2 shadow-md",
			),
		],
		[
			h.span(
				[h.Class("whitespace-nowrap font-medium text-fg text-xs")],
				[`${TYPE_LABEL[widget._tag]} · ${SPAN_LABEL[widget.span]}`],
			),
			tool(
				"Move earlier",
				IconArrowUp(h, { className: "size-3.5" }),
				Message.PressedMoveWidget({ step: -1 }),
				index === 0,
			),
			tool(
				"Move later",
				IconArrowDown(h, { className: "size-3.5" }),
				Message.PressedMoveWidget({ step: 1 }),
				index === count - 1,
			),
			segmented(h, {
				ariaLabel: "Width",
				segments: ([1, 2, 3, 4] as const).map((span) => ({
					key: String(span),
					label: span === 4 ? "Full" : SPAN_LABEL[span],
				})),
				selected: String(widget.span),
				onSelect: (span) =>
					Message.EditedWidget({
						widget: { ...widget, span: spanOf(span) },
					}),
				className: "p-0 [&>*]:h-6 [&>*]:px-1.5",
			}),
			tool("Duplicate", IconCopy(h, { className: "size-3.5" }), Message.PressedDuplicateWidget()),
			tool("Remove", IconTrash(h, { className: "size-3.5" }), Message.PressedRemoveWidget()),
		],
	)
}

const toOverviewData = (message: OverviewData.Message) => Message.GotOverviewDataMessage({ message })

const emptyCanvas = (h: H, accountName: string, isAdmin: boolean): Html =>
	h.div(
		[
			h.Class(
				"flex min-h-96 flex-col items-center justify-center gap-3 rounded-xl border border-border border-dashed px-6 py-16 text-center",
			),
		],
		[
			h.span(
				[
					h.AriaHidden(true),
					h.Class(
						"inline-flex size-10 items-center justify-center rounded-lg bg-secondary text-fg-2",
					),
				],
				[IconDashboard(h, { className: "size-5" })],
			),
			h.span([h.Class("font-semibold text-base text-fg")], ["No widgets yet"]),
			h.p(
				[h.Class("max-w-sm text-muted-fg text-sm")],
				[
					isAdmin
						? `Add a widget from the panel, or start with a block. Each widget shows ${accountName}'s real data as you build.`
						: "An admin can add widgets to this layout.",
				],
			),
			...(isAdmin
				? [
						h.div(
							[h.Class("flex flex-wrap justify-center gap-2")],
							BLOCKS.slice(0, 2).map((block) =>
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										onPress: Message.PressedAddBlock({ key: block.key }),
									},
									[IconPlus(h, icon), block.name],
								),
							),
						),
					]
				: []),
		],
	)

const canvas = (
	h: H,
	model: Model,
	editor: Editor,
	draft: Customers.LayoutDraft,
	shared: Shared,
	isAdmin: boolean,
): Html => {
	const account = previewAccount(model, editor)
	const content = (() => {
		if (account === undefined)
			return h.p(
				[h.Class("py-16 text-center text-muted-fg text-sm")],
				[
					model.accounts?.length === 0
						? "Add a customer to preview this layout."
						: "Loading the preview…",
				],
			)
		if (draft.widgets.length === 0) return emptyCanvas(h, account.name, isAdmin)
		const builtIn: BuiltInContext = {
			orgSlug: shared.orgSlug ?? "",
			nowMs: shared.nowMs,
			account,
			detail: Option.getOrNull(AsyncData.getData(editor.previewDetail)),
			bands: model.bands,
			signals: model.signals.filter(
				(signal) =>
					signal.accountId === (account.primaryAccountId ?? account.id) &&
					(signal.status === "open" || signal.status === "snoozed"),
			),
			primary: null,
			pinnedNotes: editor.previewNotes.filter((note) => note.pinned),
			membersById: new Map(model.members.map((member) => [member.id, member])),
			tabLink: (_tab, label) => h.span([h.Class("text-muted-fg text-sm")], [label]),
		}
		const context: WidgetContext<Message> = {
			data: editor.data,
			metrics: model.metrics,
			currency: account.currency,
			toMessage: toOverviewData,
			builtIn,
			showHidden: true,
		}
		const count = draft.widgets.length
		if (!isAdmin) return widgetGrid(h, draft.widgets, context)
		// The toolbar and the handle sit beside the clickable widget, not in it: their presses never select.
		return widgetGrid(h, draft.widgets, context, (widget, index, drawn) => {
			const isSelected = widget.id === editor.selectedId
			const title = widgetTitle(model, widget)
			return h.div(
				[
					h.Class(
						twMerge(
							"group/widget relative h-full rounded-xl ring-offset-4 ring-offset-bg transition-shadow",
							isSelected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-border-hover",
						),
					),
				],
				[
					...(isSelected ? [toolbar(h, widget, index, count)] : []),
					ariaButton(
						h,
						{
							onPress: Message.ClickedWidget({ widgetId: widget.id }),
							className:
								"absolute top-2 right-2 z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-border bg-bg text-muted-fg opacity-0 outline-hidden transition-opacity group-hover/widget:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/70",
							attributes: [
								h.AriaLabel(`Select ${title} widget`),
								h.AriaPressed(isSelected ? "true" : "false"),
							],
						},
						[IconDots(h, { className: "size-3.5" })],
					),
					h.div(
						[
							h.Class("h-full cursor-pointer"),
							h.OnClick(Message.ClickedWidget({ widgetId: widget.id })),
						],
						[drawn],
					),
				],
			)
		})
	})()
	return h.div(
		[h.Class("min-w-0 flex-1 px-6 py-8 lg:overflow-y-auto")],
		[h.div([h.Class("mx-auto max-w-5xl")], [content])],
	)
}

// PAGE

export const editorView = (h: H, model: Model, editor: Editor, shared: Shared): Html => {
	const draft = editor.draft
	if (draft === null)
		return h.div(
			[h.Class("flex h-full items-center justify-center text-muted-fg text-sm")],
			[model.layouts === null ? "Loading layout…" : "This layout no longer exists."],
		)
	const isAdmin = isCustomersAdmin(shared)
	return h.div(
		[h.Class("flex h-full min-h-0 flex-col")],
		[
			topBar(h, model, editor, draft, shared),
			metaBar(h, model, editor, draft, isAdmin),
			// Under lg the panel stacks under the canvas and both scroll together.
			h.div(
				[h.Class("flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto")],
				[
					canvas(h, model, editor, draft, shared, isAdmin),
					...(isAdmin
						? [panel(h, model, editor, shared.orgSlug ?? "", selectedWidget(editor))]
						: []),
				],
			),
		],
	)
}
