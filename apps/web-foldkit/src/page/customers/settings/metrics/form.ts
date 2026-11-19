import * as Customers from "@hazel/domain/customers"
import { Match, Option } from "effect"
import { groupKeysOf, type LayoutRow } from "../../../../customers/overview/rows"
import type { MetricSourceKind } from "../../../../route"
import type { BuilderForm, MetricForm, MetricRow } from "./model"

/**
 * The editor's form: built from a synced metric, a suggested draft or nothing, checked field by
 * field, and turned into the `MetricDraft` the RPCs take.
 */

/** What of a metric the editor may change: everything, or (a source's own, a built-in) its basics. */
export type Editability = "full" | "basics"

export const editabilityOf = (metric: MetricRow | undefined): Editability =>
	metric === undefined || metric.source !== null ? "full" : "basics"

export const DEFAULT_BUILDER: BuilderForm = {
	table: "metrics_sum",
	filters: [{ field: "MetricName", op: "eq", value: "" }],
	value: "sum",
	valueField: "",
	customerField: "Attributes.org_id",
}

export const blankForm = (kind: MetricSourceKind): MetricForm => ({
	name: "",
	key: "",
	isKeyEdited: false,
	description: "",
	group: "",
	unit: "",
	format: "number",
	aggregation: "sum",
	kind,
	isSqlMode: false,
	builder: DEFAULT_BUILDER,
	sql: Customers.mapleBuilderSql(builderOf(DEFAULT_BUILDER)),
	events: [""],
	expression: "",
})

const builderFormOf = (builder: Customers.MapleQueryBuilder): BuilderForm => ({
	table: builder.table,
	filters: builder.filters,
	value: builder.value,
	valueField: builder.valueField ?? "",
	customerField: builder.customerField,
})

/** The form for a draft: its basics, and its source on its own tab (the others keep their blanks). */
export const formOfDraft = (
	key: string,
	draft: Customers.MetricDraft,
	options: Readonly<{ isKeyEdited: boolean; kind: MetricSourceKind }>,
): MetricForm => {
	const base: MetricForm = {
		...blankForm(options.kind),
		name: draft.name,
		key,
		isKeyEdited: options.isKeyEdited,
		description: draft.description ?? "",
		group: draft.group ?? "",
		unit: draft.unit ?? "",
		format: draft.format,
		aggregation: draft.aggregation,
	}
	if (draft.source === null) return base
	return Match.valueTags(draft.source, {
		maple_query: (source): MetricForm => ({
			...base,
			kind: "maple_query",
			isSqlMode: source.builder === null,
			builder: source.builder === null ? base.builder : builderFormOf(source.builder),
			sql: source.sql,
		}),
		product_event: (source): MetricForm => ({ ...base, kind: "product_event", events: source.events }),
		formula: (source): MetricForm => ({ ...base, kind: "formula", expression: source.expression }),
	})
}

export const formOfMetric = (metric: MetricRow): MetricForm =>
	formOfDraft(
		metric.key,
		{
			name: metric.name,
			description: metric.description,
			group: metric.group,
			unit: metric.unit,
			format: metric.format,
			aggregation: metric.aggregation,
			source: metric.source,
		},
		{ isKeyEdited: true, kind: metric.source?._tag ?? "maple_query" },
	)

/** `Spans ingested (traces)` → `spans_ingested_traces`: a key `UserMetricKey` takes. */
export const keyOfName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^[^a-z]+/, "")
		.replace(/_+$/, "")
		.slice(0, 80)
		.replace(/_+$/, "")

export const builderOf = (form: BuilderForm): Customers.MapleQueryBuilder => {
	const builder: Customers.MapleQueryBuilder = {
		table: form.table,
		filters: form.filters.map((filter) => ({ ...filter, field: filter.field.trim() })),
		value: form.value,
		customerField: form.customerField.trim(),
	}
	return form.value === "uniq" ? { ...builder, valueField: form.valueField.trim() } : builder
}

/** The SQL the Maple query runs: the builder's, or the typed statement. */
export const sqlOf = (form: MetricForm): string =>
	form.isSqlMode ? form.sql : Customers.mapleBuilderSql(builderOf(form.builder))

// CHECKS

export type FormErrors = Partial<
	Record<"name" | "key" | "group" | "unit" | "builder" | "sql" | "events" | "expression", string>
>

/** A formula's operands against the org's metrics. */
export type FormulaCheck = Readonly<{
	error: string | null
	known: ReadonlyArray<MetricRow>
	unknown: ReadonlyArray<string>
}>

export const checkFormula = (
	expression: string,
	metrics: ReadonlyArray<MetricRow>,
	selfKey: string,
): FormulaCheck => {
	if (expression.trim() === "")
		return { error: "Write a formula, e.g. {bytes} / {spans}", known: [], unknown: [] }
	const parsed = Customers.parseFormula(expression)
	if (!parsed.ok) return { error: parsed.error, known: [], unknown: [] }
	const known = parsed.keys.flatMap((key) => metrics.filter((metric) => metric.key === key))
	const unknown = parsed.keys.filter((key) => !metrics.some((metric) => metric.key === key))
	const error = parsed.keys.includes(selfKey)
		? "A formula can't use itself"
		: unknown.length > 0
			? `No metric ${unknown.map((key) => `{${key}}`).join(", ")}`
			: known.some((metric) => metric.source?._tag === "formula")
				? "A formula can't use another formula"
				: null
	return { error, known, unknown }
}

const builderError = (builder: BuilderForm): string | undefined => {
	if (!Customers.isBuilderField(builder.customerField.trim()))
		return "Name the customer column, e.g. Attributes.org_id"
	if (builder.value === "uniq" && !Customers.isBuilderField(builder.valueField.trim()))
		return "Name the column to count distinct values of"
	if (builder.filters.some((filter) => !Customers.isBuilderField(filter.field.trim())))
		return "Every filter needs a column, e.g. MetricName or Attributes.signal"
	if (builder.filters.some((filter) => filter.value.trim() === "")) return "Every filter needs a value"
	return undefined
}

export const errorsOf = (
	form: MetricForm,
	context: Readonly<{ isNew: boolean; editability: Editability; metrics: ReadonlyArray<MetricRow> }>,
): FormErrors => {
	const errors: FormErrors = {}
	if (form.name.trim() === "") errors.name = "Name the metric"
	else if (form.name.trim().length > 120) errors.name = "At most 120 characters"
	if (context.isNew) {
		if (!Customers.METRIC_KEY_PATTERN.test(form.key))
			errors.key = "Lower-case letters, digits, _ . and -, starting with a letter"
		else if (Customers.isReservedMetricKey(form.key))
			errors.key = "Hazel uses this key itself; pick another"
		else if (context.metrics.some((metric) => metric.key === form.key))
			errors.key = "Another metric has this key"
	}
	if (form.group.trim().length > 80) errors.group = "At most 80 characters"
	if (form.unit.trim().length > 40) errors.unit = "At most 40 characters"
	if (context.editability === "basics") return errors
	switch (form.kind) {
		case "maple_query": {
			if (form.isSqlMode) {
				const sqlError =
					form.sql.trim() === "" ? "Write the query" : Customers.checkMapleSql(form.sql)
				if (sqlError !== null) errors.sql = sqlError
			} else {
				const error = builderError(form.builder)
				if (error !== undefined) errors.builder = error
			}
			break
		}
		case "product_event": {
			const events = form.events.map((event) => event.trim()).filter((event) => event !== "")
			if (events.length === 0) errors.events = "Add at least one event name"
			break
		}
		case "formula": {
			const error = checkFormula(form.expression, context.metrics, form.key).error
			if (error !== null) errors.expression = error
			break
		}
	}
	return errors
}

const sourceOf = (form: MetricForm): Customers.MetricSource => {
	switch (form.kind) {
		case "maple_query":
			return form.isSqlMode
				? { _tag: "maple_query", sql: form.sql.trim().replace(/;\s*$/, ""), builder: null }
				: { _tag: "maple_query", sql: sqlOf(form), builder: builderOf(form.builder) }
		case "product_event":
			return {
				_tag: "product_event",
				events: form.events.map((event) => event.trim()).filter((event) => event !== ""),
			}
		case "formula":
			return { _tag: "formula", expression: form.expression.trim() }
	}
}

/** The source alone, for the preview; none while it is invalid. */
export const previewSourceOf = (
	form: MetricForm,
	metrics: ReadonlyArray<MetricRow>,
): Option.Option<Customers.MetricSource> => {
	const errors = errorsOf(form, { isNew: false, editability: "full", metrics })
	const sourceError = errors.builder ?? errors.sql ?? errors.events ?? errors.expression
	return sourceError === undefined ? Option.some(sourceOf(form)) : Option.none()
}

const orNull = (text: string): string | null => (text.trim() === "" ? null : text.trim())

/** What Save sends; a source's own metric and the built-ins send no source. */
export const draftOf = (form: MetricForm, editability: Editability): Customers.MetricDraft => ({
	name: form.name.trim(),
	description: orNull(form.description),
	group: orNull(form.group),
	unit: orNull(form.unit),
	format: form.format,
	aggregation: form.aggregation,
	source: editability === "full" ? sourceOf(form) : null,
})

// THE CATALOG

/** The layouts whose widgets read `key` (a metric table's group counts as naming its metrics). */
export const layoutsUsing = (
	layouts: ReadonlyArray<LayoutRow>,
	metrics: ReadonlyArray<MetricRow>,
	key: string,
): ReadonlyArray<LayoutRow> => {
	const groupKeys = groupKeysOf(metrics)
	return layouts.filter((layout) =>
		layout.widgets.some((widget) => Customers.widgetMetricKeys(widget, groupKeys).includes(key)),
	)
}

/** The formula metrics whose expression names `key`. */
export const formulasUsing = (metrics: ReadonlyArray<MetricRow>, key: string): ReadonlyArray<MetricRow> =>
	metrics.filter((metric) => {
		if (metric.source?._tag !== "formula") return false
		const parsed = Customers.parseFormula(metric.source.expression)
		return parsed.ok && parsed.keys.includes(key)
	})
