import { Match, Option, Result } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { failureMessage } from "~/lib/error-messages"
import { suggestedMetricOf } from "../../../../customers/suggested-metrics"
import { errorToastOf, successToast } from "../../../../data/actions"
import type { ToastRequest } from "../../../../overlay/toasts"
import { AppRoute, type MetricSourceKind, type RouteOf } from "../../../../route"
import * as Modal from "../../../../ui/modal"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import { CreateMetric, DeleteMetric, FetchMetricCoverage, PreviewMetric, UpdateMetric } from "./commands"
import {
	blankForm,
	draftOf,
	editabilityOf,
	errorsOf,
	formOfDraft,
	formOfMetric,
	keyOfName,
	previewSourceOf,
	sqlOf,
} from "./form"
import { Message, type MetricWriteFailure } from "./message"
import {
	DELETE_MODAL_ID,
	type Editor,
	type FilterForm,
	metricByKey,
	type MetricForm,
	type Model,
} from "./model"

export type MetricsRoute = RouteOf<
	"CustomersSettingsMetrics" | "CustomersSettingsMetricNew" | "CustomersSettingsMetric"
>

type Return = PageReturn<Model, Message>

const MAX_FILTERS = 10
const MAX_EVENTS = 20

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

const toCatalog = (shared: Shared, request?: ToastRequest) =>
	requestedOrgNavigation(
		shared.orgSlug,
		(orgSlug) => AppRoute.CustomersSettingsMetrics({ orgSlug }),
		request === undefined ? {} : { toast: request },
	)

/** A refusal reads as the store's own reason (Hazel's text, e.g. "Formula Ratio uses it"). */
const writeFailure = (title: string, reason: MetricWriteFailure, detail: string | null) =>
	toast(
		errorToastOf(
			failureMessage(reason, {
				NotFound: { title, description: "The metric was deleted in the meantime." },
				Invalid: { title, description: detail ?? "Check the metric's fields and try again." },
			}),
		),
	)

// ROUTES

const editorOf = (metricKey: string | null, form: MetricForm | null): Editor => ({
	metricKey,
	form,
	preview: AsyncData.Idle(),
	previewRun: 0,
	hoveredDay: null,
	isSaving: false,
	isDeleting: false,
})

/** A new metric's form: a suggested metric's draft when `key` names one, else blank (with the key). */
const newForm = (key: Option.Option<string>, source: Option.Option<MetricSourceKind>): MetricForm =>
	Option.match(key, {
		onNone: () => blankForm(Option.getOrElse(source, () => "maple_query" as const)),
		onSome: (typed) => {
			const suggested = suggestedMetricOf(typed)
			return suggested === undefined
				? {
						...blankForm(Option.getOrElse(source, () => "maple_query" as const)),
						key: typed,
						isKeyEdited: true,
					}
				: formOfDraft(typed, suggested.draft, {
						isKeyEdited: true,
						kind: Option.getOrElse(source, () => suggested.draft.source?._tag ?? "maple_query"),
					})
		},
	})

/** Asks for the catalog's coverage again (it moves with every pull). */
const fetchCoverage = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined) return { model }
	return Option.match(AsyncData.revalidateOrLoad(model.coverage), {
		onNone: () => ({ model }),
		onSome: (coverage) => ({
			model: { ...model, coverage },
			commands: [FetchMetricCoverage({ organizationId })],
		}),
	})
}

const openRoute = (model: Model, route: MetricsRoute, shared: Shared): Return => {
	const base = { ...model, deleteModal: Modal.close(model.deleteModal).model }
	return Match.valueTags(route, {
		CustomersSettingsMetrics: (): Return => fetchCoverage({ ...base, editor: null }, shared),
		CustomersSettingsMetricNew: ({ key, source }): Return => ({
			model: { ...base, editor: editorOf(null, newForm(key, source)) },
		}),
		CustomersSettingsMetric: ({ metricKey }): Return => {
			const metric = metricByKey(base, metricKey)
			return {
				model: {
					...base,
					editor: editorOf(metricKey, metric === undefined ? null : formOfMetric(metric)),
				},
			}
		},
	})
}

export const init = (route: MetricsRoute, shared: Shared): Return =>
	openRoute(
		{
			metrics: null,
			layouts: [],
			coverage: AsyncData.Idle(),
			editor: null,
			lastRun: 0,
			deleteModal: Modal.init(DELETE_MODAL_ID),
		},
		route,
		shared,
	)

export const routeChanged = (model: Model, route: MetricsRoute, shared: Shared): Return =>
	openRoute(model, route, shared)

/** The organization arrived after the catalog opened: its coverage. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	model.editor === null && AsyncData.isIdle(model.coverage) ? fetchCoverage(model, shared) : { model }

// EDITING

const withEditor = (model: Model, change: (editor: Editor) => Editor): Model =>
	model.editor === null ? model : { ...model, editor: change(model.editor) }

/** An answer about one metric changes its editor only (another may be open by then). */
const withMetricEditor = (model: Model, metricKey: string, change: (editor: Editor) => Editor): Model =>
	model.editor?.metricKey === metricKey ? withEditor(model, change) : model

const edit = (model: Model, change: (form: MetricForm) => MetricForm): Return => ({
	model: withEditor(model, (editor) =>
		editor.form === null ? editor : { ...editor, form: change(editor.form) },
	),
})

const editBuilder = (
	model: Model,
	change: (builder: MetricForm["builder"]) => MetricForm["builder"],
): Return => edit(model, (form) => ({ ...form, builder: change(form.builder) }))

const replaced = <A>(items: ReadonlyArray<A>, index: number, item: A): ReadonlyArray<A> =>
	items.map((each, at) => (at === index ? item : each))

const removed = <A>(items: ReadonlyArray<A>, index: number): ReadonlyArray<A> =>
	items.filter((_, at) => at !== index)

/** The metrics arrived after the editor opened on one: fill its form. */
const hydrateEditor = (model: Model): Model => {
	const editor = model.editor
	const metric = metricByKey(model, editor?.metricKey ?? null)
	return editor === null || editor.form !== null || metric === undefined
		? model
		: { ...model, editor: { ...editor, form: formOfMetric(metric) } }
}

const runPreview = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const organizationId = shared.organization?.id
	if (editor?.form == null || organizationId === undefined || !isCustomersAdmin(shared)) return { model }
	const form = editor.form
	return Option.match(previewSourceOf(form, model.metrics ?? []), {
		onNone: () => ({ model }),
		onSome: (source) => {
			const run = model.lastRun + 1
			return {
				model: {
					...model,
					lastRun: run,
					editor: {
						...editor,
						previewRun: run,
						hoveredDay: null,
						preview: Option.getOrElse(
							AsyncData.revalidateOrLoad(editor.preview),
							() => editor.preview,
						),
					},
				},
				commands: [PreviewMetric({ organizationId, run, source, aggregation: form.aggregation })],
			}
		},
	})
}

const save = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const organizationId = shared.organization?.id
	if (editor?.form == null || organizationId === undefined || editor.isSaving || !isCustomersAdmin(shared))
		return { model }
	const form = editor.form
	const metric = metricByKey(model, editor.metricKey)
	if (editor.metricKey !== null && metric === undefined)
		return { model, outMessage: writeFailure("Couldn't save the metric", "NotFound", null) }
	const editability = editabilityOf(metric)
	const errors = errorsOf(form, {
		isNew: editor.metricKey === null,
		editability,
		metrics: model.metrics ?? [],
	})
	if (Object.keys(errors).length > 0) return { model }
	const draft = draftOf(form, editability)
	return {
		model: { ...model, editor: { ...editor, isSaving: true } },
		commands: [
			editor.metricKey === null
				? CreateMetric({ organizationId, key: form.key, metric: draft })
				: UpdateMetric({ organizationId, metricKey: editor.metricKey, metric: draft }),
		],
	}
}

/** What a saved source does next. */
const savedDescription = (form: MetricForm | null): string | null =>
	form?.kind === "maple_query" || form?.kind === "product_event"
		? "Maple fills its history on the next sync, which starts now."
		: null

const updateDeleteModal = (model: Model, message: Modal.Message): Return => {
	const result = Modal.update(model.deleteModal, message)
	return {
		model: { ...model, deleteModal: result.model },
		commands: Command.mapMessages(result.commands ?? [], (child) =>
			Message.GotDeleteModalMessage({ message: child }),
		),
	}
}

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedMetrics: ({ metrics }) => ({ model: hydrateEditor({ ...model, metrics }) }),
		UpdatedLayouts: ({ layouts }) => ({ model: { ...model, layouts } }),
		SucceededFetchCoverage: ({ metrics }) => ({
			model: { ...model, coverage: AsyncData.settle(model.coverage, Result.succeed(metrics)) },
		}),
		FailedFetchCoverage: ({ reason }) => ({
			model: { ...model, coverage: AsyncData.settle(model.coverage, Result.fail(reason)) },
		}),
		PressedNewMetric: () => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.CustomersSettingsMetricNew({ orgSlug, key: Option.none(), source: Option.none() }),
			),
		}),

		// A new metric's key follows its name until the key is typed.
		ChangedName: ({ value }) =>
			edit(model, (form) => ({
				...form,
				name: value,
				key: model.editor?.metricKey === null && !form.isKeyEdited ? keyOfName(value) : form.key,
			})),
		ChangedKey: ({ value }) => edit(model, (form) => ({ ...form, key: value.trim(), isKeyEdited: true })),
		ChangedDescription: ({ value }) => edit(model, (form) => ({ ...form, description: value })),
		ChangedGroup: ({ value }) => edit(model, (form) => ({ ...form, group: value })),
		ChangedUnit: ({ value }) => edit(model, (form) => ({ ...form, unit: value })),
		ClickedFormat: ({ format }) => edit(model, (form) => ({ ...form, format })),
		ClickedAggregation: ({ aggregation }) => edit(model, (form) => ({ ...form, aggregation })),

		ClickedSourceKind: ({ kind }) => edit(model, (form) => ({ ...form, kind })),
		ClickedTable: ({ table }) => editBuilder(model, (builder) => ({ ...builder, table })),
		ClickedValue: ({ value }) => editBuilder(model, (builder) => ({ ...builder, value })),
		ChangedBuilderText: ({ field, value }) =>
			editBuilder(model, (builder) => ({ ...builder, [field]: value })),
		PressedAddFilter: () =>
			editBuilder(model, (builder) =>
				builder.filters.length >= MAX_FILTERS
					? builder
					: {
							...builder,
							filters: [
								...builder.filters,
								{ field: "", op: "eq", value: "" } satisfies FilterForm,
							],
						},
			),
		ChangedFilter: ({ index, filter }) =>
			editBuilder(model, (builder) => ({
				...builder,
				filters: replaced(builder.filters, index, filter),
			})),
		PressedRemoveFilter: ({ index }) =>
			editBuilder(model, (builder) => ({ ...builder, filters: removed(builder.filters, index) })),
		// The SQL starts from what the admin last wrote, else from what the builder writes.
		PressedEditSql: () =>
			edit(model, (form) => ({ ...form, sql: form.typedSql ?? sqlOf(form), isSqlMode: true })),
		PressedUseBuilder: () => edit(model, (form) => ({ ...form, isSqlMode: false })),
		ChangedSql: ({ value }) => edit(model, (form) => ({ ...form, sql: value, typedSql: value })),
		PressedAddEvent: () =>
			edit(model, (form) =>
				form.events.length >= MAX_EVENTS ? form : { ...form, events: [...form.events, ""] },
			),
		ChangedEvent: ({ index, value }) =>
			edit(model, (form) => ({ ...form, events: replaced(form.events, index, value) })),
		PressedRemoveEvent: ({ index }) =>
			edit(model, (form) => ({ ...form, events: removed(form.events, index) })),
		ChangedExpression: ({ value }) => edit(model, (form) => ({ ...form, expression: value })),
		PressedInsertMetric: ({ key }) =>
			edit(model, (form) => {
				const typed = form.expression.trimEnd()
				return { ...form, expression: `${typed}${typed === "" ? "" : " "}{${key}}` }
			}),

		PressedRunPreview: () => runPreview(model, shared),
		SucceededPreviewMetric: ({ run, result }) => ({
			model:
				model.editor?.previewRun === run
					? withEditor(model, (editor) => ({
							...editor,
							preview: AsyncData.settle(editor.preview, Result.succeed(result)),
						}))
					: model,
		}),
		FailedPreviewMetric: ({ run, reason }) => ({
			model:
				model.editor?.previewRun === run
					? withEditor(model, (editor) => ({
							...editor,
							preview: AsyncData.settle(editor.preview, Result.fail(reason)),
						}))
					: model,
		}),
		HoveredSampleDay: ({ index }) => ({
			model: withEditor(model, (editor) => ({ ...editor, hoveredDay: index })),
		}),

		PressedSave: () => save(model, shared),
		SucceededCreateMetric: ({ metricKey }) => {
			const created = successToast("Metric created", savedDescription(model.editor?.form ?? null))
			// Only the editor that is still saving opens the new metric; one left meanwhile just says so.
			return model.editor?.isSaving === true && model.editor.metricKey === null
				? {
						model: withEditor(model, (editor) => ({ ...editor, isSaving: false })),
						outMessage: requestedOrgNavigation(
							shared.orgSlug,
							(orgSlug) => AppRoute.CustomersSettingsMetric({ orgSlug, metricKey }),
							{ replace: true, toast: created },
						),
					}
				: { model, outMessage: toast(created) }
		},
		FailedCreateMetric: ({ reason, detail }) => ({
			model: withEditor(model, (editor) =>
				editor.metricKey === null ? { ...editor, isSaving: false } : editor,
			),
			outMessage: writeFailure("Couldn't create the metric", reason, detail),
		}),
		SucceededUpdateMetric: ({ metricKey }) => ({
			model: withMetricEditor(model, metricKey, (editor) => ({ ...editor, isSaving: false })),
			outMessage: toast(successToast("Metric saved", savedDescription(model.editor?.form ?? null))),
		}),
		FailedUpdateMetric: ({ metricKey, reason, detail }) => ({
			model: withMetricEditor(model, metricKey, (editor) => ({ ...editor, isSaving: false })),
			outMessage: writeFailure("Couldn't save the metric", reason, detail),
		}),
		PressedCancel: () => ({ model, outMessage: toCatalog(shared) }),
		PressedDelete: () => ({ model: { ...model, deleteModal: Modal.open(model.deleteModal).model } }),
		GotDeleteModalMessage: ({ message: modalMessage }) => updateDeleteModal(model, modalMessage),
		PressedConfirmDelete: () => {
			const metricKey = model.editor?.metricKey ?? null
			const organizationId = shared.organization?.id
			if (
				!model.deleteModal.isOpen ||
				metricKey === null ||
				organizationId === undefined ||
				!isCustomersAdmin(shared)
			)
				return { model }
			return {
				model: withEditor(
					{ ...model, deleteModal: Modal.close(model.deleteModal).model },
					(editor) => ({
						...editor,
						isDeleting: true,
					}),
				),
				commands: [DeleteMetric({ organizationId, metricKey })],
			}
		},
		SucceededDeleteMetric: ({ metricKey }) => {
			const deleted = successToast("Metric deleted", "Widgets that showed it now say it isn't set up.")
			return model.editor?.metricKey === metricKey && model.editor.isDeleting
				? { model, outMessage: toCatalog(shared, deleted) }
				: { model, outMessage: toast(deleted) }
		},
		FailedDeleteMetric: ({ metricKey, reason, detail }) => ({
			model: withMetricEditor(model, metricKey, (editor) => ({ ...editor, isDeleting: false })),
			outMessage: writeFailure("Couldn't delete the metric", reason, detail),
		}),
	})
