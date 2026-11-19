import * as Customers from "@hazel/domain/customers"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Match, Option } from "effect"
import { formatCount, formatMetric, toMajor, toMinor } from "../../../../customers/format"
import { ruleChips } from "../../../../customers/overview/rules"
import { HEALTH_LABEL, STAGE_LABEL } from "../../../../customers/ui/badges"
import { segmented } from "../../../../customers/ui/filter-bar"
import { IconArrowUp } from "../../../../customers/ui/icons"
import { IconChevronDown, IconClose, IconPlus, IconWarning } from "../../../../icons"
import { button } from "../../../../ui/button"
import { input } from "../../../../ui/input"
import * as Popover from "../../../../ui/popover"
import { Message } from "./message"
import { draftOrder, type Editor, layoutById, type Model, planNames, tagNames } from "./model"
import { chipClass, numberInput } from "./panel-view"

/** "Who gets this layout" (Wonder `was`): the rule's conditions, who it matches, and who earlier layouts keep. */

type H = HtmlBuilder<Message>
type Condition = Customers.LayoutCondition

const icon = { attributes: { "data-slot": "icon" } }

const CONDITION_LABEL = {
	stage: "Stage",
	plan: "Plan",
	tag: "Tag",
	health: "Health",
	mrr: "MRR",
	attribute: "Attribute",
	metric: "Metric",
} as const satisfies Record<Condition["_tag"], string>

/** A new condition of each kind, already valid: the first choice picked. */
const newCondition = (model: Model, tag: Condition["_tag"]): Condition => {
	switch (tag) {
		case "stage":
			return { _tag: "stage", stages: ["active"] }
		case "plan":
			return { _tag: "plan", planNames: [planNames(model)[0] ?? "Pro"] }
		case "tag":
			return { _tag: "tag", tags: [tagNames(model)[0] ?? "enterprise"] }
		case "health":
			return { _tag: "health", statuses: ["at_risk"] }
		case "mrr":
			return { _tag: "mrr", op: "gte", valueMinor: toMinor(1_000, model.currency) }
		case "attribute":
			return { _tag: "attribute", key: "industry", op: "exists", value: "" }
		case "metric":
			return {
				_tag: "metric",
				metricKey: model.metrics?.[0]?.key ?? "active_users",
				windowDays: 30,
				op: "gt",
				value: 0,
			}
	}
}

/** Chips that toggle; the last one cannot be turned off (a condition needs one). */
const choiceChips = <A extends string>(
	h: H,
	options: ReadonlyArray<readonly [A, string]>,
	selected: ReadonlyArray<A>,
	onChange: (next: ReadonlyArray<A>) => Message,
): Html =>
	h.div(
		[h.Class("flex flex-wrap gap-1")],
		options.map(([key, label]) => {
			const isOn = selected.includes(key)
			const isLast = isOn && selected.length === 1
			return button(
				h,
				{
					intent: "outline",
					size: "xs",
					isDisabled: isLast,
					onPress: isLast
						? undefined
						: onChange(isOn ? selected.filter((each) => each !== key) : [...selected, key]),
					attributes: [h.Key(key), h.AriaPressed(isOn ? "true" : "false")],
					className: chipClass(isOn),
				},
				[label],
			)
		}),
	)

const withValues = (values: ReadonlyArray<string>, extra: ReadonlyArray<string>) =>
	[...new Set([...values, ...extra])].map((value) => [value, value] as const)

const textCommit = (
	h: H,
	label: string,
	value: string,
	maxLength: number,
	onCommit: (value: string) => Message,
): Html =>
	input(h, {
		attributes: [
			h.AriaLabel(label),
			h.Value(value),
			h.Attribute("maxlength", String(maxLength)),
			h.OnChange((text) => onCommit(text.trim() === "" ? value : text.trim())),
		],
	})

const conditionEditor = (
	h: H,
	model: Model,
	editor: Editor,
	condition: Condition,
	index: number,
	set: (next: Condition) => Message,
): Html => {
	return Match.valueTags(condition, {
		stage: (condition) =>
			choiceChips(
				h,
				Customers.LifecycleStage.literals.map((stage) => [stage, STAGE_LABEL[stage]] as const),
				condition.stages,
				(stages) => set({ ...condition, stages }),
			),
		plan: (condition) =>
			choiceChips(
				h,
				withValues(planNames(model), condition.planNames),
				condition.planNames,
				(planNames) => set({ ...condition, planNames }),
			),
		tag: (condition) =>
			choiceChips(h, withValues(tagNames(model), condition.tags), condition.tags, (tags) =>
				set({ ...condition, tags }),
			),
		health: (condition) =>
			choiceChips(
				h,
				Customers.HealthStatus.literals.map((status) => [status, HEALTH_LABEL[status]] as const),
				condition.statuses,
				(statuses) => set({ ...condition, statuses }),
			),
		mrr: (condition) =>
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					segmented(h, {
						ariaLabel: "MRR is",
						segments: [
							{ key: "gte", label: "at least" },
							{ key: "lt", label: "below" },
						],
						selected: condition.op,
						onSelect: (op) => set({ ...condition, op }),
					}),
					numberInput(h, {
						label: `MRR in ${model.currency}`,
						value: toMajor(condition.valueMinor, model.currency),
						onCommit: (major) =>
							set({ ...condition, valueMinor: Math.round(toMinor(major, model.currency)) }),
						className: "w-28",
					}),
					h.span([h.Class("text-muted-fg text-xs")], [model.currency]),
				],
			),
		attribute: (condition) =>
			h.div(
				[h.Class("flex flex-wrap items-center gap-2")],
				[
					h.div(
						[h.Class("w-32")],
						[textCommit(h, "Attribute", condition.key, 100, (key) => set({ ...condition, key }))],
					),
					segmented(h, {
						ariaLabel: "Attribute",
						segments: [
							{ key: "eq", label: "is" },
							{ key: "neq", label: "is not" },
							{ key: "exists", label: "is set" },
						],
						selected: condition.op,
						onSelect: (op) => set({ ...condition, op }),
					}),
					...(condition.op === "exists"
						? []
						: [
								h.div(
									[h.Class("w-32")],
									[
										input(h, {
											attributes: [
												h.AriaLabel("Value"),
												h.Value(condition.value),
												h.Attribute("maxlength", "200"),
												h.OnChange((value) => set({ ...condition, value })),
											],
										}),
									],
								),
							]),
				],
			),
		metric: (condition) => {
			const metric = model.metrics?.find((each) => each.key === condition.metricKey)
			const isListOpen = editor.ruleMetricIndex === index
			return h.div(
				[h.Class("flex flex-col gap-2")],
				[
					h.div(
						[h.Class("flex flex-wrap items-center gap-2")],
						[
							button(
								h,
								{
									intent: "outline",
									size: "xs",
									onPress: Message.PressedRuleMetric({ index: isListOpen ? null : index }),
									attributes: [h.AriaExpanded(isListOpen)],
								},
								[
									metric?.name ?? condition.metricKey,
									IconChevronDown(h, { className: "size-3" }),
								],
							),
							segmented(h, {
								ariaLabel: "Over the last",
								segments: [7, 30, 90].map((days) => ({
									key: String(days),
									label: `${days}d`,
								})),
								selected: String(condition.windowDays),
								onSelect: (days) => set({ ...condition, windowDays: Number(days) }),
							}),
							segmented(h, {
								ariaLabel: "Is",
								segments: [
									{ key: "gt", label: "above" },
									{ key: "lt", label: "below" },
								],
								selected: condition.op,
								onSelect: (op) => set({ ...condition, op }),
							}),
							numberInput(h, {
								label: "Value",
								value: condition.value,
								onCommit: (value) => set({ ...condition, value }),
								className: "w-28",
							}),
							...(metric === undefined || metric.format === "number"
								? []
								: [
										h.span(
											[h.Class("text-muted-fg text-xs")],
											[`= ${formatMetric(condition.value, metric, model.currency)}`],
										),
									]),
						],
					),
					...(isListOpen
						? [
								h.div(
									[
										h.Class(
											"flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-lg border border-border p-1.5",
										),
									],
									(model.metrics ?? []).map((each) =>
										button(
											h,
											{
												intent:
													each.key === condition.metricKey ? "secondary" : "plain",
												size: "xs",
												onPress: set({ ...condition, metricKey: each.key }),
												attributes: [h.Key(each.key)],
											},
											[each.name],
										),
									),
								),
							]
						: []),
				],
			)
		},
	})
}

// WHO IT MATCHES

/** "Matches 6 customers", or "Gets 0 of 6 matching customers" when earlier layouts or pins keep some. */
export const matchSummary = (result: Customers.LayoutDryRunResult): string => {
	const customers = (count: number) => (count === 1 ? "customer" : "customers")
	return result.effectiveCount === result.matchingCount
		? `Matches ${formatCount(result.matchingCount)} ${customers(result.matchingCount)}`
		: `Gets ${formatCount(result.effectiveCount)} of ${formatCount(result.matchingCount)} matching ${customers(result.matchingCount)}`
}

const matches = (h: H, model: Model, editor: Editor): ReadonlyArray<Html> => {
	const result = Option.getOrUndefined(AsyncData.getData(editor.dryRun))
	if (result === undefined)
		return AsyncData.isFailure(editor.dryRun)
			? [
					h.div(
						[h.Class("flex items-center justify-between gap-2 text-muted-fg text-sm")],
						[
							"Couldn't check who it matches.",
							button(
								h,
								{ intent: "plain", size: "xs", onPress: Message.PressedRetryDryRun() },
								["Try again"],
							),
						],
					),
				]
			: [h.p([h.Class("text-muted-fg text-sm")], ["Checking who it matches…"])]
	// The first layout above that keeps some of them.
	const overlap = result.takenBy[0]
	const names = result.matching.slice(0, 5)
	return [
		h.span([h.Class("font-medium text-fg text-sm")], [matchSummary(result)]),
		...(names.length === 0
			? []
			: [
					h.div(
						[h.Class("flex flex-wrap items-center gap-1")],
						[
							...names.map((entry) =>
								h.span(
									[
										h.Key(entry.accountId),
										h.Class("rounded-md bg-secondary px-1.5 py-0.5 text-fg text-xs"),
									],
									[entry.name],
								),
							),
							...(result.matchingCount > names.length
								? [
										h.span(
											[h.Class("text-muted-fg text-xs")],
											[`and ${formatCount(result.matchingCount - names.length)} more`],
										),
									]
								: []),
						],
					),
				]),
		...(overlap === undefined
			? []
			: [
					h.div(
						[
							h.Role("note"),
							h.Class(
								"flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-subtle/40 p-3",
							),
						],
						[
							h.p(
								[h.Class("flex items-start gap-2 text-fg text-sm")],
								[
									IconWarning(h, {
										className: "mt-0.5 size-4 shrink-0 text-warning-subtle-fg",
									}),
									`${formatCount(overlap.count)} of them already get ${overlap.name}, which is higher in the order. They keep seeing ${overlap.name} unless this layout moves above it.`,
								],
							),
							h.div(
								[],
								[
									button(
										h,
										{
											intent: "outline",
											size: "xs",
											onPress: Message.PressedMoveAbove({ layoutId: overlap.layoutId }),
										},
										[
											IconArrowUp(h, { className: "size-3.5" }),
											`Move above ${overlap.name}`,
										],
									),
								],
							),
						],
					),
				]),
		...(result.pinnedElsewhere === 0
			? []
			: [
					h.p(
						[h.Class("text-muted-fg text-xs")],
						[
							`${formatCount(result.pinnedElsewhere)} ${result.pinnedElsewhere === 1 ? "is" : "are"} pinned to another layout.`,
						],
					),
				]),
	]
}

/** `Order: 3 of 5, after Trial onboarding`. */
const orderLine = (model: Model, editor: Editor): string => {
	const order = draftOrder(model, editor)
	const at = order.indexOf(editor.layoutId)
	const after = layoutById(model, order[at - 1] ?? null)?.name
	return `Order: ${at + 1} of ${order.length}${after === undefined ? ", first" : `, after ${after}`}`
}

// THE POPOVER

/** The meta bar's "Applies when" chips, opening the rule's popover. */
/** The rule as chips, read-only: what members see. */
export const ruleChipsView = (h: H, model: Model, draft: Customers.LayoutDraft): Html => {
	const chips = ruleChips(draft.rule, model.metrics ?? [], model.currency)
	return h.div(
		[h.Class("flex flex-wrap items-center gap-2 px-2 text-sm")],
		[
			h.span([h.Class("text-muted-fg")], ["Applies when"]),
			...(chips.length === 0 ? ["Every customer"] : chips).map((text) =>
				h.span(
					[h.Key(text), h.Class("rounded-md border border-border px-1.5 py-0.5 text-fg text-xs")],
					[text],
				),
			),
		],
	)
}

export const rulePopover = (h: H, model: Model, editor: Editor, draft: Customers.LayoutDraft): Html => {
	const { rule } = draft
	const chips = ruleChips(rule, model.metrics ?? [], model.currency)
	const setRule = (next: Customers.LayoutRule) => Message.EditedRule({ rule: next })
	const setCondition = (index: number) => (condition: Condition) =>
		setRule({ ...rule, conditions: rule.conditions.map((each, at) => (at === index ? condition : each)) })
	return h.submodel({
		slotId: model.rulePopover.id,
		model: model.rulePopover,
		view: Popover.view,
		viewInputs: {
			placement: "bottom start",
			className: "max-w-[min(36rem,calc(100vw-2rem))]",
			toTrigger: (attributes) =>
				button(h, { intent: "plain", size: "sm", attributes, className: "gap-2" }, [
					h.span([h.Class("text-muted-fg")], ["Applies when"]),
					...(chips.length === 0
						? [
								h.span(
									[h.Class("rounded-md border border-border px-1.5 py-0.5 text-xs")],
									["Every customer"],
								),
							]
						: chips.map((text) =>
								h.span(
									[
										h.Key(text),
										h.Class("rounded-md border border-primary/40 px-1.5 py-0.5 text-xs"),
									],
									[text],
								),
							)),
					h.span(
						[
							h.Class(
								"inline-flex items-center gap-1 rounded-md border border-border border-dashed px-1.5 py-0.5 text-muted-fg text-xs",
							),
						],
						[IconPlus(h, { className: "size-3" }), "Condition"],
					),
				]),
			toContent: (closeAttributes) => [
				h.div(
					[h.Class("flex w-[34rem] max-w-full flex-col")],
					[
						h.div(
							[h.Class("flex items-center justify-between gap-3 px-4 pt-4 pb-3")],
							[
								h.span([h.Class("font-semibold text-fg text-sm")], ["Who gets this layout"]),
								segmented(h, {
									ariaLabel: "Match",
									segments: [
										{ key: "all", label: "All match" },
										{ key: "any", label: "Any matches" },
									],
									selected: rule.match,
									onSelect: (match) => setRule({ ...rule, match }),
								}),
							],
						),
						h.div(
							[h.Class("flex flex-col gap-3 px-4 pb-3")],
							[
								...(rule.conditions.length === 0
									? [
											h.p(
												[h.Class("text-muted-fg text-sm")],
												[
													"No conditions: every customer gets it, unless a layout above takes them.",
												],
											),
										]
									: rule.conditions.map((condition, index) =>
											h.div(
												[
													h.Key(`condition-${index}`),
													h.Class("flex items-start gap-3"),
												],
												[
													h.span(
														[
															h.Class(
																"w-20 shrink-0 pt-1 font-medium text-fg text-sm",
															),
														],
														[CONDITION_LABEL[condition._tag]],
													),
													h.div(
														[h.Class("min-w-0 flex-1")],
														[
															conditionEditor(
																h,
																model,
																editor,
																condition,
																index,
																setCondition(index),
															),
														],
													),
													button(
														h,
														{
															intent: "plain",
															size: "xs",
															onPress: setRule({
																...rule,
																conditions: rule.conditions.filter(
																	(_, at) => at !== index,
																),
															}),
															attributes: [
																h.AriaLabel(
																	`Remove the ${CONDITION_LABEL[condition._tag]} condition`,
																),
															],
															className: "px-1",
														},
														[IconClose(h, icon)],
													),
												],
											),
										)),
								h.div(
									[h.Class("flex flex-wrap items-center gap-1")],
									[
										h.span(
											[
												h.Class(
													"mr-1 inline-flex items-center gap-1 font-medium text-primary text-sm",
												),
											],
											[IconPlus(h, { className: "size-3.5" }), "Add condition"],
										),
										...(
											Object.keys(CONDITION_LABEL) as ReadonlyArray<Condition["_tag"]>
										).map((tag) =>
											button(
												h,
												{
													intent: "outline",
													size: "xs",
													isDisabled: rule.conditions.length >= 20,
													onPress:
														rule.conditions.length >= 20
															? undefined
															: setRule({
																	...rule,
																	conditions: [
																		...rule.conditions,
																		newCondition(model, tag),
																	],
																}),
													attributes: [h.Key(tag)],
												},
												[CONDITION_LABEL[tag]],
											),
										),
									],
								),
							],
						),
						h.div(
							[h.Class("flex flex-col gap-2 border-border border-t px-4 py-3")],
							matches(h, model, editor),
						),
						h.div(
							[
								h.Class(
									"flex items-center justify-between gap-3 border-border border-t px-4 py-2.5",
								),
							],
							[
								h.span([h.Class("text-muted-fg text-xs")], [orderLine(model, editor)]),
								button(h, { intent: "outline", size: "xs", attributes: closeAttributes }, [
									"Done",
								]),
							],
						),
					],
				),
			],
		},
		toParentMessage: (message: Popover.Message) => Message.GotRulePopoverMessage({ message }),
	})
}
