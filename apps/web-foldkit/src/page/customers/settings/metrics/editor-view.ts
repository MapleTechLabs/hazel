import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Segment } from "../../../../customers/ui/filter-bar"
import { IconTrash } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import * as Field from "../../../../ui/field"
import * as Modal from "../../../../ui/modal"
import type { Shared } from "../../../contract"
import { type Crumb, isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { editabilityOf, errorsOf, groupsOf, layoutsUsing, previewSourceOf } from "./form"
import { Message } from "./message"
import { type Editor, metricByKey, type MetricForm, type MetricRow, type Model } from "./model"
import { card, choice, FORMAT_SEGMENTS, keyText, sourceLabelOf, textInput } from "./parts"
import { previewCard, usedByCard } from "./preview-view"
import { sourceCard } from "./source-view"

/** The metric editor (Wonder "Metric Editor Maple Query"): basics, source, window, preview, used by. */

type H = HtmlBuilder<Message>

const icon = { attributes: { "data-slot": "icon" } }

const AGGREGATION_SEGMENTS: ReadonlyArray<Segment<Customers.MetricAggregation>> = [
	{ key: "sum", label: "Sum" },
	{ key: "max", label: "Highest" },
	{ key: "last", label: "Latest" },
]

const AGGREGATION_HELP = {
	sum: "The days add up: 30 days of spans is their total.",
	max: "The highest day counts: peak seats over 30 days.",
	last: "The latest day with a value counts: the plan's current size.",
} as const satisfies Record<Customers.MetricAggregation, string>

const catalogHref = (shared: Shared) =>
	hrefOf(AppRoute.CustomersSettingsMetrics({ orgSlug: shared.orgSlug ?? "" }))

const crumbs = (shared: Shared, current: string): ReadonlyArray<Crumb<Message>> => [
	{ label: "Metrics", href: catalogHref(shared) },
	{ label: current },
]

// CARDS

const basicsCard = (
	h: H,
	options: Readonly<{
		form: MetricForm
		errors: ReturnType<typeof errorsOf>
		isNew: boolean
		isAdmin: boolean
		groups: ReadonlyArray<string>
	}>,
): Html => {
	const { form, errors, isAdmin } = options
	const isDisabled = !isAdmin
	const suggestions = options.groups.filter((group) => group !== form.group.trim())
	return card(h, { title: "Basics", className: "@container" }, [
		h.div(
			[h.Class("grid grid-cols-1 gap-4 @lg:grid-cols-2")],
			[
				textInput(h, {
					id: "metric-name",
					label: "Name",
					value: form.name,
					onInput: (value) => Message.ChangedName({ value }),
					isDisabled,
					placeholder: "Logs ingested",
					error: errors.name,
				}),
				options.isNew
					? textInput(h, {
							id: "metric-key",
							label: "Key",
							value: form.key,
							onInput: (value) => Message.ChangedKey({ value }),
							isDisabled,
							isMono: true,
							placeholder: "logs_ingested",
							help: "Layouts, signals and the API name it by its key. It can't change later.",
							error: errors.key,
						})
					: h.div(
							[h.Class("flex min-w-0 flex-col gap-1.5")],
							[
								Field.label(h, { elementType: "span" }, ["Key"]),
								h.div(
									[h.Class("flex h-9 items-center rounded-lg bg-secondary px-3")],
									[keyText(h, form.key, "text-sm text-fg-2")],
								),
							],
						),
				textInput(h, {
					id: "metric-description",
					label: "Description",
					value: form.description,
					onInput: (value) => Message.ChangedDescription({ value }),
					isDisabled,
					placeholder: "Bytes of logs each customer sent per day",
					className: "@lg:col-span-2",
				}),
				h.div(
					[h.Class("flex min-w-0 flex-col gap-2")],
					[
						textInput(h, {
							id: "metric-group",
							label: "Group",
							value: form.group,
							onInput: (value) => Message.ChangedGroup({ value }),
							isDisabled,
							placeholder: "Ingest",
							help: "Sections the catalog; a metric table can show a whole group.",
							error: errors.group,
						}),
						...(isDisabled || suggestions.length === 0
							? []
							: [
									h.div(
										[h.Class("flex flex-wrap gap-1.5")],
										suggestions.map((group) =>
											button(
												h,
												{
													intent: "outline",
													size: "xs",
													onPress: Message.ChangedGroup({ value: group }),
													attributes: [h.Key(group)],
												},
												[group],
											),
										),
									),
								]),
					],
				),
				textInput(h, {
					id: "metric-unit",
					label: "Unit",
					value: form.unit,
					onInput: (value) => Message.ChangedUnit({ value }),
					isDisabled,
					placeholder: "spans",
					help: "After a plain number: 1.2M spans.",
					error: errors.unit,
				}),
				h.div(
					[h.Class("@lg:col-span-2")],
					[
						choice(h, {
							label: "Format",
							segments: FORMAT_SEGMENTS,
							selected: form.format,
							onSelect: (format) => Message.ClickedFormat({ format }),
							isDisabled,
						}),
					],
				),
			],
		),
	])
}

const windowCard = (h: H, form: MetricForm, isAdmin: boolean): Html =>
	card(
		h,
		{
			title: "Over a window",
			description: "How widgets, rules and signals combine its days into one number.",
		},
		[
			choice(h, {
				label: "Combine days",
				segments: AGGREGATION_SEGMENTS,
				selected: form.aggregation,
				onSelect: (aggregation) => Message.ClickedAggregation({ aggregation }),
				isDisabled: !isAdmin,
				help: AGGREGATION_HELP[form.aggregation],
			}),
		],
	)

const footer = (h: H, editor: Editor, canDelete: boolean, hasErrors: boolean): Html =>
	h.footer(
		[h.Class("flex flex-wrap items-center justify-between gap-3 border-border border-t pt-5")],
		[
			h.div(
				[],
				canDelete
					? [
							button(
								h,
								{
									intent: "outline",
									onPress: Message.PressedDelete(),
									isPending: editor.isDeleting,
								},
								[IconTrash(h, icon), "Delete metric"],
							),
						]
					: [],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					button(h, { intent: "plain", onPress: Message.PressedCancel() }, ["Cancel"]),
					button(
						h,
						{
							onPress: Message.PressedSave(),
							isDisabled: hasErrors && !editor.isSaving,
							isPending: editor.isSaving,
						},
						[editor.metricKey === null ? "Create metric" : "Save metric"],
					),
				],
			),
		],
	)

const deleteModal = (h: H, model: Model, form: MetricForm, usedIn: number): Html =>
	Modal.controlledModal(h, {
		model: model.deleteModal,
		toParentMessage: (message) => Message.GotDeleteModalMessage({ message }),
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.deleteModal.id), text: `Delete ${form.name}?` },
				description: `Its daily values are deleted too.${usedIn === 0 ? "" : ` ${usedIn === 1 ? "1 layout shows" : `${usedIn} layouts show`} it; their widgets will say it isn't set up.`} This can't be undone.`,
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.PressedConfirmDelete() }, ["Delete metric"]),
			]),
		],
	})

const placeholder = (h: H, shared: Shared, title: string, text: string): Html =>
	settingsPage(h, [
		settingsHeader(h, { title, crumbs: crumbs(shared, title) }),
		h.p(
			[h.Class("rounded-xl border border-border bg-bg px-5 py-12 text-center text-muted-fg text-sm")],
			[text],
		),
	])

const subtitleOf = (metric: MetricRow | undefined, form: MetricForm): string =>
	form.description.trim() !== ""
		? form.description.trim()
		: metric === undefined
			? "A daily value per customer."
			: `${sourceLabelOf(metric)} metric.`

export const editorView = (h: H, model: Model, editor: Editor, shared: Shared): Html => {
	const metric = metricByKey(model, editor.metricKey)
	const form = editor.form
	if (editor.metricKey !== null && model.metrics !== null && metric === undefined && !editor.isDeleting)
		return placeholder(h, shared, "Metric not found", "This metric was deleted, or the link is wrong.")
	if (form === null) return placeholder(h, shared, "Loading metric…", "Loading the metric…")
	const isAdmin = isCustomersAdmin(shared)
	const isNew = editor.metricKey === null
	const metrics = model.metrics ?? []
	const editability = editabilityOf(metric)
	const errors = errorsOf(form, { isNew, editability, metrics })
	const usedIn = layoutsUsing(model.layouts, metrics, isNew ? form.key : (editor.metricKey ?? ""))
	const orgSlug = shared.orgSlug ?? ""
	const title = form.name.trim() === "" ? (isNew ? "New metric" : form.key) : form.name
	return h.div(
		[h.Class("h-full")],
		[
			settingsPage(h, [
				settingsHeader(h, {
					title,
					subtitle: subtitleOf(metric, form),
					crumbs: crumbs(shared, isNew ? "New metric" : form.name || form.key),
				}),
				...(isAdmin ? [] : [readOnlyNotice(h, "metrics")]),
				h.div(
					[h.Class("grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")],
					[
						h.div(
							[h.Class("flex min-w-0 flex-col gap-5")],
							[
								basicsCard(h, { form, errors, isNew, isAdmin, groups: groupsOf(metrics) }),
								sourceCard(h, { form, errors, metric, metrics, editability, isAdmin }),
								...(editability === "full" ? [windowCard(h, form, isAdmin)] : []),
								...(isAdmin
									? [
											footer(
												h,
												editor,
												!isNew && editability === "full",
												Object.keys(errors).length > 0,
											),
										]
									: []),
							],
						),
						h.div(
							[h.Class("flex min-w-0 flex-col gap-5")],
							[
								...(editability === "full"
									? [
											previewCard(h, {
												editor,
												form,
												canRun: Option.isSome(previewSourceOf(form, metrics)),
												isAdmin,
												orgSlug,
											}),
										]
									: []),
								usedByCard(h, usedIn, orgSlug),
							],
						),
					],
				),
			]),
			...(isNew ? [] : [deleteModal(h, model, form, usedIn.length)]),
		],
	)
}
