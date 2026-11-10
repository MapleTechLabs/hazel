import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { formatCount } from "../../../../customers/format"
import { STAGE_LABEL } from "../../../../customers/ui/badges"
import { IconClose, IconPlus } from "../../../../icons"
import { button } from "../../../../ui/button"
import { inputGroup, inputElement } from "../../../../ui/input"
import { switchControl } from "../../../../ui/switch"
import { evaluatedAccounts, isInScope, planNamesOf, scopeOf } from "./draft"
import { Message } from "./message"
import { currencyOf, type Model, type RuleForm, type ScopeCondition } from "./model"
import { card, errorIdOf, fieldError, toggleChip } from "./parts"

/**
 * "Applies to": the rule's scope as removable conditions (stage any of, plan any of, MRR at least,
 * tags any of) plus paying only, with how many synced accounts it covers (`evaluate.ts` `inScope`).
 */

type H = HtmlBuilder<Message>

/** Churned accounts are never evaluated, so they are not offered. */
const STAGES: ReadonlyArray<Customers.LifecycleStage> = ["lead", "trialing", "active", "past_due"]

const MRR_ID = "signal-rule-min-mrr"

const toMrr = (value: string) => Message.ChangedScopeMrr({ value })
const toPayingOnly = (isOn: boolean) => Message.ToggledPayingOnly({ isOn })

const CONDITION_LABEL = {
	stage: "Stage",
	plan: "Plan",
	mrr: "MRR",
	tags: "Tags",
} as const satisfies Record<ScopeCondition, string>

const conditionRow = (
	h: H,
	options: Readonly<{
		index: number
		condition: ScopeCondition
		operator: string
		isAdmin: boolean
		value: ReadonlyArray<Html>
	}>,
): Html =>
	h.div(
		[h.Class("grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-3 py-2")],
		[
			h.span([h.Class("pt-1.5 text-muted-fg text-sm")], [options.index === 0 ? "Where" : "and"]),
			h.div(
				[h.Class("flex flex-col gap-2")],
				[
					h.span(
						[h.Class("pt-1.5 text-fg text-sm")],
						[
							h.span([h.Class("font-medium")], [CONDITION_LABEL[options.condition]]),
							` ${options.operator}`,
						],
					),
					...options.value,
				],
			),
			...(options.isAdmin
				? [
						button(
							h,
							{
								intent: "plain",
								size: "sq-xs",
								onPress: Message.RemovedScopeCondition({ condition: options.condition }),
								attributes: [
									h.AriaLabel(`Remove the ${CONDITION_LABEL[options.condition]} condition`),
								],
							},
							[IconClose(h, { attributes: { "data-slot": "icon" } })],
						),
					]
				: []),
		],
	)

const chips = (h: H, children: ReadonlyArray<Html>): Html =>
	h.div([h.Class("flex flex-wrap items-center gap-1.5")], [...children])

const mrrInput = (
	h: H,
	scope: RuleForm["scope"],
	error: string | undefined,
	isAdmin: boolean,
): ReadonlyArray<Html> => [
	inputGroup(h, { className: "w-44", isInvalid: error !== undefined, isDisabled: !isAdmin }, [
		h.span([h.DataAttribute("slot", "text"), h.Class("text-muted-fg")], ["$"]),
		inputElement(h, {
			isInvalid: error !== undefined,
			isDisabled: !isAdmin,
			className: "tabular-nums",
			attributes: [
				h.Id(MRR_ID),
				h.AriaLabel("Minimum MRR per month"),
				h.InputMode("decimal"),
				h.Value(scope.minMrr ?? ""),
				h.OnInput(toMrr),
				...(error === undefined ? [] : [h.AriaDescribedBy(errorIdOf(MRR_ID))]),
			],
		}),
		h.span([h.DataAttribute("slot", "text"), h.Class("text-muted-fg text-xs")], ["per month"]),
	]),
	...fieldError(h, MRR_ID, error),
]

export const scopeCard = (
	h: H,
	options: Readonly<{
		model: Model
		form: RuleForm
		errors: Readonly<Record<string, string>>
		isAdmin: boolean
	}>,
): Html => {
	const { model, form, isAdmin } = options
	const scope = form.scope
	const accounts = evaluatedAccounts(model.accounts ?? [])
	const ruleScope = scopeOf(scope, currencyOf(model))
	const inScope = accounts.filter((account) => isInScope(ruleScope, account)).length
	const plans = [...new Set([...planNamesOf(accounts), ...(scope.plans ?? [])])]
	const conditions: ReadonlyArray<
		Readonly<{ condition: ScopeCondition; operator: string; value: ReadonlyArray<Html> }>
	> = [
		...(scope.stages === null
			? []
			: [
					{
						condition: "stage" as const,
						operator: "is any of",
						value: [
							chips(
								h,
								STAGES.map((stage) =>
									toggleChip(h, {
										label: STAGE_LABEL[stage],
										isPressed: scope.stages?.includes(stage) ?? false,
										isDisabled: !isAdmin,
										onPress: Message.ToggledScopeStage({ stage }),
									}),
								),
							),
						],
					},
				]),
		...(scope.plans === null
			? []
			: [
					{
						condition: "plan" as const,
						operator: "is any of",
						value: [
							plans.length === 0
								? h.span([h.Class("text-muted-fg text-sm")], ["No plans synced yet"])
								: chips(
										h,
										plans.map((plan) =>
											toggleChip(h, {
												label: plan,
												isPressed: scope.plans?.includes(plan) ?? false,
												isDisabled: !isAdmin,
												onPress: Message.ToggledScopePlan({ plan }),
											}),
										),
									),
						],
					},
				]),
		...(scope.minMrr === null
			? []
			: [
					{
						condition: "mrr" as const,
						operator: "is at least",
						value: mrrInput(h, scope, options.errors["scope.minMrr"], isAdmin),
					},
				]),
		...(scope.tags.length === 0
			? []
			: [
					{
						condition: "tags" as const,
						operator: "is any of",
						value: [
							chips(
								h,
								scope.tags.map((tag) =>
									h.span(
										[h.Class("rounded-md border border-border px-2 py-0.5 text-sm")],
										[tag],
									),
								),
							),
						],
					},
				]),
	]
	const addable = (["stage", "plan", "mrr"] as const).filter(
		(condition) =>
			(condition === "stage" && scope.stages === null) ||
			(condition === "plan" && scope.plans === null) ||
			(condition === "mrr" && scope.minMrr === null),
	)
	return card(
		h,
		{
			title: "Applies to",
			aside: h.span(
				[h.Class("text-muted-fg text-xs tabular-nums")],
				[
					model.accounts === null
						? "Counting accounts…"
						: `${formatCount(inScope)} of ${formatCount(accounts.length)} accounts in scope`,
				],
			),
		},
		[
			conditions.length === 0
				? h.p([h.Class("text-muted-fg text-sm")], ["Every account that hasn't churned."])
				: h.div(
						[h.Class("flex flex-col divide-y divide-border")],
						conditions.map((condition, index) =>
							conditionRow(h, { ...condition, index, isAdmin }),
						),
					),
			...(isAdmin && addable.length > 0
				? [
						h.div(
							[h.Class("flex flex-wrap items-center gap-1.5")],
							addable.map((condition) =>
								button(
									h,
									{
										intent: "outline",
										size: "xs",
										onPress: Message.AddedScopeCondition({ condition }),
									},
									[
										IconPlus(h, { attributes: { "data-slot": "icon" } }),
										CONDITION_LABEL[condition],
									],
								),
							),
						),
					]
				: []),
			switchControl(
				h,
				{
					id: "signal-rule-paying-only",
					isSelected: scope.payingOnly,
					isDisabled: !isAdmin,
					onChange: toPayingOnly,
				},
				"Only paying customers (MRR above zero, or trialing)",
			),
		],
	)
}
