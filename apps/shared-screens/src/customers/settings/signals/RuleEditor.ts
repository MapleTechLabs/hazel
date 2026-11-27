// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The rule editor (today's `page/customers/settings/signals` editor, Wonder `ati`, `mia`): the rule,
 * its condition and scope in words, saving, closing with unsaved changes and deleting. The live
 * preview is lane PK7b's, drawn through `rulePreview` (`preview.ts`) from what the editor holds.
 */
import { Command, Component, Subscription } from "@effect/ui"
import * as Customers from "@hazel/domain/customers"
import { CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Option } from "effect"
import { Navigate, ShowToast } from "../../../app/requests"
import { copyOf, errorToast, reasonOf } from "../../../modals/feedback"
import { modalServices } from "../../../modals/services"
import { formatCount, formatDate } from "../../data/format"
import type { AccountRow, SettingsSummary, SignalRow } from "../../data/queries"
import { kindChip } from "../../ui/badges"
import { conditionCards } from "./ConditionCards"
import { makeSignalRuleActions, type SignalsFeeds, signalsFeed } from "./data"
import { plainWords, renderParts } from "./describe"
import { editorStatus, formOfRule, formOfTemplate, scopeOf } from "./draft"
import { RuleEditorMessage, RuleEditorModel, RuleEditorProps, type RuleWriteFailure } from "./editor-state"
import {
	isCustomersAdmin,
	type MetricRow,
	type RuleForm,
	type RuleRow,
	ruleById,
	type ScopeCondition,
} from "./model"
import { panel, readOnlyNotice, ruleHref, severityPicker, signalsHref } from "./parts"
import { rulePreview } from "./preview"
import { scopeCard } from "./ScopeCard"

// COMMANDS

/** Every failure a write did not name reads as its common reason. */
// BOUNDARY: transport, auth and the server's catch-alls all collapse here.
const otherwise =
	(failed: (reason: RuleWriteFailure) => RuleEditorMessage) =>
	<R>(effect: Effect.Effect<RuleEditorMessage, unknown, R>) =>
		effect.pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(failed(reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))))),
			),
		)

const ruleTarget = { organizationId: OrganizationId, ruleId: CustomerSignalRuleId }

/** A new rule; the editor then opens it by id. */
export class CreateSignalRule extends Command.Service<CreateSignalRule>()(
	"hazel/customers/CreateSignalRule",
	{
		args: { organizationId: OrganizationId, rule: Customers.RuleDraft },
		success: RuleEditorMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const actions = makeSignalRuleActions(data)
			return (args) =>
				run(
					actions.createRule(args).pipe(
						Effect.map((ruleId) => RuleEditorMessage.SucceededCreateRule({ ruleId })),
						Effect.catchTag("CustomersInvalidRequestError", () =>
							Effect.succeed(RuleEditorMessage.FailedCreateRule({ reason: "Invalid" })),
						),
						otherwise((reason) => RuleEditorMessage.FailedCreateRule({ reason })),
					),
				)
		}),
	)
}

export class UpdateSignalRule extends Command.Service<UpdateSignalRule>()(
	"hazel/customers/UpdateSignalRule",
	{
		args: { ...ruleTarget, rule: Customers.RuleDraft },
		success: RuleEditorMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const actions = makeSignalRuleActions(data)
			return (args) =>
				run(
					actions.updateRule(args).pipe(
						Effect.as(RuleEditorMessage.SucceededUpdateRule()),
						Effect.catchTags({
							CustomersNotFoundError: () =>
								Effect.succeed(RuleEditorMessage.FailedUpdateRule({ reason: "NotFound" })),
							CustomersInvalidRequestError: () =>
								Effect.succeed(RuleEditorMessage.FailedUpdateRule({ reason: "Invalid" })),
						}),
						otherwise((reason) => RuleEditorMessage.FailedUpdateRule({ reason })),
					),
				)
		}),
	)
}

/** Deletes the rule; its open items resolve on the server. */
export class DeleteSignalRule extends Command.Service<DeleteSignalRule>()(
	"hazel/customers/DeleteSignalRule",
	{
		args: ruleTarget,
		success: RuleEditorMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const actions = makeSignalRuleActions(data)
			return (args) =>
				run(
					actions.deleteRule(args).pipe(
						Effect.as(RuleEditorMessage.SucceededDeleteRule()),
						Effect.catchTag("CustomersNotFoundError", () =>
							Effect.succeed(RuleEditorMessage.FailedDeleteRule({ reason: "NotFound" })),
						),
						otherwise((reason) => RuleEditorMessage.FailedDeleteRule({ reason })),
					),
				)
		}),
	)
}

// FORM

const currencyOf = (model: RuleEditorModel): string => model.settings?.reportingCurrency ?? "USD"

/** The typed fields a form shows, each at its form text. */
const fieldsOf = (form: RuleForm, previous: RuleEditorModel["fields"] = {}): RuleEditorModel["fields"] => {
	const texts: Array<[string, string]> = [["name", form.name]]
	for (const [key, value] of Object.entries(form.config))
		if (typeof value === "string") texts.push([`config.${key}`, value])
	if (form.scope.minMrr !== null) texts.push(["scope.minMrr", form.scope.minMrr])
	return Object.fromEntries(
		texts.map(([key, text]) => [key, TextField.set(previous[key] ?? TextField.empty, text)]),
	)
}

const withForm = (model: RuleEditorModel, form: RuleForm): RuleEditorModel => ({
	...model,
	form,
	fields: fieldsOf(form, model.fields),
})

/** The rules and settings arrived: fill a saved rule's form (min MRR in the reporting currency). */
const hydrate = (model: RuleEditorModel, ruleId: CustomerSignalRuleId | null): RuleEditorModel => {
	const rule = ruleById(model.rules, ruleId)
	return model.form !== null || rule === undefined || !model.hasSettings
		? model
		: withForm(model, formOfRule(rule, currencyOf(model)))
}

const statusOf = (model: RuleEditorModel, form: RuleForm, ruleId: CustomerSignalRuleId | null) =>
	editorStatus({ form, ruleId, rules: model.rules, currency: currencyOf(model), isSaving: model.isSaving })

/** The reporting currency changed: an unedited form re-reads its rule's min MRR in it. */
const settingsChanged = (
	model: RuleEditorModel,
	settings: RuleEditorModel["settings"],
	ruleId: CustomerSignalRuleId | null,
): RuleEditorModel => {
	const next = { ...model, settings, hasSettings: true }
	if (!model.hasSettings) return hydrate(next, ruleId)
	const rule = ruleById(model.rules, ruleId)
	const isUnedited = model.form !== null && statusOf(model, model.form, ruleId).changes === 0
	return rule === undefined || !isUnedited || currencyOf(next) === currencyOf(model)
		? next
		: withForm(next, formOfRule(rule, currencyOf(next)))
}

const edit = (model: RuleEditorModel, change: (form: RuleForm) => RuleForm): RuleEditorModel =>
	model.form === null ? model : { ...model, form: change(model.form) }

const editConfig = (model: RuleEditorModel, key: string, value: RuleForm["config"][string]) =>
	edit(model, (form) => ({ ...form, config: { ...form.config, [key]: value } }))

const editScope = (model: RuleEditorModel, change: (scope: RuleForm["scope"]) => RuleForm["scope"]) =>
	edit(model, (form) => ({ ...form, scope: change(form.scope) }))

/** A typed field taken in, and its text written to the form. */
const changedField = (model: RuleEditorModel, key: string, payload: TextField.ChangePayload) => {
	const field = TextField.changed(model.fields[key] ?? TextField.empty, payload)
	const next = { ...model, fields: { ...model.fields, [key]: field } }
	const text = field.text
	if (key === "name") return edit(next, (form) => ({ ...form, name: text }))
	if (key === "scope.minMrr") return editScope(next, (scope) => ({ ...scope, minMrr: text }))
	return key.startsWith("config.") ? editConfig(next, key.slice("config.".length), text) : next
}

const addCondition = (model: RuleEditorModel, condition: ScopeCondition) => {
	const next = editScope(model, (scope) =>
		condition === "stage"
			? { ...scope, stages: scope.stages ?? [] }
			: condition === "plan"
				? { ...scope, plans: scope.plans ?? [] }
				: condition === "mrr"
					? { ...scope, minMrr: scope.minMrr ?? "0" }
					: scope,
	)
	return next.form === null ? next : { ...next, fields: fieldsOf(next.form, next.fields) }
}

const removeCondition = (model: RuleEditorModel, condition: ScopeCondition) =>
	editScope(model, (scope) =>
		condition === "stage"
			? { ...scope, stages: null }
			: condition === "plan"
				? { ...scope, plans: null }
				: condition === "mrr"
					? { ...scope, minMrr: null }
					: { ...scope, tags: [] },
	)

// FEEDBACK

const plural = (count: number, word: string) => `${formatCount(count)} ${count === 1 ? word : `${word}s`}`

const writeFailure = (title: string, reason: RuleWriteFailure) =>
	ShowToast.make({
		toast: errorToast(
			copyOf(reason, {
				NotFound: { title, description: "The rule was deleted in the meantime." },
				Invalid: { title, description: "Check the rule's settings and try again." },
			}),
		),
	})

const ranToast = (title: string, description: string) => ({ intent: "success", title, description }) as const

// COMPONENT

const RuleEditorDef = Hazel.component({
	name: "RuleEditor",
	props: RuleEditorProps,
	model: RuleEditorModel,
	message: RuleEditorMessage,
	// After Back, a write that was in flight is not running any more.
	restore: (model) => ({ ...model, isSaving: false, isDeleting: false, dialog: "none" as const }),
})

type H = Parameters<Parameters<typeof RuleEditorDef.make>[0]["view"]>[0]

const toList = (orgSlug: string, toast?: ReturnType<typeof ranToast>) =>
	Navigate.make(
		toast === undefined
			? { href: signalsHref(orgSlug), replace: false }
			: { href: signalsHref(orgSlug), replace: false, toast },
	)

/** Close asks first while the form has unsaved changes. */
const close = RuleEditorDef.update(($) => {
	const { form } = $.model
	const hasChanges = form !== null && statusOf($.model, form, $.props.ruleId).changes > 0
	return hasChanges ? $.evolve({ dialog: "discard" }) : $.run(toList($.props.orgSlug))
})

const save = RuleEditorDef.update(($) => {
	const { form } = $.model
	if (form === null || !isCustomersAdmin($.props.role)) return $.model
	const status = statusOf($.model, form, $.props.ruleId)
	if (!status.canSave || Option.isNone(status.draft)) return $.model
	const rule = status.draft.value
	const { organizationId, ruleId } = $.props
	return $.evolve({ isSaving: true }).run(
		ruleId === null
			? CreateSignalRule.make({ organizationId, rule })
			: UpdateSignalRule.make({ organizationId, ruleId, rule }),
	)
})

export const RuleEditorNoDeps = RuleEditorDef.make({
	init: ({ props }) => {
		const form = props.template === null || props.ruleId !== null ? null : formOfTemplate(props.template)
		return {
			rules: null,
			signals: null,
			accounts: null,
			providers: null,
			settings: null,
			hasSettings: false,
			metrics: [],
			form,
			fields: form === null ? {} : fieldsOf(form),
			isSaving: false,
			isDeleting: false,
			dialog: "none",
		}
	},
	update: {
		UpdatedRules: ($, { rules }) => $.set(hydrate({ ...$.model, rules }, $.props.ruleId)),
		UpdatedSignals: ($, { signals }) => $.evolve({ signals }),
		UpdatedAccounts: ($, { accounts }) => $.evolve({ accounts }),
		UpdatedProviders: ($, { providers }) => $.evolve({ providers }),
		UpdatedSettings: ($, { settings }) => $.set(settingsChanged($.model, settings, $.props.ruleId)),
		UpdatedMetrics: ($, { metrics }) => $.evolve({ metrics }),

		ChangedField: ($, { key, payload }) => $.set(changedField($.model, key, payload)),
		PickedSeverity: ($, { severity }) => $.set(edit($.model, (form) => ({ ...form, severity }))),
		ToggledConfigFlag: ($, { key, checked }) => $.set(editConfig($.model, key, checked)),
		PickedMetric: ($, { metricKey }) => $.set(editConfig($.model, "metricKey", metricKey)),
		PickedLimitMetrics: ($, { metricKeys }) => $.set(editConfig($.model, "metricKeys", metricKeys)),
		PressedAddCondition: ($, { condition }) => $.set(addCondition($.model, condition)),
		PressedRemoveCondition: ($, { condition }) => $.set(removeCondition($.model, condition)),
		PickedScopeStages: ($, { stages }) => $.set(editScope($.model, (scope) => ({ ...scope, stages }))),
		PickedScopePlans: ($, { plans }) => $.set(editScope($.model, (scope) => ({ ...scope, plans }))),
		ToggledPayingOnly: ($, { checked }) =>
			$.set(editScope($.model, (scope) => ({ ...scope, payingOnly: checked }))),
		PressedToggleEnabled: ($) => $.set(edit($.model, (form) => ({ ...form, enabled: !form.enabled }))),

		PressedSave: ($) => $.combine(save),
		// The new rule opens in place of the new-rule page.
		SucceededCreateRule: ($, { ruleId }) =>
			$.evolve({ isSaving: false }).run(
				Navigate.make({
					href: ruleHref($.props.orgSlug, ruleId),
					replace: true,
					toast: ranToast("Rule created", "It runs on the next hourly check."),
				}),
			),
		FailedCreateRule: ($, { reason }) =>
			$.evolve({ isSaving: false }).run(writeFailure("Couldn't create the rule", reason)),
		SucceededUpdateRule: ($) =>
			$.evolve({ isSaving: false }).run(
				ShowToast.make({ toast: ranToast("Rule saved", "It runs on the next hourly check.") }),
			),
		FailedUpdateRule: ($, { reason }) =>
			$.evolve({ isSaving: false }).run(writeFailure("Couldn't save the rule", reason)),
		PressedClose: ($) => $.combine(close),
		// Only the "Signals" crumb raises this (the current page has no link).
		PressedCrumb: ($, { index }) => (index === 0 ? $.combine(close) : $.model),
		PressedDiscard: ($) => $.evolve({ dialog: "none" }).run(toList($.props.orgSlug)),
		DismissedDiscard: ($) => $.evolve({ dialog: "none" }),
		PressedDelete: ($) => $.evolve({ dialog: "delete" }),
		DismissedDelete: ($) => $.evolve({ dialog: "none" }),
		PressedConfirmDelete: ($) => {
			const { ruleId, organizationId } = $.props
			return ruleId === null || $.model.isDeleting
				? $.model
				: $.evolve({ dialog: "none", isDeleting: true }).run(
						DeleteSignalRule.make({ organizationId, ruleId }),
					)
		},
		SucceededDeleteRule: ($) =>
			$.run(toList($.props.orgSlug, ranToast("Rule deleted", "Its open items were resolved."))),
		FailedDeleteRule: ($, { reason }) =>
			$.evolve({ isDeleting: false }).run(writeFailure("Couldn't delete the rule", reason)),
	},
	subscriptions: ({ props }) => {
		const feeds: SignalsFeeds<RuleEditorMessage> = {
			rules: (rules: ReadonlyArray<RuleRow>) => RuleEditorMessage.UpdatedRules({ rules }),
			signals: (signals: ReadonlyArray<SignalRow>) => RuleEditorMessage.UpdatedSignals({ signals }),
			accounts: (accounts: ReadonlyArray<AccountRow>) =>
				RuleEditorMessage.UpdatedAccounts({ accounts }),
			providers: (providers: ReadonlyArray<Customers.CustomerProvider>) =>
				RuleEditorMessage.UpdatedProviders({ providers }),
			settings: (settings: SettingsSummary | null) => RuleEditorMessage.UpdatedSettings({ settings }),
			metrics: (metrics: ReadonlyArray<MetricRow>) => RuleEditorMessage.UpdatedMetrics({ metrics }),
		}
		return (["rules", "signals", "accounts", "providers", "settings", "metrics"] as const).map((feed) =>
			Subscription.make(feed, [props.organizationId], ([organizationId]) =>
				signalsFeed<RuleEditorMessage>(organizationId, feed, feeds),
			),
		)
	},
	view: (h, model) => {
		const { props } = h
		const { form } = model
		const isGone =
			props.ruleId !== null &&
			model.rules !== null &&
			!model.isDeleting &&
			ruleById(model.rules, props.ruleId) === undefined
		if (isGone)
			return placeholder(
				h,
				"Rule not found",
				form === null
					? "This rule was deleted, or the link is wrong."
					: "This rule was deleted in the meantime.",
			)
		if (form === null) return placeholder(h, "Loading rule…", null)
		return editor(h, model, form)
	},
})

// VIEW

const crumbs = (orgSlug: string, isNew: boolean, hasChanges: boolean) => [
	// With unsaved changes the crumb asks first, like Close (`PressedCrumb`).
	hasChanges ? { label: "Signals" } : { label: "Signals", href: signalsHref(orgSlug) },
	{ label: isNew ? "New rule" : "Edit rule" },
]

// HAZEL-GAP(p4-screen-page-column): today is a padded, width-capped column under a display title; `page` is the phone bar.
const frame = (h: H, title: string, crumbList: ReadonlyArray<{ label: string; href?: string }>) =>
	h.screen
		.key("signal-rule")
		.surface("page")
		.title(title)
		.crumbs(crumbList)
		.on("crumb", ({ index }) => RuleEditorMessage.PressedCrumb({ index }))

const placeholder = (h: H, title: string, gone: string | null) =>
	frame(h, title, crumbs(h.props.orgSlug, false, false)).children(
		h.stack
			.inset("page")
			.children(
				h.frame.children(
					gone === null
						? h.progress.style("spinner").label("Loading the rule…")
						: h.emptyState
								.title(gone)
								.action(h.link.label("Back to signals").href(signalsHref(h.props.orgSlug))),
				),
			),
	)

const metaBadges = (
	h: H,
	model: RuleEditorModel,
	form: RuleForm,
	changes: number,
	saved: RuleRow | undefined,
) => [
	form.enabled
		? h.badge.key("on").tone("success").label("On")
		: h.badge.key("on").style("outline").label("Off"),
	changes > 0
		? h.badge.key("state").tone("warning").label(plural(changes, "unsaved change"))
		: h.props.ruleId === null || saved === undefined
			? h.badge.key("state").style("quiet").label("Not saved yet")
			: h.text
					.key("state")
					.role("caption")
					.tone("muted")
					.children(
						`Saved · edited ${formatDate(new Date(saved.updatedAtMs), { now: new Date(h.props.nowMs) })}`,
					),
	model.isDeleting ? h.progress.key("deleting").style("inline").label("Deleting…") : null,
]

const toolbar = (h: H, model: RuleEditorModel, form: RuleForm, changes: number, canSave: boolean) =>
	isCustomersAdmin(h.props.role)
		? [
				h.button
					.key("enabled")
					.label(form.enabled ? "Turn off" : "Turn on")
					.variant("outline")
					.on("press", RuleEditorMessage.PressedToggleEnabled()),
				h.button
					.key("close")
					.label(changes > 0 || h.props.ruleId === null ? "Cancel" : "Close")
					.variant("ghost")
					.on("press", RuleEditorMessage.PressedClose()),
				h.button
					.key("save")
					.label(h.props.ruleId === null ? "Create rule" : "Save rule")
					.loading(model.isSaving)
					.disabled(!canSave && !model.isSaving)
					.on("press", RuleEditorMessage.PressedSave()),
			]
		: [
				h.button
					.key("close")
					.label("Close")
					.variant("ghost")
					.on("press", RuleEditorMessage.PressedClose()),
			]

const plainWordsCard = (h: H, model: RuleEditorModel, form: RuleForm) => {
	const currency = currencyOf(model)
	const metricName = (key: string) => model.metrics.find((metric) => metric.key === key)?.name ?? key
	return h.banner
		.key("plain-words")
		.tone("info")
		.title("In plain words")
		.children(
			h.text.children(
				...renderParts(
					h,
					plainWords({
						template: form.template,
						config: form.config,
						scope: scopeOf(form.scope, currency),
						severity: form.severity,
						currency,
						metricName,
					}),
				),
			),
		)
}

/** A labelled value with its help under it, as a form field reads. */
const field = (h: H, key: string, label: string, help: string, value: Hazel.NoTextInput<RuleEditorMessage>) =>
	h.stack
		.key(key)
		.density("snug")
		.children(
			h.text.role("label").strong().children(label),
			value,
			h.text.role("caption").tone("muted").children(help),
		)

const ruleCard = (h: H, model: RuleEditorModel, form: RuleForm, errors: Readonly<Record<string, string>>) => {
	const meta = Customers.TEMPLATES[form.template]
	const isAdmin = isCustomersAdmin(h.props.role)
	// HAZEL-GAP(pk7-locked-template-field): today the template sits in a grey locked box with its key in mono and a lock.
	return panel(
		h,
		{ key: "rule", title: "Rule" },
		h.grid
			.columns("2")
			.density("loose")
			.children(
				h.textField
					.key("name")
					.label("Name")
					.description("Shown as the item title in the queue.")
					.value(model.fields["name"] ?? TextField.empty)
					.error(errors["name"])
					.disabled(!isAdmin)
					.on("change", (payload) => RuleEditorMessage.ChangedField({ key: "name", payload })),
				h.textField
					.key("template")
					.label("Template")
					.description("Fixed after creation. Start a new rule to use another template.")
					.value({ text: meta.name, rev: 0, edit: 0 })
					.suffix(form.template)
					.readOnly(),
				field(
					h,
					"kind",
					"Kind",
					"Set by the template.",
					h.stack.axis("horizontal").children(kindChip(h, meta.kind)),
				),
				field(
					h,
					"severity",
					"Severity",
					"Queue rank = severity × MRR × freshness. Stronger evidence raises it a step.",
					h.stack.axis("horizontal").children(
						severityPicker(h, {
							selected: form.severity,
							isDisabled: !isAdmin,
							onSelect: (severity) => RuleEditorMessage.PickedSeverity({ severity }),
						}),
					),
				),
			),
	)
}

const deleteCard = (h: H, model: RuleEditorModel) =>
	panel(h, {
		key: "delete",
		title: "Delete this rule",
		description: "Its open items in Needs attention resolve on their own.",
		aside: h.button
			.label("Delete rule")
			.icon("trash")
			.variant("outline")
			.size("small")
			.loading(model.isDeleting)
			.on("press", RuleEditorMessage.PressedDelete()),
	})

const dialogs = (h: H, model: RuleEditorModel, form: RuleForm, changes: number) => {
	const open = (model.signals ?? []).filter(
		(signal) =>
			signal.ruleId === h.props.ruleId && (signal.status === "open" || signal.status === "snoozed"),
	).length
	// A dialog is drawn only while open, so its buttons are not on the page otherwise.
	return [
		model.dialog !== "discard"
			? null
			: h.dialog
					.key("discard")
					.open(true)
					.destructive()
					.title("Discard changes?")
					.description(`Your ${plural(changes, "unsaved change")} to this rule will be lost.`)
					.on("dismiss", RuleEditorMessage.DismissedDiscard())
					.actions(
						h.button
							.label("Keep editing")
							.variant("outline")
							.on("press", RuleEditorMessage.DismissedDiscard()),
						h.button
							.label("Discard")
							.variant("danger")
							.on("press", RuleEditorMessage.PressedDiscard()),
					),
		h.props.ruleId === null || model.dialog !== "delete"
			? null
			: h.dialog
					.key("delete")
					.open(true)
					.destructive()
					.title("Delete this rule?")
					.description(
						`“${form.name}” stops checking accounts. ${open === 0 ? "It has no open items." : `Its ${plural(open, "open item")} in Needs attention resolve automatically.`} This can't be undone.`,
					)
					.on("dismiss", RuleEditorMessage.DismissedDelete())
					.actions(
						h.button
							.label("Cancel")
							.variant("outline")
							.on("press", RuleEditorMessage.DismissedDelete()),
						h.button
							.label("Delete rule")
							.variant("danger")
							.on("press", RuleEditorMessage.PressedConfirmDelete()),
					),
	]
}

const editor = (h: H, model: RuleEditorModel, form: RuleForm) => {
	const { props } = h
	const isAdmin = isCustomersAdmin(props.role)
	const status = statusOf(model, form, props.ruleId)
	const title = form.name.trim() === "" ? Customers.TEMPLATES[form.template].name : form.name
	const context = {
		model,
		form,
		errors: status.errors,
		isAdmin,
		orgSlug: props.orgSlug,
		nowMs: props.nowMs,
	}
	// HAZEL-GAP(pk7-editor-aside): today the cards and the preview are two columns (`1fr 26rem`) from `lg`.
	return (
		frame(h, title, crumbs(props.orgSlug, props.ruleId === null, status.changes > 0))
			// HAZEL-GAP(pk7-header-mark): today the template's tile leads the title; `screen.leading` sits at the content's start.
			.meta(...metaBadges(h, model, form, status.changes, status.saved))
			.toolbar(...toolbar(h, model, form, status.changes, status.canSave))
			.children(
				h.stack
					.key("body")
					.inset("page")
					.density("loose")
					.children(
						isAdmin ? null : readOnlyNotice(h, "signal rules"),
						plainWordsCard(h, model, form),
						ruleCard(h, model, form, status.errors),
						...conditionCards(h, context),
						scopeCard(h, context),
						isAdmin && props.ruleId !== null ? deleteCard(h, model) : null,
						rulePreview(h, {
							organizationId: props.organizationId,
							orgSlug: props.orgSlug,
							ruleId: props.ruleId,
							form,
							draft: status.draft,
							currency: currencyOf(model),
							nowMs: props.nowMs,
						}),
					),
				...dialogs(h, model, form, status.changes),
			)
	)
}

/** The editor with its rule writes, on the host's data and RPC client. */
export const RuleEditor = RuleEditorNoDeps.pipe(
	Component.provide(Layer.mergeAll(CreateSignalRule.layer, UpdateSignalRule.layer, DeleteSignalRule.layer)),
)
