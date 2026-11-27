// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * "Applies to" (today's `scope-view.ts`): the rule's scope as removable conditions (stage any of,
 * plan any of, MRR at least, tags any of) plus paying only, with how many synced accounts it covers.
 */
import type * as Customers from "@hazel/domain/customers"
import { type Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { currencySymbol, formatCount } from "../../data/format"
import { STAGE_LABEL } from "../../ui/badges"
import { evaluatedAccounts, isInScope, planNamesOf, scopeOf } from "./draft"
import { type EditorContext, RuleEditorMessage } from "./editor-state"
import type { ScopeCondition } from "./model"
import { panel } from "./parts"

type H = Hazel.H<RuleEditorMessage>

/** Churned accounts are never evaluated, so they are not offered. */
const STAGES: ReadonlyArray<Customers.LifecycleStage> = ["lead", "trialing", "active", "past_due"]

const CONDITION_LABEL = {
	stage: "Stage",
	plan: "Plan",
	mrr: "MRR",
	tags: "Tags",
} as const satisfies Record<ScopeCondition, string>

// HAZEL-GAP(pk7-scope-row): today each condition is a three-column row (`Where`/`and`, the condition, the remove mark).
const conditionRow = (
	h: H,
	options: Readonly<{
		index: number
		condition: ScopeCondition
		operator: string
		isAdmin: boolean
		value: Hazel.NoTextInput<RuleEditorMessage>
	}>,
) =>
	h.stack
		.key(options.condition)
		.axis("horizontal")
		.align("start")
		.density("cozy")
		.children(
			h.text.tone("muted").children(options.index === 0 ? "Where" : "and"),
			h.stack
				.density("compact")
				.children(
					h.text.children(
						h.text.strong().children(CONDITION_LABEL[options.condition]),
						` ${options.operator}`,
					),
					options.value,
				),
			h.spacer,
			options.isAdmin
				? h.button
						.label(`Remove the ${CONDITION_LABEL[options.condition]} condition`)
						.icon("close")
						.iconOnly()
						.variant("ghost")
						.size("xsmall")
						.on(
							"press",
							RuleEditorMessage.PressedRemoveCondition({ condition: options.condition }),
						)
				: null,
		)

const chips = <A extends string>(
	h: H,
	options: Readonly<{
		label: string
		values: ReadonlyArray<A>
		labelOf: (value: A) => string
		selected: ReadonlyArray<A>
		isDisabled: boolean
		onChange: (selected: ReadonlyArray<A>) => RuleEditorMessage
	}>,
) =>
	h.choiceGroup
		.label(options.label)
		.labelHidden()
		.style("chips")
		.multiple()
		.options(options.values.map((value) => ({ value, label: options.labelOf(value) })))
		.selected(options.selected)
		.disabled(options.isDisabled)
		.on("change", ({ selected }) =>
			options.onChange(options.values.filter((value) => selected.includes(value))),
		)

export const scopeCard = (h: H, context: EditorContext) => {
	const { model, form, isAdmin } = context
	const scope = form.scope
	const currency = model.settings?.reportingCurrency ?? "USD"
	const accounts = evaluatedAccounts(model.accounts ?? [])
	const ruleScope = scopeOf(scope, currency)
	const inScope = accounts.filter((account) => isInScope(ruleScope, account)).length
	const plans = [...new Set([...planNamesOf(accounts), ...(scope.plans ?? [])])]
	const conditions: ReadonlyArray<{
		condition: ScopeCondition
		operator: string
		value: Hazel.NoTextInput<RuleEditorMessage>
	}> = [
		...(scope.stages === null
			? []
			: [
					{
						condition: "stage" as const,
						operator: "is any of",
						value: chips(h, {
							label: "Stages",
							values: STAGES,
							labelOf: (stage) => STAGE_LABEL[stage],
							selected: scope.stages,
							isDisabled: !isAdmin,
							onChange: (stages) => RuleEditorMessage.PickedScopeStages({ stages }),
						}),
					},
				]),
		...(scope.plans === null
			? []
			: [
					{
						condition: "plan" as const,
						operator: "is any of",
						value:
							plans.length === 0
								? h.text.tone("muted").children("No plans synced yet")
								: chips(h, {
										label: "Plans",
										values: plans,
										labelOf: (plan) => plan,
										selected: scope.plans,
										isDisabled: !isAdmin,
										onChange: (picked) =>
											RuleEditorMessage.PickedScopePlans({ plans: picked }),
									}),
					},
				]),
		...(scope.minMrr === null
			? []
			: [
					{
						condition: "mrr" as const,
						operator: "is at least",
						value: h.textField
							.label("Minimum MRR per month")
							.inputKind("number")
							.prefix(currencySymbol(currency))
							.suffix("per month")
							.value(model.fields["scope.minMrr"] ?? TextField.empty)
							.error(context.errors["scope.minMrr"])
							.disabled(!isAdmin)
							.on("change", (payload) =>
								RuleEditorMessage.ChangedField({ key: "scope.minMrr", payload }),
							),
					},
				]),
		...(scope.tags.length === 0
			? []
			: [
					{
						condition: "tags" as const,
						operator: "is any of",
						value: h.stack
							.axis("horizontal")
							.wrap()
							.density("snug")
							.children(
								...scope.tags.map((tag) => h.badge.key(tag).style("outline").label(tag)),
							),
					},
				]),
	]
	const addable = (["stage", "plan", "mrr"] as const).filter(
		(condition) =>
			(condition === "stage" && scope.stages === null) ||
			(condition === "plan" && scope.plans === null) ||
			(condition === "mrr" && scope.minMrr === null),
	)
	return panel(
		h,
		{
			key: "scope",
			title: "Applies to",
			aside: h.text
				.role("caption")
				.tone("muted")
				.numeric()
				.children(
					model.accounts === null
						? "Counting accounts…"
						: `${formatCount(inScope)} of ${formatCount(accounts.length)} accounts in scope`,
				),
		},
		conditions.length === 0
			? h.text.key("all").tone("muted").children("Every account that hasn't churned.")
			: h.stack
					.key("conditions")
					.density("regular")
					.children(
						...conditions.map((condition, index) =>
							conditionRow(h, { ...condition, index, isAdmin }),
						),
					),
		isAdmin && addable.length > 0
			? h.stack
					.key("add")
					.axis("horizontal")
					.wrap()
					.density("snug")
					.children(
						...addable.map((condition) =>
							h.button
								.key(condition)
								.label(CONDITION_LABEL[condition])
								.icon("plus")
								.variant("outline")
								.size("xsmall")
								.on("press", RuleEditorMessage.PressedAddCondition({ condition })),
						),
					)
			: null,
		h.toggle
			.key("paying")
			.label("Only paying customers (MRR above zero, or trialing)")
			.checked(scope.payingOnly)
			.disabled(!isAdmin)
			.on("change", ({ checked }) => RuleEditorMessage.ToggledPayingOnly({ checked })),
	)
}
