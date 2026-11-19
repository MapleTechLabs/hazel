import * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerOverviewLayoutId } from "@hazel/schema"
import { Match, Option, Result } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { failureMessage } from "~/lib/error-messages"
import * as OverviewData from "../../../../customers/overview/data"
import { groupKeysOf } from "../../../../customers/overview/rows"
import {
	BLOCKS,
	freshId,
	newBuiltIn,
	newWidget,
	starterOf,
	withFreshIds,
} from "../../../../customers/overview/starters"
import { errorToastOf, successToast } from "../../../../data/actions"
import type { ToastRequest } from "../../../../overlay/toasts"
import { AppRoute, type RouteOf } from "../../../../route"
import * as Modal from "../../../../ui/modal"
import * as Popover from "../../../../ui/popover"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../../out-message"
import {
	CreateOverviewLayout,
	DeleteOverviewLayout,
	FetchLayoutDryRun,
	FetchLayoutPreviewDetail,
	ReorderOverviewLayouts,
	UpdateOverviewLayout,
	WaitForLayoutDryRunDelay,
} from "./commands"
import { type LayoutWriteFailure, Message } from "./message"
import {
	DELETE_MODAL_ID,
	draftOrder,
	draftPosition,
	EMPTY_NEW_LAYOUT,
	type Editor,
	isDefaultEditor,
	isDirty,
	isValidDraft,
	layoutById,
	type Model,
	NEW_MODAL_ID,
	PICKER_POPOVER_ID,
	PREVIEW_POPOVER_ID,
	RULE_POPOVER_ID,
	ruleOrder,
	selectedWidget,
} from "./model"

export type LayoutsRoute = RouteOf<
	"CustomersSettingsLayouts" | "CustomersSettingsLayoutNew" | "CustomersSettingsLayout"
>

type Return = PageReturn<Model, Message>
type Commands = NonNullable<Return["commands"]>

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

const toList = (shared: Shared, request?: ToastRequest) =>
	requestedOrgNavigation(
		shared.orgSlug,
		(orgSlug) => AppRoute.CustomersSettingsLayouts({ orgSlug }),
		request === undefined ? {} : { toast: request },
	)

/** Runs `step` on a Return's Model and keeps both steps' Commands. */
const then = (first: Return, step: (model: Model) => Return): Return => {
	const second = step(first.model)
	return {
		...second,
		commands: [...(first.commands ?? []), ...(second.commands ?? [])],
		outMessage: second.outMessage ?? first.outMessage,
	}
}

const withEditor = (model: Model, change: (editor: Editor) => Editor): Model =>
	model.editor === null ? model : { ...model, editor: change(model.editor) }

// ROUTES

const editorOf = (
	version: number,
	fields: Pick<Editor, "layoutId" | "from" | "newName" | "saved" | "draft" | "previewId">,
): Editor => ({
	...fields,
	before: null,
	selectedId: null,
	previewDetail: AsyncData.Idle(),
	previewNotes: [],
	data: OverviewData.init(),
	version,
	dryRun: AsyncData.Idle(),
	isSaving: false,
	pickerSearch: "",
	previewSearch: "",
	ruleMetricIndex: null,
})

/** A new layout from a starter or blank at once; a copy of a layout once the layouts synced. */
const newDraft = (from: string | null, name: string | null): Customers.LayoutDraft | null => {
	const starter = from === null ? undefined : starterOf(from)
	if (from !== null && from !== "blank" && starter === undefined) return null
	return {
		name: name ?? starter?.name ?? "New layout",
		rule: Customers.EMPTY_LAYOUT_RULE,
		widgets: starter?.widgets ?? [],
	}
}

const withPopoversClosed = (model: Model): Model => ({
	...model,
	newModal: Modal.close(model.newModal).model,
	deleteModal: Modal.close(model.deleteModal).model,
	rulePopover: Popover.init(RULE_POPOVER_ID),
	pickerPopover: Popover.init(PICKER_POPOVER_ID),
	previewPopover: Popover.init(PREVIEW_POPOVER_ID),
})

const openRoute = (model: Model, route: LayoutsRoute, shared: Shared): Return => {
	const version = model.lastVersion + 1
	const base = { ...withPopoversClosed(model), lastVersion: version }
	return Match.valueTags(route, {
		CustomersSettingsLayouts: (): Return => ({ model: { ...base, editor: null } }),
		CustomersSettingsLayoutNew: ({ from, name, preview }): Return => {
			const draft = newDraft(Option.getOrNull(from), Option.getOrNull(name))
			return hydrate(
				{
					...base,
					editor: editorOf(version, {
						layoutId: null,
						from: Option.getOrNull(from),
						newName: Option.getOrNull(name),
						saved: null,
						draft,
						previewId: Option.getOrNull(preview),
					}),
				},
				shared,
			)
		},
		CustomersSettingsLayout: ({ layoutId, preview }): Return =>
			hydrate(
				{
					...base,
					editor: editorOf(version, {
						layoutId,
						from: null,
						newName: null,
						saved: null,
						draft: null,
						previewId: Option.getOrNull(preview),
					}),
				},
				shared,
			),
	})
}

export const init = (route: LayoutsRoute, shared: Shared): Return =>
	openRoute(
		{
			layouts: null,
			metrics: null,
			accounts: null,
			signals: [],
			members: [],
			bands: Customers.DEFAULT_HEALTH_SETTINGS.bands,
			currency: "USD",
			pendingOrder: null,
			newModal: Modal.init(NEW_MODAL_ID),
			newLayout: EMPTY_NEW_LAYOUT,
			deleteModal: Modal.init(DELETE_MODAL_ID),
			deletingId: null,
			editor: null,
			lastVersion: 0,
			rulePopover: Popover.init(RULE_POPOVER_ID),
			pickerPopover: Popover.init(PICKER_POPOVER_ID),
			previewPopover: Popover.init(PREVIEW_POPOVER_ID),
		},
		route,
		shared,
	)

export const routeChanged = (model: Model, route: LayoutsRoute, shared: Shared): Return =>
	openRoute(model, route, shared)

/** The organization arrived after the editor opened. */
export const sharedChanged = (model: Model, shared: Shared): Return => hydrate(model, shared)

// HYDRATING

/**
 * Fills the editor once what it needs has synced (the layout it edits or copies), then asks who the
 * rule matches and loads the previewed customer. Safe to call on every update of the rows.
 */
const hydrate = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	if (editor === null) return { model }
	if (editor.draft !== null) return ensurePreview(fetchDryRunOnce(model, shared), shared)
	const edited = layoutById(model, editor.layoutId)
	const copied = layoutById(model, editor.from)
	const source = edited ?? copied
	if (source === undefined) return { model }
	const draft: Customers.LayoutDraft = {
		name: edited === undefined ? (editor.newName ?? `Copy of ${source.name}`) : source.name,
		rule: source.isDefault && edited === undefined ? Customers.EMPTY_LAYOUT_RULE : source.rule,
		widgets: source.widgets,
	}
	return hydrate(
		{ ...model, editor: { ...editor, draft, saved: edited === undefined ? null : draft } },
		shared,
	)
}

const fetchDryRunOnce = (model: Model, shared: Shared): Return =>
	model.editor !== null && AsyncData.isIdle(model.editor.dryRun) ? fetchDryRun(model, shared) : { model }

/** Dry-runs the draft rule at the draft's place (its version tags the answer); not for the default. */
const fetchDryRun = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const organizationId = shared.organization?.id
	if (
		editor === null ||
		editor.draft === null ||
		organizationId === undefined ||
		isDefaultEditor(model, editor)
	)
		return { model }
	return {
		model: withEditor(model, (current) => ({
			...current,
			dryRun: Option.getOrElse(AsyncData.revalidateOrLoad(current.dryRun), () => current.dryRun),
		})),
		commands: [
			FetchLayoutDryRun({
				organizationId,
				version: editor.version,
				rule: editor.draft.rule,
				layoutId: editor.layoutId,
				position: draftPosition(model, editor) ?? null,
			}),
		],
	}
}

// THE PREVIEW

const toOverviewData = (message: OverviewData.Message) => Message.GotOverviewDataMessage({ message })

const dataInputs = (model: Model, editor: Editor, shared: Shared): OverviewData.Inputs | null =>
	shared.organization === null || editor.previewId === null || editor.draft === null
		? null
		: {
				organizationId: shared.organization.id,
				accountId: editor.previewId,
				widgets: editor.draft.widgets,
				groupKeys: groupKeysOf(model.metrics),
			}

/** The canvas's widgets ask for what they read and was not asked for yet. */
const loadData = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const inputs = editor === null ? null : dataInputs(model, editor, shared)
	if (editor === null || inputs === null) return { model }
	const loaded = OverviewData.load(editor.data, inputs)
	return {
		model: { ...model, editor: { ...editor, data: loaded.model } },
		commands: Command.mapMessages(loaded.commands ?? [], toOverviewData),
	}
}

const setPreview = (model: Model, accountId: CustomerAccountId, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	if (model.editor === null || organizationId === undefined) return { model }
	return then(
		{
			model: withEditor(model, (editor) => ({
				...editor,
				previewId: accountId,
				previewDetail: AsyncData.Loading(),
				previewNotes: [],
			})),
			commands: [FetchLayoutPreviewDetail({ organizationId, accountId })],
		},
		(next) => loadData(next, shared),
	)
}

/** The customer `?preview=` names, else the first the rule matches, else the first customer. */
const ensurePreview = (result: Return, shared: Shared): Return =>
	then(result, (model) => {
		const editor = model.editor
		if (editor === null || editor.draft === null) return { model }
		if (editor.previewId !== null)
			return AsyncData.isIdle(editor.previewDetail)
				? setPreview(model, editor.previewId, shared)
				: { model }
		const matching = Option.getOrUndefined(AsyncData.getData(editor.dryRun))?.matching[0]?.accountId
		const first =
			model.accounts?.find((account) => account.id === matching) ??
			(AsyncData.isPending(editor.dryRun) ? undefined : model.accounts?.[0])
		return first === undefined ? { model } : setPreview(model, first.id, shared)
	})

// EDITING

const editDraft = (
	model: Model,
	shared: Shared,
	change: (draft: Customers.LayoutDraft) => Customers.LayoutDraft,
): Return => {
	const editor = model.editor
	if (editor === null || editor.draft === null) return { model }
	return loadData({ ...model, editor: { ...editor, draft: change(editor.draft) } }, shared)
}

const editWidgets = (
	model: Model,
	shared: Shared,
	change: (widgets: ReadonlyArray<Customers.OverviewWidget>) => ReadonlyArray<Customers.OverviewWidget>,
	selectedId?: string | null,
): Return =>
	editDraft(
		selectedId === undefined ? model : withEditor(model, (editor) => ({ ...editor, selectedId })),
		shared,
		(draft) => ({ ...draft, widgets: change(draft.widgets).slice(0, Customers.MAX_WIDGETS) }),
	)

const takenIds = (model: Model) => new Set((model.editor?.draft?.widgets ?? []).map((widget) => widget.id))

const addWidgets = (model: Model, shared: Shared, added: ReadonlyArray<Customers.OverviewWidget>): Return =>
	editWidgets(
		model,
		shared,
		(widgets) => [...widgets, ...added],
		added.length === 1 ? (added[0]?.id ?? null) : null,
	)

/** A rule edit (or a move): a new version, and the dry run after a pause. */
const ruleEdited = (model: Model, change: (editor: Editor) => Editor): Return => {
	const editor = model.editor
	if (editor === null) return { model }
	const version = model.lastVersion + 1
	return {
		model: { ...model, lastVersion: version, editor: { ...change(editor), version } },
		commands: [WaitForLayoutDryRunDelay({ version })],
	}
}

const moved = <A>(items: ReadonlyArray<A>, index: number, step: -1 | 1): ReadonlyArray<A> => {
	const target = index + step
	if (index < 0 || target < 0 || target >= items.length) return items
	const next = [...items]
	;[next[index], next[target]] = [next[target] as A, next[index] as A]
	return next
}

const toggled = <A>(items: ReadonlyArray<A>, item: A): ReadonlyArray<A> =>
	items.includes(item) ? items.filter((each) => each !== item) : [...items, item]

/** A metric picked for the selected widget: a stat's metric, or one more (or fewer) of a chart's or table's. */
const pickMetric = (model: Model, shared: Shared, metricKey: string): Return => {
	const widget = model.editor === null ? undefined : selectedWidget(model.editor)
	if (widget === undefined) return { model }
	const replace = (next: Customers.OverviewWidget) =>
		editWidgets(model, shared, (widgets) => widgets.map((each) => (each.id === widget.id ? next : each)))
	return Match.valueTags(widget, {
		stat: (stat) => then(replace({ ...stat, metricKey }), (next) => closePicker(next)),
		chart: (chart) => {
			const keys = toggled(chart.metricKeys, metricKey)
			return keys.length === 0 || keys.length > 6 ? { model } : replace({ ...chart, metricKeys: keys })
		},
		// A picked table keeps at least one row.
		metric_table: (table) => {
			const keys = toggled(table.rows._tag === "metrics" ? table.rows.metricKeys : [], metricKey)
			return keys.length === 0 || keys.length > 30
				? { model }
				: replace({ ...table, rows: { _tag: "metrics", metricKeys: keys } })
		},
		built_in: () => ({ model }),
	})
}

// SAVING

/** "9 customers see it now, 4 moved from Observability." */
const savedToast = (model: Model, editor: Editor, name: string): ToastRequest => {
	const result = Option.getOrUndefined(AsyncData.getData(editor.dryRun))
	if (result === undefined || isDefaultEditor(model, editor)) return successToast(`${name} saved`)
	const taken = new Set(result.takenBy.map((entry) => entry.layoutId))
	const matching = new Set(result.matching.map((entry) => entry.accountId))
	const from = new Map<string, number>()
	for (const account of model.accounts ?? [])
		if (
			matching.has(account.id) &&
			account.layoutId !== null &&
			account.layoutId !== editor.layoutId &&
			!taken.has(account.layoutId)
		)
			from.set(account.layoutId, (from.get(account.layoutId) ?? 0) + 1)
	const [fromId, count] = [...from.entries()].sort((left, right) => right[1] - left[1])[0] ?? [null, 0]
	const fromName = layoutById(model, fromId)?.name
	const customers = `${result.effectiveCount} ${result.effectiveCount === 1 ? "customer sees" : "customers see"} it now`
	return successToast(
		`${name} saved`,
		fromName === undefined || count === 0
			? `${customers}.`
			: `${customers}, ${count} moved from ${fromName}.`,
	)
}

const save = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const organizationId = shared.organization?.id
	if (editor === null || editor.draft === null || organizationId === undefined || editor.isSaving)
		return { model }
	const layout = editor.draft
	if (!isValidDraft(layout) || !isDirty(editor)) return { model }
	const commands: Array<Commands[number]> =
		editor.layoutId === null
			? [
					CreateOverviewLayout({
						organizationId,
						layout,
						position: draftPosition(model, editor) ?? null,
					}),
				]
			: [
					UpdateOverviewLayout({ organizationId, layoutId: editor.layoutId, layout }),
					...(editor.before === null
						? []
						: [
								ReorderOverviewLayouts({
									organizationId,
									layoutIds: draftOrder(model, editor).flatMap((id) =>
										id === null ? [] : [id],
									),
								}),
							]),
				]
	return { model: withEditor(model, (current) => ({ ...current, isSaving: true })), commands }
}

const writeFailure = (title: string, reason: LayoutWriteFailure) =>
	toast(
		errorToastOf(
			failureMessage(reason, {
				NotFound: { title, description: "The layout was deleted in the meantime." },
				Invalid: { title, description: "Check the layout's widgets and rule and try again." },
			}),
		),
	)

// LIST

const reorder = (model: Model, shared: Shared, layoutId: CustomerOverviewLayoutId, step: -1 | 1): Return => {
	const organizationId = shared.organization?.id
	const ids = ruleOrder(model).map((layout) => layout.id)
	const order = moved(ids, ids.indexOf(layoutId), step)
	if (organizationId === undefined || order === ids) return { model }
	return {
		model: { ...model, pendingOrder: order },
		commands: [ReorderOverviewLayouts({ organizationId, layoutIds: order })],
	}
}

// OVERLAYS

const updateModal = (
	model: Model,
	field: "newModal" | "deleteModal",
	message: Modal.Message,
	toMessage: (message: Modal.Message) => Message,
): Return => {
	const result = Modal.update(model[field], message)
	return {
		model: { ...model, [field]: result.model },
		commands: Command.mapMessages(result.commands ?? [], toMessage),
	}
}

type PopoverField = "rulePopover" | "pickerPopover" | "previewPopover"

const POPOVER_MESSAGE = {
	rulePopover: (message: Popover.Message) => Message.GotRulePopoverMessage({ message }),
	pickerPopover: (message: Popover.Message) => Message.GotPickerPopoverMessage({ message }),
	previewPopover: (message: Popover.Message) => Message.GotPreviewPopoverMessage({ message }),
} as const satisfies Record<PopoverField, (message: Popover.Message) => Message>

/** A popover's own update; closing drops its search. */
const updatePopover = (model: Model, field: PopoverField, message: Popover.Message): Return => {
	const result = Popover.update(model[field], message)
	const isOpen = result.model.isOpen
	const toMessage: (message: Popover.Message) => Message = POPOVER_MESSAGE[field]
	return {
		model: withEditor({ ...model, [field]: result.model }, (editor) =>
			isOpen
				? editor
				: {
						...editor,
						pickerSearch: field === "pickerPopover" ? "" : editor.pickerSearch,
						previewSearch: field === "previewPopover" ? "" : editor.previewSearch,
						ruleMetricIndex: field === "rulePopover" ? null : editor.ruleMetricIndex,
					},
		),
		commands: Command.mapMessages(result.commands, toMessage),
	}
}

const closePicker = (model: Model): Return =>
	updatePopover(model, "pickerPopover", Popover.Message.RequestedClose())

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedLayouts: ({ layouts }) => hydrate({ ...model, layouts }, shared),
		UpdatedMetrics: ({ metrics }) => loadData({ ...model, metrics }, shared),
		UpdatedAccounts: ({ accounts }) => hydrate({ ...model, accounts }, shared),
		UpdatedSignals: ({ signals }) => ({ model: { ...model, signals } }),
		UpdatedMembers: ({ members }) => ({ model: { ...model, members } }),
		UpdatedSettings: ({ settings }) => ({
			model: {
				...model,
				bands: settings?.bands ?? Customers.DEFAULT_HEALTH_SETTINGS.bands,
				currency: settings?.reportingCurrency ?? "USD",
			},
		}),
		UpdatedPreviewNotes: ({ accountId, notes }) => ({
			model: withEditor(model, (editor) =>
				editor.previewId === accountId ? { ...editor, previewNotes: notes } : editor,
			),
		}),

		PressedMoveLayout: ({ layoutId, step }) => reorder(model, shared, layoutId, step),
		SucceededReorderLayouts: () => ({ model: { ...model, pendingOrder: null } }),
		FailedReorderLayouts: ({ reason }) => ({
			model: { ...model, pendingOrder: null },
			outMessage: writeFailure("Couldn't change the order", reason),
		}),
		PressedDeleteLayout: ({ layoutId }) => ({
			model: { ...model, deletingId: layoutId, deleteModal: Modal.open(model.deleteModal).model },
		}),
		GotDeleteModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "deleteModal", modalMessage, (child) =>
				Message.GotDeleteModalMessage({ message: child }),
			),
		PressedConfirmDelete: () => {
			const organizationId = shared.organization?.id
			const layoutId = model.deletingId
			if (organizationId === undefined || layoutId === null) return { model }
			return {
				model: { ...model, deleteModal: Modal.close(model.deleteModal).model },
				commands: [DeleteOverviewLayout({ organizationId, layoutId })],
			}
		},
		SucceededDeleteLayout: () => ({
			model,
			outMessage: toast(
				successToast("Layout deleted", "Its customers get the next layout that matches them."),
			),
		}),
		FailedDeleteLayout: ({ reason }) => ({
			model,
			outMessage: writeFailure("Couldn't delete the layout", reason),
		}),

		PressedNewLayout: () => ({
			model: { ...model, newLayout: EMPTY_NEW_LAYOUT, newModal: Modal.open(model.newModal).model },
		}),
		GotNewModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "newModal", modalMessage, (child) =>
				Message.GotNewModalMessage({ message: child }),
			),
		ChangedNewName: ({ value }) => ({
			model: { ...model, newLayout: { ...model.newLayout, name: value } },
		}),
		ClickedNewFrom: ({ from }) => ({
			model: {
				...model,
				newLayout: {
					...model.newLayout,
					from,
					copyOf:
						from === "copy"
							? (model.newLayout.copyOf ?? ruleOrder(model)[0]?.id ?? null)
							: model.newLayout.copyOf,
				},
			},
		}),
		ClickedCopyOf: ({ layoutId }) => ({
			model: { ...model, newLayout: { ...model.newLayout, from: "copy", copyOf: layoutId } },
		}),
		PressedCreateAndEdit: () => {
			const { name, from, copyOf } = model.newLayout
			const trimmed = name.trim()
			if (trimmed === "" || (from === "copy" && copyOf === null)) return { model }
			return {
				model: { ...model, newModal: Modal.close(model.newModal).model },
				outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
					AppRoute.CustomersSettingsLayoutNew({
						orgSlug,
						from: Option.some(from === "copy" ? (copyOf ?? "blank") : from),
						name: Option.some(trimmed),
						preview: Option.none(),
					}),
				),
			}
		},

		ChangedName: ({ value }) => editDraft(model, shared, (draft) => ({ ...draft, name: value })),
		PressedDiscard: () => ({ model, outMessage: toList(shared) }),
		PressedSave: () => save(model, shared),
		SucceededCreateLayout: () => {
			const editor = model.editor
			const name = editor?.draft?.name ?? "Layout"
			const saved = editor === null ? successToast(`${name} saved`) : savedToast(model, editor, name)
			// Only the editor still saving leaves for the list; one left meanwhile just says so.
			return editor?.isSaving === true && editor.layoutId === null
				? {
						model: withEditor(model, (current) => ({ ...current, isSaving: false })),
						outMessage: toList(shared, saved),
					}
				: { model, outMessage: toast(saved) }
		},
		FailedCreateLayout: ({ reason }) => ({
			model: withEditor(model, (editor) => ({ ...editor, isSaving: false })),
			outMessage: writeFailure("Couldn't create the layout", reason),
		}),
		SucceededUpdateLayout: ({ layoutId }) => {
			const editor = model.editor
			if (editor === null || editor.layoutId !== layoutId)
				return { model, outMessage: toast(successToast("Layout saved")) }
			return {
				model: {
					...model,
					editor: { ...editor, isSaving: false, saved: editor.draft, before: null },
				},
				outMessage: toast(savedToast(model, editor, editor.draft?.name ?? "Layout")),
			}
		},
		FailedUpdateLayout: ({ layoutId, reason }) => ({
			model: withEditor(model, (editor) =>
				editor.layoutId === layoutId ? { ...editor, isSaving: false } : editor,
			),
			outMessage: writeFailure("Couldn't save the layout", reason),
		}),

		ClickedWidget: ({ widgetId }) => ({
			model: withEditor(model, (editor) => ({ ...editor, selectedId: widgetId })),
		}),
		ClearedSelection: () => ({ model: withEditor(model, (editor) => ({ ...editor, selectedId: null })) }),
		PressedMoveWidget: ({ step }) =>
			editWidgets(model, shared, (widgets) =>
				moved(
					widgets,
					widgets.findIndex((widget) => widget.id === model.editor?.selectedId),
					step,
				),
			),
		PressedDuplicateWidget: () => {
			const widget = model.editor === null ? undefined : selectedWidget(model.editor)
			if (widget === undefined) return { model }
			const copy = { ...widget, id: freshId(takenIds(model), widget._tag.replace("_", "-")) }
			return editWidgets(
				model,
				shared,
				(widgets) => widgets.flatMap((each) => (each.id === widget.id ? [each, copy] : [each])),
				copy.id,
			)
		},
		PressedRemoveWidget: () => {
			const selectedId = model.editor?.selectedId ?? null
			return editWidgets(
				model,
				shared,
				(widgets) => widgets.filter((widget) => widget.id !== selectedId),
				null,
			)
		},
		EditedWidget: ({ widget }) => {
			const before = model.editor?.draft?.widgets.find((each) => each.id === widget.id)
			// A chart's opening range changed: the canvas opens it there.
			const rangeChanged =
				before?._tag === "chart" && widget._tag === "chart" && before.range !== widget.range
			return editWidgets(
				rangeChanged
					? withEditor(model, (editor) => ({
							...editor,
							data: OverviewData.forgetChart(editor.data, widget.id),
						}))
					: model,
				shared,
				(widgets) => widgets.map((each) => (each.id === widget.id ? widget : each)),
			)
		},

		PressedAddWidget: ({ kind }) =>
			addWidgets(model, shared, [newWidget(kind, freshId(takenIds(model), kind.replace("_", "-")))]),
		PressedAddBlock: ({ key }) => {
			const block = BLOCKS.find((each) => each.key === key)
			return block === undefined
				? { model }
				: addWidgets(model, shared, withFreshIds(block.widgets, model.editor?.draft?.widgets ?? []))
		},
		PressedAddBuiltIn: ({ kind }) =>
			addWidgets(model, shared, [newBuiltIn(kind, freshId(takenIds(model), kind.replace("_", "-")))]),

		GotPickerPopoverMessage: ({ message: popoverMessage }) =>
			updatePopover(model, "pickerPopover", popoverMessage),
		ChangedPickerSearch: ({ value }) => ({
			model: withEditor(model, (editor) => ({ ...editor, pickerSearch: value })),
		}),
		PickedMetric: ({ metricKey }) => pickMetric(model, shared, metricKey),

		GotPreviewPopoverMessage: ({ message: popoverMessage }) =>
			updatePopover(model, "previewPopover", popoverMessage),
		ChangedPreviewSearch: ({ value }) => ({
			model: withEditor(model, (editor) => ({ ...editor, previewSearch: value })),
		}),
		PickedPreview: ({ accountId }) =>
			then(
				setPreview(
					withEditor(model, (editor) => ({ ...editor, data: OverviewData.init() })),
					accountId,
					shared,
				),
				(next) => updatePopover(next, "previewPopover", Popover.Message.RequestedClose()),
			),
		SucceededFetchPreviewDetail: ({ accountId, detail }) => ({
			model: withEditor(model, (editor) =>
				editor.previewId === accountId
					? {
							...editor,
							previewDetail: AsyncData.settle(editor.previewDetail, Result.succeed(detail)),
						}
					: editor,
			),
		}),
		FailedFetchPreviewDetail: ({ accountId, reason }) => ({
			model: withEditor(model, (editor) =>
				editor.previewId === accountId
					? {
							...editor,
							previewDetail: AsyncData.settle(editor.previewDetail, Result.fail(reason)),
						}
					: editor,
			),
		}),
		GotOverviewDataMessage: ({ message: dataMessage }) => {
			const editor = model.editor
			const inputs = editor === null ? null : dataInputs(model, editor, shared)
			if (editor === null || inputs === null) return { model }
			const result = OverviewData.update(editor.data, dataMessage, inputs)
			return {
				model: { ...model, editor: { ...editor, data: result.model } },
				commands: Command.mapMessages(result.commands ?? [], toOverviewData),
			}
		},

		GotRulePopoverMessage: ({ message: popoverMessage }) =>
			updatePopover(model, "rulePopover", popoverMessage),
		EditedRule: ({ rule }) =>
			ruleEdited(model, (editor) =>
				editor.draft === null ? editor : { ...editor, draft: { ...editor.draft, rule } },
			),
		PressedRuleMetric: ({ index }) => ({
			model: withEditor(model, (editor) => ({ ...editor, ruleMetricIndex: index })),
		}),
		PressedMoveAbove: ({ layoutId }) => ruleEdited(model, (editor) => ({ ...editor, before: layoutId })),
		ElapsedLayoutDryRunDelay: ({ version }) =>
			model.editor?.version === version ? fetchDryRun(model, shared) : { model },
		SucceededFetchLayoutDryRun: ({ version, result }) =>
			model.editor?.version === version
				? ensurePreview(
						{
							model: withEditor(model, (editor) => ({
								...editor,
								dryRun: AsyncData.settle(editor.dryRun, Result.succeed(result)),
							})),
						},
						shared,
					)
				: { model },
		FailedFetchLayoutDryRun: ({ version, reason }) =>
			model.editor?.version === version
				? ensurePreview(
						{
							model: withEditor(model, (editor) => ({
								...editor,
								dryRun: AsyncData.settle(editor.dryRun, Result.fail(reason)),
							})),
						},
						shared,
					)
				: { model },
		PressedRetryDryRun: () => fetchDryRun(model, shared),
	})
