import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerOverviewLayoutId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import * as OverviewData from "../../../../customers/overview/data"
import { LayoutRow, MetricDef, orderedLayouts } from "../../../../customers/overview/rows"
import { AccountRow, MemberRow, SignalRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"
import * as Popover from "../../../../ui/popover"
import { NoteRow } from "../../detail/model"

/**
 * Overview layouts (`docs/customers/overview-layouts.md`): the ordered list with the "New layout"
 * dialog, and the full-page editor (new or existing) drawing the draft with a previewed customer's
 * data. One page instance per org, so moving between the list and the editor keeps the live rows.
 */

// THE EDITOR

export const DryRun = AsyncData.Schema(Customers.LayoutDryRunResult, CommonReason)
export const PreviewDetail = AsyncData.Schema(Customers.AccountDetail, CommonReason)

export const Editor = Schema.Struct({
	/** Null: a new layout. */
	layoutId: Schema.NullOr(CustomerOverviewLayoutId),
	/** `?from=` of a new layout: a starter's key or a layout's id, copied once the layouts sync. */
	from: Schema.NullOr(Schema.String),
	/** `?name=` of a new layout. */
	newName: Schema.NullOr(Schema.String),
	/** What the editor opened with; changes count against it. Null until the layout synced. */
	saved: Schema.NullOr(Customers.LayoutDraft),
	draft: Schema.NullOr(Customers.LayoutDraft),
	/** "Move above …": the layout it will sit just before; null keeps its place (a new one: first). */
	before: Schema.NullOr(CustomerOverviewLayoutId),
	selectedId: Schema.NullOr(Schema.String),
	previewId: Schema.NullOr(CustomerAccountId),
	previewDetail: PreviewDetail.schema,
	previewNotes: Schema.Array(NoteRow),
	data: OverviewData.Model,
	/** A fresh one per rule edit (`Model.lastVersion`): a dry-run answer for another is dropped. */
	version: Schema.Int,
	dryRun: DryRun.schema,
	isSaving: Schema.Boolean,
	/** The draft a save sent: what is saved once it lands (the draft may have moved on meanwhile). */
	savingDraft: Schema.NullOr(Customers.LayoutDraft),
	pickerSearch: Schema.String,
	previewSearch: Schema.String,
	/** The metric condition whose metric list is open in the rule popover. */
	ruleMetricIndex: Schema.NullOr(Schema.Int),
})
export type Editor = typeof Editor.Type

// THE NEW LAYOUT DIALOG

/** `blank`, `copy` (of `copyOf`), or a starter's key. */
export const NewLayout = Schema.Struct({
	name: Schema.String,
	from: Schema.String,
	copyOf: Schema.NullOr(CustomerOverviewLayoutId),
})
export type NewLayout = typeof NewLayout.Type

// MODEL

export const Model = Schema.Struct({
	/** Live rows; null until each query answers. */
	layouts: Schema.NullOr(Schema.Array(LayoutRow)),
	metrics: Schema.NullOr(Schema.Array(MetricDef)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	signals: Schema.Array(SignalRow),
	members: Schema.Array(MemberRow),
	bands: Customers.HealthBands,
	currency: Schema.String,
	/** The order just asked for, shown until the rows catch up. */
	pendingOrder: Schema.NullOr(Schema.Array(CustomerOverviewLayoutId)),
	newModal: Modal.Model,
	newLayout: NewLayout,
	deleteModal: Modal.Model,
	deletingId: Schema.NullOr(CustomerOverviewLayoutId),
	/** Null: the list. */
	editor: Schema.NullOr(Editor),
	/** The last dry-run version handed out, across editors. */
	lastVersion: Schema.Int,
	rulePopover: Popover.Model,
	pickerPopover: Popover.Model,
	previewPopover: Popover.Model,
})
export type Model = typeof Model.Type

export const NEW_MODAL_ID = "layouts-new"
export const DELETE_MODAL_ID = "layouts-delete"
export const RULE_POPOVER_ID = "layout-rule"
export const PICKER_POPOVER_ID = "layout-metric-picker"
export const PREVIEW_POPOVER_ID = "layout-preview"
export const NEW_NAME_ID = "layouts-new-name"

/** The dry run waits this long after the last rule edit. */
export const DRY_RUN_DEBOUNCE_MS = 400

export const EMPTY_NEW_LAYOUT: NewLayout = { name: "", from: "blank", copyOf: null }

// WHAT IS SHOWN

/** The list's order: the one just asked for while it lands, else the synced one; the default last. */
export const listOrder = (model: Model): ReadonlyArray<LayoutRow> => {
	const ordered = orderedLayouts(model.layouts ?? [])
	const pending = model.pendingOrder
	if (pending === null) return ordered
	const byId = new Map(ordered.map((layout) => [layout.id, layout]))
	return [
		...pending.flatMap((id) => {
			const layout = byId.get(id)
			return layout === undefined ? [] : [layout]
		}),
		...ordered.filter((layout) => layout.isDefault),
	]
}

/** The non-default layouts in the order rules are tried. */
export const ruleOrder = (model: Model): ReadonlyArray<LayoutRow> =>
	listOrder(model).filter((layout) => !layout.isDefault)

export const layoutById = (model: Model, id: string | null): LayoutRow | undefined =>
	id === null ? undefined : model.layouts?.find((layout) => layout.id === id)

export const isDefaultEditor = (model: Model, editor: Editor): boolean =>
	layoutById(model, editor.layoutId)?.isDefault ?? false

/** The non-default order with the edited layout where the editor puts it (a new one: first). */
export const draftOrder = (model: Model, editor: Editor): ReadonlyArray<CustomerOverviewLayoutId | null> => {
	const others = ruleOrder(model)
		.map((layout) => layout.id)
		.filter((id) => id !== editor.layoutId)
	const at =
		editor.before !== null
			? Math.max(0, others.indexOf(editor.before))
			: editor.layoutId === null
				? 0
				: Math.max(
						0,
						ruleOrder(model).findIndex((layout) => layout.id === editor.layoutId),
					)
	return [...others.slice(0, at), editor.layoutId, ...others.slice(at)]
}

/**
 * The `position` that puts the draft where `draftOrder` says, between its neighbours' positions;
 * undefined keeps the store's own (an existing layout not moved, a new one first).
 */
export const draftPosition = (model: Model, editor: Editor): number | undefined => {
	if (editor.before === null) return undefined
	const order = draftOrder(model, editor)
	const at = order.indexOf(editor.layoutId)
	const positionOf = (id: CustomerOverviewLayoutId | null | undefined) =>
		id === null || id === undefined ? undefined : layoutById(model, id)?.position
	const next = positionOf(order[at + 1])
	const previous = positionOf(order[at - 1])
	if (next === undefined) return previous === undefined ? undefined : previous + 1
	return previous === undefined ? next - 1 : (previous + next) / 2
}

/** A draft the store takes: a name, valid conditions, every chart and picked table with a metric. */
const isLayoutDraft = Schema.is(Customers.LayoutDraft)
export const isValidDraft = (draft: Customers.LayoutDraft): boolean =>
	draft.name.trim() !== "" && isLayoutDraft(draft)

export const isDirty = (editor: Editor): boolean =>
	editor.draft !== null &&
	(editor.saved === null ||
		editor.before !== null ||
		JSON.stringify(editor.draft) !== JSON.stringify(editor.saved))

export const selectedWidget = (editor: Editor): Customers.OverviewWidget | undefined =>
	editor.draft?.widgets.find((widget) => widget.id === editor.selectedId)

export const previewAccount = (model: Model, editor: Editor): AccountRow | undefined =>
	model.accounts?.find((account) => account.id === editor.previewId)

/** The plan names and tags the org's accounts carry: what plan and tag conditions offer. */
export const planNames = (model: Model): ReadonlyArray<string> =>
	[
		...new Set(
			(model.accounts ?? []).flatMap((account) =>
				account.planName === null ? [] : [account.planName],
			),
		),
	].sort()

export const tagNames = (model: Model): ReadonlyArray<string> =>
	[...new Set((model.accounts ?? []).flatMap((account) => account.tags))].sort()
