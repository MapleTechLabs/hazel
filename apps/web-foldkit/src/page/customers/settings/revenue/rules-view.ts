import * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconArrowUp, IconClose, IconPlus, IconTrash } from "../../../../icons"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import { heading } from "../../../../ui/heading"
import { inputElement } from "../../../../ui/input"
import * as Select from "../../../../ui/select"
import { view as selectView } from "../../../../ui/select-view"
import { toggleChip } from "../../../../ui/toggle-chip"
import { removableChip } from "../shared"
import { Message } from "./message"
import {
	catalogOptionsOf,
	CLASS_LABEL,
	type ConditionDraft,
	enumOptionsOf,
	entryKeyOf,
	FIELD_LABEL,
	MAX_CONDITIONS,
	MAX_NAME,
	MAX_TEXT,
	MAX_VALUES,
	type Model,
	problemOf,
	type RevenueDraft,
	type RuleDraft,
	type SelectTarget,
	selectIdOf,
	valueLabelOf,
	windowOptionsOf,
} from "./model"
import { selectModelOf } from "./update"

/** The window select, the ordered rules with their conditions, and the defaults. */

type H = HtmlBuilder<Message>

export const CARD = "flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-bg p-4 sm:p-5"

const icon = { attributes: { "data-slot": "icon" } }

const FIELD_ITEMS = Customers.RevenueConditionField.literals.map((field) =>
	Select.item(field, FIELD_LABEL[field]),
)
const CLASS_ITEMS = Customers.RevenueClass.literals.map((value) => Select.item(value, CLASS_LABEL[value]))

const selectFor = (
	h: H,
	model: Model,
	target: SelectTarget,
	canEdit: boolean,
	options: Readonly<{
		items: ReadonlyArray<Select.Item>
		ariaLabel: string
		placeholder?: string
		isDisabled?: boolean
		className: string
	}>,
): Html => {
	const select = selectModelOf(model, target, canEdit)
	return h.submodel({
		slotId: selectIdOf(target),
		model: options.isDisabled ? { ...select, isDisabled: true } : select,
		view: selectView,
		viewInputs: {
			items: options.items,
			ariaLabel: options.ariaLabel,
			placeholder: options.placeholder,
			className: options.className,
		},
		toParentMessage: (message: Select.Message) =>
			Message.GotSelectMessage({ selectId: selectIdOf(target), message }),
	})
}

const iconButton = (
	h: H,
	options: Readonly<{ label: string; onPress: Message; isDisabled?: boolean; icon: Html }>,
): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-sm",
			onPress: options.onPress,
			isDisabled: options.isDisabled ?? false,
			attributes: [h.AriaLabel(options.label), h.Title(options.label)],
		},
		[options.icon],
	)

// WINDOW

export const windowCard = (h: H, model: Model, draft: RevenueDraft, canEdit: boolean): Html =>
	h.section(
		[h.Class(twMerge(CARD, "sm:flex-row sm:items-center sm:justify-between"))],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					heading(h, { variant: "section" }, ["Variable MRR window"]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[
							"Variable MRR is the average monthly variable billing over this many full calendar months, before the current one.",
						],
					),
				],
			),
			selectFor(h, model, { _tag: "Window" }, canEdit, {
				items: windowOptionsOf(draft.variableMrrMonths).map((months) =>
					Select.item(String(months), months === 1 ? "1 month" : `${months} months`),
				),
				ariaLabel: "Variable MRR window",
				className: "w-36 shrink-0",
			}),
		],
	)

// VALUES

const conditionValues = (
	h: H,
	model: Model,
	rule: RuleDraft,
	condition: ConditionDraft,
	index: number,
	canEdit: boolean,
): ReadonlyArray<Html> => {
	const at = { ruleId: rule.id, index }
	const catalog = Option.getOrNull(AsyncData.getData(model.catalog))
	const enumOptions = enumOptionsOf(condition.field)
	if (enumOptions !== null)
		return enumOptions.map(([value, label]) =>
			toggleChip(h, {
				label,
				isPressed: condition.values.includes(value),
				isDisabled: !canEdit || model.isSaving,
				onPress: Message.ToggledValue({ ...at, value }),
			}),
		)
	const chips = condition.values.map((value) =>
		removableChip(h, {
			label: valueLabelOf(condition.field, value, catalog),
			onRemove: canEdit && !model.isSaving ? Message.ToggledValue({ ...at, value }) : null,
		}),
	)
	if (condition.field === "metadata") {
		const entry = model.valueEntries[entryKeyOf(rule.id, index)] ?? ""
		return [
			...chips,
			...(canEdit
				? [
						h.form(
							[
								h.Class("flex items-center gap-1.5"),
								h.OnSubmit(Message.SubmittedValueEntry(at)),
							],
							[
								inputElement(h, {
									className: "h-8 w-36",
									placeholder: "Value",
									isDisabled: model.isSaving || condition.values.length >= MAX_VALUES,
									attributes: [
										h.AriaLabel(`Value of ${condition.key || "the metadata key"}`),
										h.Value(entry),
										h.Attribute("maxlength", String(MAX_TEXT)),
										h.OnInput((text) => Message.ChangedValueEntry({ ...at, text })),
									],
								}),
								button(
									h,
									{
										intent: "outline",
										size: "xs",
										isDisabled: entry.trim() === "" || model.isSaving,
										onPress: Message.SubmittedValueEntry(at),
									},
									["Add"],
								),
							],
						),
					]
				: []),
		]
	}
	if (!canEdit) return chips
	const options = catalog === null ? [] : catalogOptionsOf(condition.field, catalog)
	const remaining = options.filter(([value]) => !condition.values.includes(value))
	return [
		...chips,
		selectFor(h, model, { _tag: "AddValue", ...at }, canEdit, {
			items: remaining.map(([value, label]) => Select.item(value, label)),
			ariaLabel: `Add a ${FIELD_LABEL[condition.field].toLowerCase()}`,
			placeholder:
				catalog === null
					? AsyncData.isFailure(model.catalog)
						? "Couldn't load"
						: "Loading…"
					: remaining.length === 0
						? "Nothing to add"
						: `Add ${FIELD_LABEL[condition.field].toLowerCase()}…`,
			isDisabled: remaining.length === 0 || condition.values.length >= MAX_VALUES,
			className: "w-48",
		}),
	]
}

const metadataKeyInput = (
	h: H,
	model: Model,
	rule: RuleDraft,
	condition: ConditionDraft,
	index: number,
	canEdit: boolean,
): Html => {
	const listId = `revenue-metadata-keys-${rule.id}-${index}`
	const keys = Option.match(AsyncData.getData(model.catalog), {
		onNone: () => [],
		onSome: (catalog) => catalog.metadataKeys,
	})
	return h.span(
		[h.Class("contents")],
		[
			inputElement(h, {
				className: "h-8 w-36",
				placeholder: "Key",
				isDisabled: !canEdit || model.isSaving,
				isInvalid: condition.key.trim() === "",
				attributes: [
					h.AriaLabel("Metadata key"),
					h.Value(condition.key),
					h.Attribute("list", listId),
					h.Attribute("maxlength", String(MAX_TEXT)),
					h.OnInput((key) => Message.ChangedMetadataKey({ ruleId: rule.id, index, key })),
				],
			}),
			h.datalist(
				[h.Id(listId)],
				keys.map((key) => h.option([h.Value(key)], [])),
			),
		],
	)
}

// RULES

const conditionRow = (
	h: H,
	model: Model,
	rule: RuleDraft,
	condition: ConditionDraft,
	index: number,
	canEdit: boolean,
): Html =>
	h.li(
		[h.Key(String(index)), h.Class("flex items-start gap-2")],
		[
			h.span(
				[h.Class("w-11 shrink-0 pt-1.5 text-right text-muted-fg text-xs")],
				[index === 0 ? "When" : "and"],
			),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-wrap items-center gap-1.5")],
				[
					selectFor(h, model, { _tag: "Field", ruleId: rule.id, index }, canEdit, {
						items: FIELD_ITEMS,
						ariaLabel: "Field",
						className: "w-40",
					}),
					...(condition.field === "metadata"
						? [metadataKeyInput(h, model, rule, condition, index, canEdit)]
						: []),
					h.span([h.Class("text-muted-fg text-xs")], ["is"]),
					...conditionValues(h, model, rule, condition, index, canEdit),
				],
			),
			...(canEdit
				? [
						iconButton(h, {
							label: "Remove condition",
							isDisabled: model.isSaving,
							onPress: Message.PressedRemoveCondition({ ruleId: rule.id, index }),
							icon: IconClose(h, icon),
						}),
					]
				: []),
		],
	)

const ruleCard = (
	h: H,
	model: Model,
	rule: RuleDraft,
	index: number,
	count: number,
	canEdit: boolean,
): Html => {
	const problem = problemOf(rule)
	const isBusy = model.isSaving
	return h.li(
		[h.Key(rule.id), h.Class("flex flex-col gap-3 px-4 py-4 sm:px-5")],
		[
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					badge(h, { intent: "secondary", className: "shrink-0 tabular-nums" }, [
						String(index + 1),
					]),
					inputElement(h, {
						className: "h-8 min-w-0 flex-1 font-medium",
						placeholder: "Untitled rule",
						isDisabled: !canEdit || isBusy,
						attributes: [
							h.AriaLabel(`Name of rule ${index + 1}`),
							h.Value(rule.name),
							h.Attribute("maxlength", String(MAX_NAME)),
							h.OnInput((name) => Message.ChangedRuleName({ ruleId: rule.id, name })),
						],
					}),
					...(canEdit
						? [
								iconButton(h, {
									label: "Move up",
									isDisabled: isBusy || index === 0,
									onPress: Message.PressedMoveRule({ ruleId: rule.id, step: -1 }),
									icon: IconArrowUp(h, icon),
								}),
								iconButton(h, {
									label: "Move down",
									isDisabled: isBusy || index === count - 1,
									onPress: Message.PressedMoveRule({ ruleId: rule.id, step: 1 }),
									icon: IconArrowUp(h, {
										attributes: { "data-slot": "icon" },
										className: "rotate-180",
									}),
								}),
								iconButton(h, {
									label: "Delete rule",
									isDisabled: isBusy,
									onPress: Message.PressedDeleteRule({ ruleId: rule.id }),
									icon: IconTrash(h, icon),
								}),
							]
						: []),
				],
			),
			h.ul(
				[h.AriaLabel("Conditions, all must hold"), h.Class("flex flex-col gap-2")],
				rule.conditions.map((condition, at) => conditionRow(h, model, rule, condition, at, canEdit)),
			),
			h.div(
				[h.Class("flex flex-wrap items-center gap-2")],
				[
					h.span([h.Class("w-11 shrink-0 text-right text-muted-fg text-xs")], ["Then"]),
					selectFor(h, model, { _tag: "Class", ruleId: rule.id }, canEdit, {
						items: CLASS_ITEMS,
						ariaLabel: "Class",
						className: "w-40",
					}),
					...(canEdit
						? [
								button(
									h,
									{
										intent: "plain",
										size: "xs",
										isDisabled: isBusy || rule.conditions.length >= MAX_CONDITIONS,
										onPress: Message.PressedAddCondition({ ruleId: rule.id }),
									},
									[IconPlus(h, icon), "Add condition"],
								),
							]
						: []),
				],
			),
			...(problem === null
				? []
				: [h.p([h.Role("status"), h.Class("text-danger-subtle-fg text-xs")], [problem])]),
		],
	)
}

const addRuleButton = (h: H, model: Model, count: number): Html =>
	button(
		h,
		{
			intent: "outline",
			size: "sm",
			isDisabled: model.isSaving || count >= Customers.MAX_REVENUE_RULES,
			onPress: Message.PressedAddRule(),
		},
		[IconPlus(h, icon), "Add rule"],
	)

export const rulesCard = (h: H, model: Model, draft: RevenueDraft, canEdit: boolean): Html =>
	h.section(
		[h.Class("flex min-w-0 flex-col rounded-xl border border-border bg-bg")],
		[
			h.header(
				[h.Class("flex flex-wrap items-start justify-between gap-2 p-4 sm:px-5")],
				[
					h.div(
						[h.Class("flex min-w-0 flex-1 basis-64 flex-col gap-0.5")],
						[
							heading(h, { variant: "section" }, ["Rules"]),
							h.p(
								[h.Class("text-muted-fg text-sm")],
								["The first rule whose conditions all hold decides a line's class."],
							),
						],
					),
					...(canEdit ? [addRuleButton(h, model, draft.rules.length)] : []),
				],
			),
			...(AsyncData.isFailure(model.catalog)
				? [
						h.div(
							[
								h.Class(
									"flex flex-wrap items-center gap-2 border-border border-t px-4 py-2 text-muted-fg text-xs sm:px-5",
								),
							],
							[
								"Couldn't load your products and prices.",
								button(
									h,
									{ intent: "plain", size: "xs", onPress: Message.PressedRetryCatalog() },
									["Try again"],
								),
							],
						),
					]
				: []),
			draft.rules.length === 0
				? emptyState(h, {
						title: "No rules",
						description: "Every billing line follows the defaults below.",
						className: "border-border border-t",
					})
				: h.ol(
						[
							h.AriaLabel("Rules, first match first"),
							h.Class("divide-y divide-border border-border border-t"),
						],
						draft.rules.map((rule, index) =>
							ruleCard(h, model, rule, index, draft.rules.length, canEdit),
						),
					),
		],
	)

// DEFAULTS

const DEFAULTS: ReadonlyArray<readonly [string, Customers.RevenueClass]> = [
	["A price billed by usage (metered, or tiered)", "variable"],
	["A recurring price, or a subscription item", "recurring"],
	["Anything else (a one-time price, an invoice item with no price)", "one_off"],
]

export const defaultsCard = (h: H): Html =>
	h.section(
		[h.Class(CARD)],
		[
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					heading(h, { variant: "section" }, ["Defaults"]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						["A line no rule matches follows these, in order."],
					),
				],
			),
			h.ol(
				[h.Class("flex flex-col gap-1.5 text-sm")],
				DEFAULTS.map(([line, classification], index) =>
					h.li(
						[h.Class("flex items-baseline justify-between gap-4")],
						[
							h.span([h.Class("min-w-0 text-fg-2")], [`${index + 1}. ${line}`]),
							h.span([h.Class("shrink-0 font-medium text-fg")], [CLASS_LABEL[classification]]),
						],
					),
				),
			),
		],
	)
