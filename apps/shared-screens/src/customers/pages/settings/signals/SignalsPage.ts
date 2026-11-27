// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/customers/settings/signals` (today's `page/customers/settings/signals` list, Wonder
 * `now`), and `…/signals/new` with the template picker open: what is on, what each rule looks for,
 * what it matches now, and who Needs attention covers.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { requiredSourcesOf } from "@hazel/customer-integrations"
import * as Customers from "@hazel/domain/customers"
import { CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Option, Schema } from "effect"
import { Navigate, ShowToast } from "../../../../app/requests"
import { Session } from "../../../../app/session"
import { CommonReason, commonCopy, copyOf, errorToast, reasonOf } from "../../../../modals/feedback"
import { modalServices } from "../../../../modals/services"
import { formatCount, formatDate, formatRelative } from "../../../data/format"
import { PROVIDER_ORDER, providerOf, sourcesLabel } from "../../../data/providers"
import { AccountRow, SettingsSummary, SignalRow } from "../../../data/queries"
import { KIND_LABEL, kindChip, NO_VALUE, severityChip, STAGE_LABEL } from "../../../ui/badges"
import { sourceLogoSrc } from "../../../ui/identity"
import { makeSignalRuleActions, type SignalsFeeds, signalsFeed } from "../../../settings/signals/data"
import { conditionParts, plainText, scopeSummary } from "../../../settings/signals/describe"
import { configFormOf, draftOfRule } from "../../../settings/signals/draft"
import {
	AttentionRow,
	isAvailable,
	isCustomersAdmin,
	MetricRow,
	RuleRow,
	ruleById,
	TEMPLATE_ORDER,
} from "../../../settings/signals/model"
import { panel, readOnlyNotice, ruleHref, sourceHref, templateTile } from "../../../settings/signals/parts"
import { TemplatePicker } from "../../../settings/signals/TemplatePicker"

export const SignalsPageProps = Schema.Struct({
	session: Session,
	/** `…/signals/new` without a template: the picker opens with the page. */
	pickerOpen: Schema.Boolean,
	nowMs: Schema.Finite,
})
export type SignalsPageProps = typeof SignalsPageProps.Type

export const SignalsPageModel = Schema.Struct({
	/** Live rows; null until each query answers. */
	rules: Schema.NullOr(Schema.Array(RuleRow)),
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	providers: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
	settings: Schema.NullOr(SettingsSummary),
	metrics: Schema.Array(MetricRow),
	/** Null until the settings row syncs. */
	attention: Schema.NullOr(AttentionRow),
	/** One save at a time, so saves cannot land out of order. */
	isSavingAttention: Schema.Boolean,
	pickerOpen: Schema.Boolean,
})
export type SignalsPageModel = typeof SignalsPageModel.Type

/** A switch's failure: the rule is gone, or the store refused it. */
export const ToggleFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type ToggleFailure = typeof ToggleFailure.Type

export const SignalsPageMessage = UiSchema.TaggedEnum({
	UpdatedRules: { rules: Schema.Array(RuleRow) },
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsSummary) },
	UpdatedMetrics: { metrics: Schema.Array(MetricRow) },
	UpdatedAttention: { attention: Schema.NullOr(AttentionRow) },
	PickedAttentionStages: { stages: Schema.Array(Schema.String) },
	PickedAttentionSources: { sources: Schema.Array(Schema.String) },
	FailedSaveAttention: { reason: CommonReason },
	SucceededSaveAttention: {},
	ToggledRule: { ruleId: CustomerSignalRuleId, enabled: Schema.Boolean },
	FailedToggleRule: { ruleId: CustomerSignalRuleId, enabled: Schema.Boolean, reason: ToggleFailure },
	PressedRule: { ruleId: CustomerSignalRuleId },
	PressedNewSignal: {},
	ClosedPicker: {},
})
export type SignalsPageMessage = typeof SignalsPageMessage.Type

// COMMANDS

/** Every failure a write did not name reads as its common reason. */
// BOUNDARY: transport, auth and the server's catch-alls all collapse here.
const commonReason = (cause: Cause.Cause<unknown>) =>
	reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause)))

/** The list's switch: the saved rule with `enabled` flipped (the collection confirms or rolls back). */
export class ToggleSignalRule extends Command.Service<ToggleSignalRule>()(
	"hazel/customers/ToggleSignalRule",
	{
		args: { organizationId: OrganizationId, ruleId: CustomerSignalRuleId, rule: Customers.RuleDraft },
		success: Schema.Union([SignalsPageMessage, Component.Noop]),
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const actions = makeSignalRuleActions(data)
			return (args) => {
				const failed = (reason: ToggleFailure) =>
					SignalsPageMessage.FailedToggleRule({
						ruleId: args.ruleId,
						enabled: args.rule.enabled,
						reason,
					})
				return run(
					actions.updateRule(args).pipe(
						Effect.as(Component.noop),
						Effect.catchTags({
							CustomersNotFoundError: () => Effect.succeed(failed("NotFound")),
							CustomersInvalidRequestError: () => Effect.succeed(failed("Invalid")),
						}),
						Effect.catchCause((cause) => Effect.succeed(failed(commonReason(cause)))),
					),
				)
			}
		}),
	)
}

/** Who Needs attention covers; the next compute closes or opens signals to match. */
export class SaveAttention extends Command.Service<SaveAttention>()("hazel/customers/SaveAttention", {
	args: {
		organizationId: OrganizationId,
		settingsId: AttentionRow.fields.settingsId,
		attention: Customers.AttentionSettings,
	},
	success: SignalsPageMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const actions = makeSignalRuleActions(data)
			return (args) =>
				run(
					actions.saveAttention(args).pipe(
						Effect.as(SignalsPageMessage.SucceededSaveAttention()),
						Effect.catchCause((cause) =>
							Effect.succeed(
								SignalsPageMessage.FailedSaveAttention({ reason: commonReason(cause) }),
							),
						),
					),
				)
		}),
	)
}

// PAGE

const SignalsPageDef = Hazel.component({
	name: "SignalsPage",
	props: SignalsPageProps,
	model: SignalsPageModel,
	message: SignalsPageMessage,
	restore: (model) => ({ ...model, isSavingAttention: false }),
})

type H = Parameters<Parameters<typeof SignalsPageDef.make>[0]["view"]>[0]

const withRuleEnabled = (model: SignalsPageModel, ruleId: CustomerSignalRuleId, enabled: boolean) =>
	model.rules?.map((rule) => (rule.id === ruleId ? { ...rule, enabled } : rule)) ?? null

const isStage = Schema.is(Customers.AttentionStage)
const isProvider = Schema.is(Customers.CustomerProvider)

/** An admin's change to who Needs attention covers, saved at once. */
const savedAttention = (change: (attention: Customers.AttentionSettings) => Customers.AttentionSettings) =>
	SignalsPageDef.update(($) => {
		const { attention: row, isSavingAttention } = $.model
		const organizationId = $.props.session.organization?.id
		if (
			row === null ||
			organizationId === undefined ||
			isSavingAttention ||
			!isCustomersAdmin($.props.session.member?.role)
		)
			return $.model
		const attention = change(row.attention)
		return $.evolve({ attention: { ...row, attention }, isSavingAttention: true }).run(
			SaveAttention.make({ organizationId, settingsId: row.settingsId, attention }),
		)
	})

export const SignalsPageNoDeps = SignalsPageDef.make({
	init: ({ props }) => ({
		rules: null,
		signals: null,
		accounts: null,
		providers: null,
		settings: null,
		metrics: [],
		attention: null,
		isSavingAttention: false,
		pickerOpen: props.pickerOpen,
	}),
	update: {
		UpdatedRules: ($, { rules }) => $.evolve({ rules }),
		UpdatedSignals: ($, { signals }) => $.evolve({ signals }),
		UpdatedAccounts: ($, { accounts }) => $.evolve({ accounts }),
		UpdatedProviders: ($, { providers }) => $.evolve({ providers }),
		UpdatedSettings: ($, { settings }) => $.evolve({ settings }),
		UpdatedMetrics: ($, { metrics }) => $.evolve({ metrics }),
		UpdatedAttention: ($, { attention }) => $.evolve({ attention }),
		PickedAttentionStages: ($, { stages }) =>
			$.combine(savedAttention((attention) => ({ ...attention, stages: stages.filter(isStage) }))),
		PickedAttentionSources: ($, { sources }) =>
			$.combine(
				savedAttention((attention) => ({
					...attention,
					requiredSources: sources.filter(isProvider),
				})),
			),
		SucceededSaveAttention: ($) => $.evolve({ isSavingAttention: false }),
		// The collection rolls the row back, and the stream with it.
		FailedSaveAttention: ($, { reason }) =>
			$.evolve({ isSavingAttention: false }).run(
				ShowToast.make({ toast: errorToast(commonCopy(reason)) }),
			),
		ToggledRule: ($, { ruleId, enabled }) => {
			const rule = ruleById($.model.rules, ruleId)
			const organizationId = $.props.session.organization?.id
			if (rule === undefined || organizationId === undefined) return $.model
			return $.evolve({ rules: withRuleEnabled($.model, ruleId, enabled) }).run(
				ToggleSignalRule.make({ organizationId, ruleId, rule: draftOfRule(rule, enabled) }),
			)
		},
		FailedToggleRule: ($, { ruleId, enabled, reason }) => {
			const title = `Couldn't turn the rule ${enabled ? "on" : "off"}`
			return $.evolve({ rules: withRuleEnabled($.model, ruleId, !enabled) }).run(
				ShowToast.make({
					toast: errorToast(
						copyOf(reason, {
							NotFound: { title, description: "The rule was deleted in the meantime." },
							Invalid: { title, description: "Check the rule's settings and try again." },
						}),
					),
				}),
			)
		},
		PressedRule: ($, { ruleId }) =>
			$.run(Navigate.make({ href: ruleHref($.props.session.orgSlug ?? "", ruleId), replace: false })),
		PressedNewSignal: ($) => $.evolve({ pickerOpen: true }),
		ClosedPicker: ($) => $.evolve({ pickerOpen: false }),
	},
	subscriptions: ({ props }) => {
		const organizationId = props.session.organization?.id ?? null
		const feeds: SignalsFeeds<SignalsPageMessage> = {
			rules: (rules) => SignalsPageMessage.UpdatedRules({ rules }),
			signals: (signals) => SignalsPageMessage.UpdatedSignals({ signals }),
			accounts: (accounts) => SignalsPageMessage.UpdatedAccounts({ accounts }),
			providers: (providers) => SignalsPageMessage.UpdatedProviders({ providers }),
			settings: (settings) => SignalsPageMessage.UpdatedSettings({ settings }),
			metrics: (metrics) => SignalsPageMessage.UpdatedMetrics({ metrics }),
			attention: (attention) => SignalsPageMessage.UpdatedAttention({ attention }),
		}
		return organizationId === null
			? []
			: (
					["rules", "signals", "accounts", "providers", "settings", "metrics", "attention"] as const
				).map((feed) =>
					Subscription.make(feed, [organizationId], ([id]) =>
						signalsFeed<SignalsPageMessage>(id, feed, feeds),
					),
				)
	},
	view: (h, model) => {
		const { session } = h.props
		const isAdmin = isCustomersAdmin(session.member?.role)
		const rules = [...(model.rules ?? [])].sort(
			(left, right) => TEMPLATE_ORDER.indexOf(left.template) - TEMPLATE_ORDER.indexOf(right.template),
		)
		const accounts = model.accounts?.length ?? 0
		// HAZEL-GAP(p4-screen-page-column): today is a padded, width-capped column under a display title; `page` is the phone bar.
		return h.screen
			.key("signals")
			.surface("page")
			.title("Signals")
			.subtitle(
				`Rules that put customers in Needs attention. Checked every hour against all ${formatCount(accounts)} accounts, including silent ones.`,
			)
			.toolbar(
				isAdmin
					? h.button
							.label("New signal")
							.icon("plus")
							.on("press", SignalsPageMessage.PressedNewSignal())
					: null,
			)
			.children(
				h.stack
					.key("body")
					.inset("page")
					.density("relaxed")
					.children(
						isAdmin ? null : readOnlyNotice(h, "signal rules"),
						...(model.rules === null
							? [
									h.frame
										.key("loading")
										.children(h.progress.style("spinner").label("Loading rules…")),
								]
							: [
									summary(h, model, rules),
									model.attention === null
										? null
										: attentionCard(
												h,
												model.attention,
												!isAdmin || model.isSavingAttention,
											),
									group(h, model, "risk", rules),
									group(h, model, "opportunity", rules),
									h.text
										.key("footnote")
										.role("caption")
										.tone("muted")
										.children(
											"Each account gets at most one open item per rule. When the condition clears, the item resolves itself. Dismissed items only come back if the evidence gets worse.",
										),
								]),
					),
				model.pickerOpen
					? TemplatePicker(h, {
							props: {
								orgSlug: session.orgSlug ?? "",
								rules: model.rules ?? [],
								providers: model.providers,
							},
							onEmit: { RequestedClose: () => SignalsPageMessage.ClosedPicker() },
						})
					: null,
			)
	},
})

// SUMMARY

// HAZEL-GAP(pk7-summary-runs): today each figure is a semibold run inside its muted line, and "Last checked" sits at the row's end.
const summary = (h: H, model: SignalsPageModel, rules: ReadonlyArray<RuleRow>) => {
	const enabled = rules.filter((rule) => rule.enabled)
	const signals = model.signals ?? []
	const countOf = (status: Customers.SignalStatus) =>
		signals.filter((signal) => signal.status === status).length
	const accounts = new Set(
		signals
			.filter((signal) => signal.status === "open" || signal.status === "snoozed")
			.map((signal) => signal.accountId),
	).size
	const matches = enabled.reduce((sum, rule) => sum + rule.matchingCount, 0)
	const lastComputed = model.settings?.lastComputedAtMs ?? null
	const item = (key: string, strong: string, rest: string) =>
		h.text.key(key).tone("muted").children(h.text.strong().numeric().children(strong), ` ${rest}`)
	return h.frame.key("summary").children(
		h.stack
			.axis("horizontal")
			.wrap()
			.align("center")
			.density("relaxed")
			.children(
				item("on", `${enabled.length} of ${rules.length}`, "rules on"),
				item("matches", formatCount(matches), `matches across ${formatCount(accounts)} accounts`),
				item(
					"status",
					`${formatCount(countOf("open"))} open`,
					`· ${formatCount(countOf("snoozed"))} snoozed · ${formatCount(countOf("dismissed"))} dismissed`,
				),
				h.spacer,
				h.text
					.key("checked")
					.tone("muted")
					.children(
						lastComputed === null
							? "Not checked yet"
							: `Last checked ${formatRelative(new Date(lastComputed), new Date(h.props.nowMs))}`,
					),
			),
	)
}

// WHO NEEDS ATTENTION

// HAZEL-GAP(pk7-attention-field-row): today each field's label and hint sit in a 10rem column beside its chips.
const attentionCard = (h: H, row: AttentionRow, isDisabled: boolean) => {
	const { stages, requiredSources } = row.attention
	return panel(
		h,
		{
			key: "attention",
			title: "Who needs attention",
			description:
				"Rules only look at these customers; the others never show up in Needs attention. A customer that churns gets one last entry, Churned, and nothing after it.",
		},
		h.choiceGroup
			.key("stages")
			.label("Stages")
			.description("None picked: only churn entries")
			.style("chips")
			.multiple()
			.options(
				Customers.AttentionStage.literals.map((stage) => ({
					value: stage,
					label: STAGE_LABEL[stage],
				})),
			)
			.selected(stages)
			.disabled(isDisabled)
			.on("change", ({ selected }) => SignalsPageMessage.PickedAttentionStages({ stages: selected })),
		h.choiceGroup
			.key("sources")
			.label("Has a record in")
			.description("Any of these; none picked: any customer")
			.style("chips")
			.multiple()
			.options(
				PROVIDER_ORDER.map((provider) => ({ value: provider, label: providerOf(provider).name })),
			)
			.selected(requiredSources)
			.disabled(isDisabled)
			.on("change", ({ selected }) => SignalsPageMessage.PickedAttentionSources({ sources: selected })),
	)
}

// RULES

const GROUP_BLURB = {
	risk: "accounts likely to churn or contract",
	opportunity: "accounts ready to expand",
} as const satisfies Record<Customers.SignalKind, string>

// HAZEL-GAP(pk7-table-container-columns): today the severity, scope and matching columns show only from a 56rem card (`@4xl`), not by window size.
const COLUMNS = [
	{ key: "on", label: "On", width: "narrow" },
	{ key: "rule", label: "Rule", width: "fill" },
	{ key: "severity", label: "Severity", width: "regular", optional: true },
	{ key: "scope", label: "Applies to", width: "regular", optional: true },
	{ key: "matching", label: "Matching now", align: "end", width: "regular", optional: true },
	{ key: "last", label: "Last triggered", align: "end", width: "regular" },
] as const

/** "Matching now" and "Last triggered", or what the rule waits for. */
const statusCells = (h: H, model: SignalsPageModel, rule: RuleRow) => {
	const orgSlug = h.props.session.orgSlug ?? ""
	const cell = (column: string, ...content: ReadonlyArray<Hazel.NoTextInput<SignalsPageMessage>>) =>
		h.tableCell
			.key(column)
			.column(column)
			.children(...content)
	if (!isAvailable(model.providers, rule.template)) {
		const required = requiredSourcesOf(rule.template)
		const first = required[0]
		// HAZEL-GAP(pk7-requires-span): today "Requires <sources> Connect" spans the last two columns.
		return [
			cell(
				"matching",
				h.stack
					.axis("horizontal")
					.align("center")
					.density("compact")
					.children(
						h.text.tone("muted").children("Requires"),
						h.badge
							.style("outline")
							.image(first === undefined ? undefined : sourceLogoSrc(first))
							.label(sourcesLabel(required)),
					),
			),
			cell(
				"last",
				first === undefined ? null : h.link.label("Connect").href(sourceHref(orgSlug, first)),
			),
		]
	}
	const matching = !rule.enabled
		? h.text.tone("muted").children(NO_VALUE)
		: rule.matchingCount === 0
			? h.text.tone("muted").children("None")
			: h.link
					.label(
						`${formatCount(rule.matchingCount)} ${rule.matchingCount === 1 ? "account" : "accounts"}`,
					)
					.href(`/${orgSlug}/customers/attention`)
	const now = new Date(h.props.nowMs)
	const last = !rule.enabled
		? `Off since ${formatDate(new Date(rule.updatedAtMs), { now })}`
		: rule.lastTriggeredAtMs === null
			? "Never"
			: formatRelative(new Date(rule.lastTriggeredAtMs), now)
	return [cell("matching", matching), cell("last", h.text.tone("muted").numeric().children(last))]
}

// HAZEL-GAP(pk7-row-dim): today an off rule's cells fade to 60%; here its name only reads muted.
const ruleRow = (h: H, model: SignalsPageModel, rule: RuleRow) => {
	const isAdmin = isCustomersAdmin(h.props.session.member?.role)
	const metricName = (key: string) => model.metrics.find((metric) => metric.key === key)?.name ?? key
	const description = plainText(conditionParts(rule.template, configFormOf(rule.config), metricName))
	const currency = model.settings?.reportingCurrency ?? "USD"
	return h.tableRow
		.key(rule.id)
		.title(rule.name)
		.on("press", SignalsPageMessage.PressedRule({ ruleId: rule.id }))
		.children(
			h.tableCell
				.key("on")
				.column("on")
				.children(
					// HAZEL-GAP(pk7-toggle-hidden-label): today the switch is named "<rule> on" for assistive tech only.
					h.toggle
						.checked(rule.enabled)
						.disabled(!isAdmin)
						.on("change", ({ checked }) =>
							SignalsPageMessage.ToggledRule({ ruleId: rule.id, enabled: checked }),
						),
				),
			h.tableCell
				.key("rule")
				.column("rule")
				.children(
					h.stack
						.axis("horizontal")
						.align("center")
						.density("cozy")
						.children(
							templateTile(h, rule.template),
							h.stack.density("none").children(
								h.text
									.strong()
									.truncate()
									.tone(rule.enabled ? "default" : "muted")
									.children(rule.name),
								h.text.role("caption").tone("muted").children(description),
							),
						),
				),
			h.tableCell
				.key("severity")
				.column("severity")
				.children(h.stack.axis("horizontal").children(severityChip(h, rule.severity))),
			h.tableCell
				.key("scope")
				.column("scope")
				.children(h.text.truncate().children(scopeSummary(rule.scope, currency))),
			...statusCells(h, model, rule),
		)
}

const group = (h: H, model: SignalsPageModel, kind: Customers.SignalKind, all: ReadonlyArray<RuleRow>) => {
	const rules = all.filter((rule) => rule.kind === kind)
	return rules.length === 0
		? null
		: h.stack
				.key(kind)
				.density("compact")
				.children(
					h.stack
						.axis("horizontal")
						.align("center")
						.density("compact")
						.children(
							kindChip(h, kind),
							h.text
								.tone("muted")
								.children(
									`${rules.length} ${rules.length === 1 ? "rule" : "rules"} · ${GROUP_BLURB[kind]}`,
								),
						),
					h.table
						.label(`${KIND_LABEL[kind]} rules`)
						.frame("card")
						.columns(COLUMNS)
						.children(...rules.map((rule) => ruleRow(h, model, rule))),
				)
}

/** The page with its writes, on the host's data and RPC client. */
export const SignalsPage = SignalsPageNoDeps.pipe(
	Component.provide(Layer.mergeAll(ToggleSignalRule.layer, SaveAttention.layer)),
)
