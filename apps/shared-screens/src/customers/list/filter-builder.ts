// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customers list's filter builder (today's `filterBuilder` in `page/customers/list/controls.ts`):
 * the fields by group on one side, the picked field's editor, how many accounts the pending
 * filters keep, and Cancel / Apply on the other. A view function: the controls own its state.
 */
import * as Customers from "@hazel/domain/customers"
import { type Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { countryFlag, fundingStageLabel } from "../data/company"
import { currencySymbol, formatCount, formatMoney, toMajor, toMinor } from "../data/format"
import type { AccountRow, MemberRow } from "../data/queries"
import { STAGE_LABEL } from "../ui/badges"
import {
	type Builder,
	countriesOf,
	FIELD_DESCRIPTION,
	FIELD_GROUPS,
	FIELD_KIND,
	FIELD_LABEL,
	type FilterField,
	fundingStagesOf,
	industriesOf,
	matchesFilters,
	plansOf,
	tagsOf,
	type Viewer,
	withFilter,
	withSearch,
} from "./filters"

/** The builder's number fields: their text as typed, kept by the controls. */
export type BuilderFields = Readonly<{ min: TextField.State; max: TextField.State; days: TextField.State }>

export const DAY_PRESETS = [7, 14, 30, 60, 90] as const

/** The default window of "Last active" before one is typed. */
const DEFAULT_DAYS = 14

/** Whether "Last active" counts accounts quiet for more than the days (else active within them). */
export const isInactiveWindow = (pending: Customers.ViewFilters): boolean =>
	pending.lastActiveWithinDays === undefined

export const daysOf = (pending: Customers.ViewFilters): number =>
	pending.inactiveForDays ?? pending.lastActiveWithinDays ?? DEFAULT_DAYS

/** "Last active" set to a window: within the last `days`, or more than `days` ago. */
export const withWindow = (
	pending: Customers.ViewFilters,
	inactive: boolean,
	days: number | undefined,
): Customers.ViewFilters =>
	withFilter(
		withFilter(pending, "lastActiveWithinDays", inactive ? undefined : days),
		"inactiveForDays",
		inactive ? days : undefined,
	)

const majorText = (minor: number | undefined, currency: string) =>
	minor === undefined ? "" : String(toMajor(minor, currency))

/** The number fields' text for a builder just opened on `pending`. */
export const fieldsFor = (
	pending: Customers.ViewFilters,
	currency: string,
	previous?: BuilderFields,
): BuilderFields => {
	const base = previous ?? { min: TextField.empty, max: TextField.empty, days: TextField.empty }
	return {
		min: TextField.set(base.min, majorText(pending.minMrrMinor, currency)),
		max: TextField.set(base.max, majorText(pending.maxMrrMinor, currency)),
		days: TextField.set(base.days, String(daysOf(pending))),
	}
}

/** A typed amount or day count; blank or not a number is none. */
export const parseNumber = (raw: string): number | undefined => {
	const parsed = Number.parseFloat(raw)
	return raw.trim() === "" || Number.isNaN(parsed) ? undefined : parsed
}

export const minorOf = (raw: string, currency: string): number | undefined => {
	const value = parseNumber(raw)
	return value === undefined ? undefined : toMinor(value, currency)
}

export const daysFrom = (raw: string): number | undefined => {
	const value = parseNumber(raw)
	return value === undefined ? undefined : Math.max(1, Math.round(value))
}

export type BuilderOptions<Msg> = Readonly<{
	builder: Builder
	fields: BuilderFields
	accounts: ReadonlyArray<AccountRow>
	members: ReadonlyArray<MemberRow>
	search: string
	currency: string
	viewer: Viewer
	/** A phone: the fields wrap as chips above the editor, so it and Apply stay on screen. */
	compact: boolean
	onPickField: (field: FilterField) => Msg
	onChange: (filters: Customers.ViewFilters) => Msg
	onChangeMin: (payload: TextField.ChangePayload) => Msg
	onChangeMax: (payload: TextField.ChangePayload) => Msg
	onChangeDays: (payload: TextField.ChangePayload) => Msg
	/** A day preset: the window's days and the field's text together. */
	onPreset: (days: number) => Msg
	onApply: Msg
	onCancel: Msg
}>

type H<Msg> = Hazel.H<Msg>

const note = <Msg>(h: H<Msg>, text: string) => h.text.role("caption").tone("muted").children(text)

/** A field's values as checkboxes; `values` are the filter's list, `labelOf` names each. */
const anyOf = <Msg, A extends string>(
	h: H<Msg>,
	options: BuilderOptions<Msg>,
	values: ReadonlyArray<A>,
	chosen: ReadonlyArray<A> | undefined,
	labelOf: (value: A) => string,
	set: (next: ReadonlyArray<A> | undefined) => Customers.ViewFilters,
	empty: string,
) => {
	if (values.length === 0) return note(h, empty)
	const byValue = new Map<string, A>(values.map((value) => [value, value]))
	return h.choiceGroup
		.label(FIELD_LABEL[options.builder.field])
		.labelHidden()
		.multiple()
		.options(values.map((value) => ({ value, label: labelOf(value) })))
		.selected(chosen ?? [])
		.on("change", ({ selected }) => {
			const next = selected.flatMap((value) => {
				const known = byValue.get(value)
				return known === undefined ? [] : [known]
			})
			return options.onChange(set(next.length === 0 ? undefined : next))
		})
}

const ME = "me"
const UNASSIGNED = "unassigned"

const ownerEditor = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) => {
	const { pending } = options.builder
	const others = options.members.filter((member) => member.id !== options.viewer.userId)
	const idOf = new Map(others.map((member) => [member.id as string, member.id]))
	return h.choiceGroup
		.label(FIELD_LABEL.owner)
		.labelHidden()
		.multiple()
		.options([
			{ value: ME, label: "Me" },
			...others.map((member) => ({ value: member.id, label: member.name })),
			{ value: UNASSIGNED, label: "Unassigned" },
		])
		.selected([
			...(pending.ownedByMe ? [ME] : []),
			...(pending.ownerUserIds ?? []),
			...(pending.unowned ? [UNASSIGNED] : []),
		])
		.on("change", ({ selected }) => {
			const ids = selected.flatMap((value) => {
				const id = idOf.get(value)
				return id === undefined ? [] : [id]
			})
			const next = withFilter(
				withFilter(
					withFilter(pending, "ownedByMe", selected.includes(ME) ? true : undefined),
					"ownerUserIds",
					ids.length === 0 ? undefined : ids,
				),
				"unowned",
				selected.includes(UNASSIGNED) ? true : undefined,
			)
			return options.onChange(next)
		})
}

const mrrEditor = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) => {
	const { pending } = options.builder
	const symbol = currencySymbol(options.currency)
	return h.stack.children(
		h.toggle
			.style("checkbox")
			.label("Paying only (MRR above zero)")
			.checked(pending.payingOnly === true)
			.on("change", ({ checked }) =>
				options.onChange(withFilter(pending, "payingOnly", checked ? true : undefined)),
			),
		h.grid
			.columns("2")
			.density("compact")
			.children(
				h.textField
					.label(`At least (${symbol})`)
					.inputKind("number")
					.value(options.fields.min)
					.on("change", options.onChangeMin),
				h.textField
					.label(`At most (${symbol})`)
					.inputKind("number")
					.value(options.fields.max)
					.on("change", options.onChangeMax),
			),
	)
}

const WITHIN = "within"
const MORE_THAN = "more_than"

const lastActiveEditor = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) => {
	const { pending } = options.builder
	const inactive = isInactiveWindow(pending)
	const days = daysOf(pending)
	return h.stack.children(
		// HAZEL-GAP(pk4a-builder-radio-cards): today's two conditions are bordered radio rows side by side; `cards` draws option cards.
		h.choiceGroup
			.label("Condition")
			.labelHidden()
			.style("cards")
			.columns("2")
			.options([
				{ value: WITHIN, label: "within the last" },
				{ value: MORE_THAN, label: "more than" },
			])
			.selected(inactive ? (pending.inactiveForDays === undefined ? [] : [MORE_THAN]) : [WITHIN])
			.on("change", ({ selected }) =>
				options.onChange(withWindow(pending, selected.includes(MORE_THAN), days)),
			),
		h.textField
			.label(inactive ? "Days ago" : "Days")
			.inputKind("number")
			.value(options.fields.days)
			.on("change", options.onChangeDays),
		h.stack
			.axis("horizontal")
			.density("tight")
			.children(
				...DAY_PRESETS.map((preset) =>
					h.button
						.key(`preset-${preset}`)
						.label(`${preset}d`)
						.variant(preset === days ? "secondary" : "ghost")
						.size("xsmall")
						.on("press", options.onPreset(preset)),
				),
			),
	)
}

const ANY = "any"
const YES = "yes"
const NONE = "none"

const signalsEditor = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) => {
	const { pending } = options.builder
	const value = pending.hasOpenRiskSignals === undefined ? ANY : pending.hasOpenRiskSignals ? YES : NONE
	return h.choiceGroup
		.label(FIELD_LABEL.signals)
		.labelHidden()
		.style("cards")
		.options([
			{ value: ANY, label: "Any" },
			{ value: YES, label: "Has an open risk signal" },
			{ value: NONE, label: "No open risk signals" },
		])
		.selected([value])
		.on("change", ({ selected }) => {
			const [next] = selected
			return options.onChange(
				withFilter(
					pending,
					"hasOpenRiskSignals",
					next === YES ? true : next === NONE ? false : undefined,
				),
			)
		})
}

const editor = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) => {
	const { builder, accounts } = options
	const { pending } = builder
	switch (builder.field) {
		case "stage":
			return anyOf(
				h,
				options,
				Customers.LifecycleStage.literals,
				pending.lifecycleStages,
				(stage) => STAGE_LABEL[stage],
				(next) => withFilter(pending, "lifecycleStages", next),
				"",
			)
		case "plan":
			return anyOf(
				h,
				options,
				plansOf(accounts),
				pending.planNames,
				(plan) => plan,
				(next) => withFilter(pending, "planNames", next),
				"No account has a plan yet.",
			)
		case "tag":
			return anyOf(
				h,
				options,
				tagsOf(accounts),
				pending.tagsAny,
				(tag) => tag,
				(next) => withFilter(pending, "tagsAny", next),
				"No account has a tag yet.",
			)
		case "industry":
			return anyOf(
				h,
				options,
				industriesOf(accounts, pending.industries),
				pending.industries,
				(industry) => industry,
				(next) => withFilter(pending, "industries", next),
				"No company has an industry on record yet.",
			)
		case "company_size":
			return anyOf(
				h,
				options,
				Customers.EmployeeRange.literals,
				pending.employeeRanges,
				(range) => Customers.EMPLOYEE_RANGE_LABEL[range],
				(next) => withFilter(pending, "employeeRanges", next),
				"",
			)
		case "country": {
			const countries = countriesOf(accounts, pending.countryCodes)
			const names = new Map(countries.map(({ code, name }) => [code, name]))
			return anyOf(
				h,
				options,
				countries.map(({ code }) => code),
				pending.countryCodes,
				(code) => `${countryFlag(code)} ${names.get(code) ?? code}`.trim(),
				(next) => withFilter(pending, "countryCodes", next),
				"No company has a headquarters on record yet.",
			)
		}
		case "funding":
			return anyOf(
				h,
				options,
				fundingStagesOf(accounts, pending.fundingStages),
				pending.fundingStages,
				fundingStageLabel,
				(next) => withFilter(pending, "fundingStages", next),
				"No company has funding on record yet.",
			)
		case "owner":
			return ownerEditor(h, options)
		case "mrr":
			return mrrEditor(h, options)
		case "last_active":
			return lastActiveEditor(h, options)
		case "signals":
			return signalsEditor(h, options)
	}
}

/** How many accounts the pending filters keep, and their MRR. */
export const previewOf = (
	options: Pick<BuilderOptions<unknown>, "builder" | "accounts" | "search" | "viewer">,
) => {
	const filters = withSearch(options.builder.pending, options.search)
	const matches = options.accounts.filter((account) => matchesFilters(filters, account, options.viewer))
	return { count: matches.length, mrrMinor: matches.reduce((sum, account) => sum + account.mrrMinor, 0) }
}

/** The fields by group: each with its kind, the picked one marked. */
const fieldList = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) =>
	// HAZEL-GAP(pk4a-builder-panes): today the field list is a fixed 14rem column beside the editor (40rem in all) and wraps as chips on a phone; the popover sizes to its content.
	h.stack.density("compact").children(
		...FIELD_GROUPS.map(([group, fields]) =>
			h.section
				.key(group)
				// Today's group label: `text-xs` muted, not uppercase.
				.style("tree")
				.title(group)
				.children(
					...fields.map((field) =>
						h.item
							.key(field)
							.title(FIELD_LABEL[field])
							.selected(field === options.builder.field)
							.trailing(
								h.text.role("caption").tone("muted").children(FIELD_KIND[field]),
								field === options.builder.field ? h.icon.name("chevron-right") : null,
							)
							.on("press", options.onPickField(field)),
					),
				),
		),
	)

/** A phone's field picker: every field as a chip, the picked one pressed. */
const fieldChips = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) => {
	const byValue = new Map<string, FilterField>(
		FIELD_GROUPS.flatMap(([, fields]) => fields.map((field) => [field, field])),
	)
	return h.choiceGroup
		.label("Filter by")
		.labelHidden()
		.style("chips")
		.options(
			FIELD_GROUPS.flatMap(([, fields]) =>
				fields.map((field) => ({ value: field, label: FIELD_LABEL[field] })),
			),
		)
		.selected([options.builder.field])
		.on("change", ({ selected }) =>
			options.onPickField(byValue.get(selected[0] ?? "") ?? options.builder.field),
		)
}

export const filterBuilder = <Msg>(h: H<Msg>, options: BuilderOptions<Msg>) => {
	const preview = previewOf(options)
	return h.stack
		.axis(options.compact ? "vertical" : "horizontal")
		.align(options.compact ? "stretch" : "start")
		.children(
			options.compact ? fieldChips(h, options) : fieldList(h, options),
			h.stack.children(
				h.stack
					.density("tight")
					.children(
						h.text.strong().children(FIELD_LABEL[options.builder.field]),
						note(h, FIELD_DESCRIPTION[options.builder.field]),
					),
				editor(h, options),
				// HAZEL-GAP(p4-inline-text): today the count is bold inside one muted sentence in a bordered box.
				h.frame.surface("inset").children(
					h.stack
						.axis("horizontal")
						.density("tight")
						.children(
							h.text
								.strong()
								.numeric()
								.children(`${formatCount(preview.count)} customers`),
							h.text
								.tone("muted")
								.numeric()
								.children(
									`of ${formatCount(options.accounts.length)} · ${formatMoney(preview.mrrMinor, options.currency)} MRR`,
								),
						),
				),
				h.stack
					.axis("horizontal")
					.density("compact")
					.children(
						h.spacer,
						h.button.label("Cancel").variant("ghost").size("small").on("press", options.onCancel),
						h.button.label("Apply filter").size("small").on("press", options.onApply),
					),
			),
		)
}
