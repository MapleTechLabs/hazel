// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/customers/settings/sla` (`web-foldkit/src/page/customers/settings/sla`, now deleted):
 * the org's business hours, the support SLA policies (first match wins) with their editor in place
 * of the list, and support triage (`docs/customers/sla.md`).
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ClientData, type HazelRpc } from "@hazel/client-data"
import * as Customers from "@hazel/domain/customers"
import { CustomerSettingsId, CustomerSlaPolicyId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Match, Option, Predicate, Schema, Stream } from "effect"
import type { AppRequests } from "../../../../app/requests"
import { Session } from "../../../../app/session"
import * as Confirm from "../../../../components/ConfirmAction"
import { type CommonReason, copyOf, errorToast, reasonOf, toast } from "../../../../modals/feedback"
import { modalServices } from "../../../../modals/services"
import { makeCustomerQueries } from "../../../data/queries"
import { makeSettingsData, SettingsRow } from "../../../data/settings"
import { GetPlans } from "../plans/PlansPage"
import { type Crumb, isCustomersAdmin, pageHeader, readOnlyNotice, settingsColumn } from "../settings-page"
import {
	appliesToSummary,
	businessHoursOfForm,
	draftOfForm,
	draftOfRow,
	exampleLine,
	formOfPolicy,
	HOURS_LABEL,
	hoursErrors,
	mediumTargetHint,
	newPolicyForm,
	type PolicyErrors,
	policyErrors,
	sameHours,
	WEEKDAYS,
	withoutDays,
} from "./draft"
import {
	ABOUT_MAX,
	AccountOption,
	businessHoursOf,
	CLOCKS,
	COMMON_TIME_ZONES,
	DurationUnit,
	type Editor,
	hoursFormOf,
	type HoursForm,
	planNamesOf,
	PolicyRow,
	type PolicyForm,
	policyById,
	PRIORITIES,
	SlaClock,
	SlaModel,
	syncedFields,
	triageFormFrom,
	triageFormOf,
	WARN_OPTIONS,
	withFieldText,
} from "./model"

const SUBTITLE =
	"How fast the team should answer and resolve a customer’s support issue, and what counts as one. Changes apply to issues opened from now on."

export const SlaProps = Schema.Struct({ session: Session })
export type SlaProps = typeof SlaProps.Type

/** One write the page makes; its Command settles it with the matching message. */
export const SlaWrite = Schema.Union([
	Schema.TaggedStruct("Toggle", { policyId: CustomerSlaPolicyId, policy: Customers.SlaPolicyDraft }),
	Schema.TaggedStruct("Reorder", { policyIds: Schema.Array(CustomerSlaPolicyId) }),
	Schema.TaggedStruct("Delete", { policyId: CustomerSlaPolicyId }),
	Schema.TaggedStruct("SavePolicy", {
		policyId: Schema.NullOr(CustomerSlaPolicyId),
		policy: Customers.SlaPolicyDraft,
		token: Schema.Int,
	}),
	Schema.TaggedStruct("SaveHours", {
		settingsId: CustomerSettingsId,
		businessHours: Customers.BusinessHours,
	}),
	Schema.TaggedStruct("SaveTriage", {
		settingsId: CustomerSettingsId,
		supportTriage: Customers.SupportTriageSettings,
	}),
])
export type SlaWrite = typeof SlaWrite.Type

export const SlaMessage = UiSchema.TaggedEnum({
	UpdatedPolicies: { policies: Schema.Array(PolicyRow) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountOption) },
	PressedRetryPlans: {},

	// Business hours
	ChangedTimeZone: { value: Schema.String },
	ChangedDays: { selected: Schema.Array(Schema.String) },
	ChangedStart: { value: Schema.NullOr(Schema.String) },
	ChangedEnd: { value: Schema.NullOr(Schema.String) },
	PressedSaveHours: {},
	PressedResetHours: {},

	// Triage
	ToggledTriage: { enabled: Schema.Boolean },
	ChangedTriageAbout: { payload: TextField.ChangePayload },
	PressedSaveTriage: {},
	PressedResetTriage: {},

	// The list
	ToggledPolicy: { policyId: CustomerSlaPolicyId, enabled: Schema.Boolean },
	PressedMove: { policyId: CustomerSlaPolicyId, offset: Schema.Literals([-1, 1]) },
	PressedDelete: { policyId: CustomerSlaPolicyId },
	PressedConfirmDelete: {},
	CancelledDelete: {},

	// The editor
	PressedNewPolicy: {},
	PressedEdit: { policyId: CustomerSlaPolicyId },
	PressedCloseEditor: {},
	ChangedField: { field: Schema.String, payload: TextField.ChangePayload },
	ToggledEnabled: { enabled: Schema.Boolean },
	ChangedHours: { selected: Schema.Array(Schema.String) },
	ChangedWarn: { value: Schema.String },
	ChangedPlans: { selected: Schema.Array(Schema.String) },
	PressedAddTag: {},
	RemovedTag: { tag: Schema.String },
	AddedAccount: { accountId: Schema.String },
	RemovedAccount: { accountId: Schema.String },
	ChangedUnit: { priority: Customers.SlaPriority, clock: SlaClock, value: Schema.String },
	PressedSavePolicy: {},

	/** A write finished; `token` names the editor a policy save was pressed in. */
	Settled: {
		write: Schema.Literals(["list", "delete", "hours", "triage", "policy"]),
		ok: Schema.Boolean,
		token: Schema.Int,
	},
})
export type SlaMessage = typeof SlaMessage.Type

// WRITES

// As today's `failureMessage`: a common reason reads as its own copy.
const failureCopy = (title: string, failure: "NotFound" | "Invalid" | CommonReason) =>
	copyOf<"NotFound" | "Invalid">(failure, {
		NotFound: { title, description: "The policy was deleted in the meantime." },
		Invalid: { title, description: "The order changed in the meantime. Try again." },
	})

const success = (title: string, description: string) => toast({ intent: "success", title, description })

/** Runs one write, shows its toast, and settles it. */
export class RunSlaWrite extends Command.Service<RunSlaWrite>()("hazel/customers/RunSlaWrite", {
	args: { organizationId: OrganizationId, write: SlaWrite },
	success: SlaMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const writes = makeSettingsData(data)
			return ({ organizationId, write }) => {
				const settle = (kind: SlaMessage & { _tag: "Settled" }, ok: boolean) =>
					SlaMessage.Settled({ write: kind.write, ok, token: kind.token })
				const plan: {
					readonly effect: Effect.Effect<void, unknown, HazelRpc>
					readonly done: Effect.Effect<void, never, AppRequests>
					readonly title: string
					readonly settled: SlaMessage & { readonly _tag: "Settled" }
				} = Match.value(write).pipe(
					Match.tag("Toggle", ({ policyId, policy }) => ({
						effect: Effect.asVoid(
							writes.updatePolicyAction({ organizationId, policyId, policy }),
						),
						done: Effect.void,
						title: "Couldn't change the policy",
						settled: SlaMessage.Settled({ write: "list", ok: true, token: 0 }),
					})),
					Match.tag("Reorder", ({ policyIds }) => ({
						effect: Effect.asVoid(writes.reorderPoliciesAction({ organizationId, policyIds })),
						done: Effect.void,
						title: "Couldn't reorder the policies",
						settled: SlaMessage.Settled({ write: "list", ok: true, token: 0 }),
					})),
					Match.tag("Delete", ({ policyId }) => ({
						effect: Effect.asVoid(writes.deletePolicyAction({ organizationId, policyId })),
						done: success("Policy deleted", "Open issues keep the targets they started with."),
						title: "Couldn't delete the policy",
						settled: SlaMessage.Settled({ write: "delete", ok: true, token: 0 }),
					})),
					Match.tag("SavePolicy", ({ policyId, policy, token }) => ({
						effect:
							policyId === null
								? Effect.asVoid(writes.createPolicyAction({ organizationId, policy }))
								: Effect.asVoid(
										writes.updatePolicyAction({ organizationId, policyId, policy }),
									),
						done: success(
							policyId === null ? "Policy created" : "Policy saved",
							"It applies to issues opened from now on.",
						),
						title: "Couldn't save the policy",
						settled: SlaMessage.Settled({ write: "policy", ok: true, token }),
					})),
					Match.tag("SaveHours", ({ settingsId, businessHours }) => ({
						effect: Effect.asVoid(
							writes.saveBusinessHoursAction({ organizationId, settingsId, businessHours }),
						),
						done: success(
							"Business hours saved",
							"New deadlines use them; running ones keep theirs.",
						),
						title: "",
						settled: SlaMessage.Settled({ write: "hours", ok: true, token: 0 }),
					})),
					Match.tag("SaveTriage", ({ settingsId, supportTriage }) => ({
						effect: Effect.asVoid(
							writes.saveSettingsAction({
								organizationId,
								settingsId,
								change: { supportTriage },
							}),
						),
						done: success("Triage saved", "It applies to conversations that start from now on."),
						title: "",
						settled: SlaMessage.Settled({ write: "triage", ok: true, token: 0 }),
					})),
					Match.exhaustive,
				)
				const failed = (failure: "NotFound" | "Invalid" | CommonReason) =>
					toast(errorToast(failureCopy(plan.title, failure))).pipe(
						Effect.as(settle(plan.settled, false)),
					)
				return run(
					plan.effect.pipe(
						Effect.andThen(plan.done),
						Effect.as(settle(plan.settled, true)),
						// BOUNDARY: the policy gone or the order changed, else a common reason; the rows roll back.
						Effect.catchCause((cause) => {
							const error = Option.getOrUndefined(Cause.findErrorOption(cause))
							const tag = Predicate.hasProperty(error, "_tag") ? error._tag : undefined
							return failed(
								tag === "CustomersNotFoundError"
									? "NotFound"
									: tag === "CustomersInvalidRequestError"
										? "Invalid"
										: reasonOf(error),
							)
						}),
					),
				)
			}
		}),
	)
}

// COMPONENT

const SlaDef = Hazel.component({
	name: "SlaPage",
	props: SlaProps,
	model: SlaModel,
	message: SlaMessage,
	queries: {
		plans: {
			query: GetPlans,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: { organizationId: props.session.organization.id, attempt: model.plansAttempt },
		},
	},
	// After Back, no write is running any more.
	restore: (model) => ({
		...model,
		isSavingHours: false,
		isSavingTriage: false,
		isWritingList: false,
		editor: model.editor === null ? null : { ...model.editor, isSaving: false },
		deleting: Confirm.closed,
	}),
})

type H = Parameters<Parameters<typeof SlaDef.make>[0]["view"]>[0]
type Plans = ReadonlyArray<string> | "loading" | "failed"

// PARTS

/** A settings card: a title and description over its body; `flush` runs a list edge to edge. */
const card = (
	h: H,
	options: Readonly<{ key: string; title: string; description?: string; aside?: unknown; flush?: boolean }>,
	...body: ReadonlyArray<unknown>
) => {
	const header = h.stack
		.axis("horizontal")
		.align("start")
		.wrap()
		.density("regular")
		.children(
			h.stack
				.density("tight")
				.children(
					h.heading.level("2").children(options.title),
					options.description === undefined
						? null
						: h.text.role("label").tone("muted").children(options.description),
				),
			options.aside == null ? null : h.spacer,
			(options.aside ?? null) as never,
		)
	// HAZEL-GAP(pk8-card-header): today a list card's header is padded `p-4 sm:p-5` over a hairline; `page` is 16px.
	return options.flush === true
		? h.frame
				.key(options.key)
				.surface("flush")
				.children(h.stack.inset("page").children(header), ...(body as Array<never>))
		: h.frame
				.key(options.key)
				.surface("tile")
				.children(header, ...(body as Array<never>))
}

const formActions = (
	h: H,
	options: Readonly<{
		isDirty: boolean
		canSave: boolean
		isSaving: boolean
		label: string
		reset: SlaMessage
		save: SlaMessage
	}>,
) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.density("compact")
		.children(
			h.spacer,
			options.isDirty ? null : h.text.role("caption").tone("muted").children("No changes"),
			h.button
				.label("Reset")
				.variant("ghost")
				.size("small")
				.disabled(options.isSaving)
				.on("press", options.reset),
			h.button
				.label(options.label)
				.size("small")
				.disabled(!options.isDirty || !options.canSave)
				.loading(options.isSaving)
				.on("press", options.save),
		)

// BUSINESS HOURS

const zoneLabel = (zone: string) => zone.replaceAll("_", " ")

const hoursCard = (h: H, model: SlaModel, canEdit: boolean) => {
	const form = hoursFormOf(model)
	const errors = model.hoursForm === null ? { days: undefined, time: undefined } : hoursErrors(form)
	const zones = COMMON_TIME_ZONES.includes(form.timeZone)
		? COMMON_TIME_ZONES
		: [form.timeZone, ...COMMON_TIME_ZONES]
	const saved = model.settings?.businessHours
	const isDirty = model.hoursForm !== null && (saved === undefined || !sameHours(model.hoursForm, saved))
	const isDisabled = !canEdit || model.isSavingHours
	const hasErrors = errors.days !== undefined || errors.time !== undefined
	return card(
		h,
		{
			key: "hours",
			title: "Business hours",
			description: "Policies on business hours count only this working week. No holidays yet.",
		},
		// HAZEL-GAP(pk8-hours-columns): today the three fields sit in `16rem | 1fr | auto` columns from `md`.
		h.grid.columns("3").children(
			h.select
				.label("Time zone")
				.options(zones.map((zone) => ({ value: zone, label: zoneLabel(zone) })))
				.value(form.timeZone)
				.disabled(isDisabled)
				.on("change", ({ value }) => SlaMessage.ChangedTimeZone({ value })),
			h.choiceGroup
				.label("Working days")
				.style("chips")
				.multiple()
				.options(WEEKDAYS.map(([day, short]) => ({ value: String(day), label: short })))
				.selected(form.days.map(String))
				.disabled(isDisabled)
				.error(errors.days)
				.on("change", ({ selected }) => SlaMessage.ChangedDays({ selected })),
			// HAZEL-GAP(pk8-time-range): today one "Hours" label over the start and end fields with a dash between.
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("start")
				.children(
					h.datePicker
						.label("Start")
						.granularity("time")
						.value(form.start)
						.disabled(isDisabled)
						.on("change", ({ value }) => SlaMessage.ChangedStart({ value })),
					h.datePicker
						.label("End")
						.granularity("time")
						.value(form.end)
						.error(errors.time)
						.disabled(isDisabled)
						.on("change", ({ value }) => SlaMessage.ChangedEnd({ value })),
				),
		),
		canEdit && model.hoursForm !== null
			? formActions(h, {
					isDirty,
					canSave: !hasErrors && model.settings !== null,
					isSaving: model.isSavingHours,
					label: "Save hours",
					reset: SlaMessage.PressedResetHours(),
					save: SlaMessage.PressedSaveHours(),
				})
			: null,
	)
}

// TRIAGE

const sameTriage = (a: Customers.SupportTriageSettings, b: Customers.SupportTriageSettings): boolean =>
	a.enabled === b.enabled && a.about.trim() === b.about.trim()

const triageCard = (h: H, model: SlaModel, canEdit: boolean) => {
	const form = triageFormOf(model)
	const saved = model.settings?.supportTriage ?? Customers.DEFAULT_SUPPORT_TRIAGE
	const isDirty =
		model.triageForm !== null && !sameTriage({ enabled: form.enabled, about: form.about.text }, saved)
	// Not before the saved settings are here: an edit would start from the defaults, not from them.
	const isDisabled = !canEdit || model.isSavingTriage || model.settings === null
	const isTooLong = form.about.text.trim().length > ABOUT_MAX
	return card(
		h,
		{
			key: "triage",
			title: "Triage",
			description:
				"Customers chat in linked channels, and most of it is not a request. Triage reads each new conversation, files what is not support under Filtered in the inbox, and joins a message to the conversation it continues.",
		},
		h.toggle
			.label("Triage new conversations")
			.checked(form.enabled)
			.disabled(isDisabled)
			.on("change", ({ checked }) => SlaMessage.ToggledTriage({ enabled: checked })),
		h.textArea
			.label("What your team supports")
			.placeholder(
				"Acme is a billing API. Support covers the API, the dashboard, invoices and account access.",
			)
			.value(form.about)
			.disabled(isDisabled || !form.enabled)
			.description(
				isTooLong
					? undefined
					: "A sentence or two. Without it, talk about other tools can read as a product question. It is sent to the model with each conversation, never shown to customers.",
			)
			.error(isTooLong ? `At most ${ABOUT_MAX.toLocaleString("en-US")} characters.` : undefined)
			.on("change", (payload) => SlaMessage.ChangedTriageAbout({ payload })),
		canEdit && model.triageForm !== null
			? formActions(h, {
					isDirty,
					canSave: !isTooLong && model.settings !== null,
					isSaving: model.isSavingTriage,
					label: "Save triage",
					reset: SlaMessage.PressedResetTriage(),
					save: SlaMessage.PressedSaveTriage(),
				})
			: null,
	)
}

// THE LIST

const rowButton = (
	h: H,
	label: string,
	icon: "arrow-up" | "chevron-down" | "edit" | "trash",
	message: SlaMessage,
	disabled = false,
) =>
	h.button
		.key(label)
		.label(label)
		.icon(icon)
		.iconOnly()
		.variant("ghost")
		.size("small")
		.disabled(disabled)
		.on("press", message)

const policyRow = (
	h: H,
	model: SlaModel,
	policy: PolicyRow,
	index: number,
	count: number,
	canEdit: boolean,
) => {
	const isBusy = model.isWritingList
	// HAZEL-GAP(pk8-policy-row): today the switch leads, then the position, the name with its badges, the
	// scope line and the medium targets after a clock glyph; the toggle names the row and trails its switch.
	return h.stack
		.key(policy.id)
		.axis("horizontal")
		.align("center")
		.inset("bar")
		.density("regular")
		.children(
			h.toggle
				.label(`${index + 1}. ${policy.name}`)
				.description(
					`${appliesToSummary(policy.appliesTo, model.accounts)} · ${mediumTargetHint(policy.targets)}`,
				)
				.checked(policy.enabled)
				.disabled(!canEdit || isBusy)
				.on("change", ({ checked }) =>
					SlaMessage.ToggledPolicy({ policyId: policy.id, enabled: checked }),
				),
			h.badge.label(HOURS_LABEL[policy.hours]).tone(policy.hours === "always" ? "info" : "neutral"),
			policy.enabled ? null : h.badge.label("Off").style("outline"),
			...(canEdit
				? [
						rowButton(
							h,
							`Move ${policy.name} up`,
							"arrow-up",
							SlaMessage.PressedMove({ policyId: policy.id, offset: -1 }),
							index === 0 || isBusy,
						),
						// HAZEL-GAP(pk8-arrow-down): today's "down" is the up arrow turned; `IconName` has no `arrow-down`.
						rowButton(
							h,
							`Move ${policy.name} down`,
							"chevron-down",
							SlaMessage.PressedMove({ policyId: policy.id, offset: 1 }),
							index === count - 1 || isBusy,
						),
						rowButton(
							h,
							`Edit ${policy.name}`,
							"edit",
							SlaMessage.PressedEdit({ policyId: policy.id }),
						),
						rowButton(
							h,
							`Delete ${policy.name}`,
							"trash",
							SlaMessage.PressedDelete({ policyId: policy.id }),
						),
					]
				: [
						h.button
							.label("View")
							.variant("outline")
							.size("small")
							.on("press", SlaMessage.PressedEdit({ policyId: policy.id })),
					]),
		)
}

const newPolicyButton = (h: H) =>
	h.button
		.label("New policy")
		.icon("plus")
		.variant("outline")
		.size("small")
		.on("press", SlaMessage.PressedNewPolicy())

const policiesCard = (h: H, model: SlaModel, canEdit: boolean) => {
	const policies = model.policies ?? []
	return card(
		h,
		{
			key: "policies",
			title: "Policies",
			description:
				"First match wins, top to bottom. A customer named directly wins over a plan or tag.",
			aside: canEdit && policies.length > 0 ? newPolicyButton(h) : null,
			flush: true,
		},
		h.divider,
		model.policies === null
			? h.progress.style("spinner").label("Loading policies…")
			: policies.length === 0
				? h.emptyState
						.icon("clock")
						.title("No SLA: issues have no targets")
						.description("Add a policy to set reply and resolution targets.")
						.action(canEdit ? newPolicyButton(h) : undefined)
				: h.stack.children(
						...policies.flatMap((policy, index) => [
							index === 0 ? null : h.divider.key(`divider-${policy.id}`),
							policyRow(h, model, policy, index, policies.length, canEdit),
						]),
					),
	)
}

// THE EDITOR

const PRIORITY_LABEL = {
	urgent: "Urgent",
	high: "High",
	medium: "Medium",
	low: "Low",
} as const satisfies Record<Customers.SlaPriority, string>

const CLOCK_LABEL = {
	firstResponse: "First response",
	resolution: "Resolution",
} as const satisfies Record<SlaClock, string>

const WARN_ITEMS = WARN_OPTIONS.map((pct) => ({
	value: String(pct),
	label: pct === 0 ? "Only at breach" : `${pct}% before due`,
}))
const MAX_ACCOUNT_RESULTS = 6

const field = (h: H, editor: Editor, id: string) => editor.fields[id] ?? TextField.empty

const policyCard = (h: H, editor: Editor, errors: PolicyErrors, canEdit: boolean) => {
	const { form } = editor
	const isDisabled = !canEdit || editor.isSaving
	return card(
		h,
		{ key: "policy", title: "Policy" },
		h.grid.columns("2").children(
			h.textField
				.label("Name")
				.placeholder("e.g. Enterprise")
				.value(field(h, editor, "name"))
				.error(editor.showErrors ? errors.name : undefined)
				.disabled(isDisabled)
				.on("change", (payload) => SlaMessage.ChangedField({ field: "name", payload })),
			h.toggle
				.label("Status")
				.description(form.enabled ? "On" : "Off")
				.checked(form.enabled)
				.disabled(isDisabled)
				.on("change", ({ checked }) => SlaMessage.ToggledEnabled({ enabled: checked })),
			h.choiceGroup
				.label("Hours")
				.style("segmented")
				.options([
					{ value: "business", label: HOURS_LABEL.business },
					{ value: "always", label: HOURS_LABEL.always },
				])
				.selected([form.hours])
				.disabled(isDisabled)
				.description(
					form.hours === "business"
						? "Targets count working time only, from the business hours."
						: "Targets count every hour of the week.",
				)
				.on("change", ({ selected }) => SlaMessage.ChangedHours({ selected })),
			// HAZEL-GAP(pk8-select-description): today a help line sits under the select; `select` has none.
			h.stack.density("snug").children(
				h.select
					.label("Warn before")
					.options(WARN_ITEMS)
					.value(String(form.warnBeforePct))
					.disabled(isDisabled)
					.on("change", ({ value }) => SlaMessage.ChangedWarn({ value })),
				h.text.role("caption").tone("muted").children("A share of the target before it is due."),
			),
		),
	)
}

const help = (h: H, text: string) => h.text.role("caption").tone("muted").children(text)

const plansField = (h: H, plans: Plans, editor: Editor, canEdit: boolean) => {
	const names = planNamesOf(typeof plans === "string" ? [] : plans, editor.form.planNames)
	const status =
		plans === "failed"
			? h.stack
					.axis("horizontal")
					.align("center")
					.density("compact")
					.children(
						h.text.role("caption").tone("danger").children("The plans could not be loaded."),
						h.button
							.label("Retry")
							.variant("ghost")
							.size("small")
							.on("press", SlaMessage.PressedRetryPlans()),
					)
			: names.length === 0
				? help(
						h,
						plans === "loading"
							? "Loading plans…"
							: "No plans yet: they show once a billing source has synced.",
					)
				: null
	return h.stack.density("snug").children(
		names.length === 0 ? h.text.role("label").strong().children("Plans") : null,
		status,
		names.length === 0
			? null
			: h.choiceGroup
					.label("Plans")
					.style("chips")
					.multiple()
					.options(names.map((plan) => ({ value: plan, label: plan })))
					.selected(editor.form.planNames)
					.disabled(!canEdit || editor.isSaving)
					.on("change", ({ selected }) => SlaMessage.ChangedPlans({ selected })),
	)
}

const chips = (
	h: H,
	labels: ReadonlyArray<readonly [string, string]>,
	remove: ((id: string) => SlaMessage) | null,
) =>
	labels.length === 0
		? null
		: h.stack
				.axis("horizontal")
				.wrap()
				.density("snug")
				.children(
					...labels.map(([id, label]) =>
						remove === null
							? h.badge.key(id).label(label)
							: h.button
									.key(id)
									.label(label)
									.variant("chip")
									.size("xsmall")
									.removable()
									.on("remove", remove(id))
									.on("press", remove(id)),
					),
				)

const tagsField = (h: H, editor: Editor, canEdit: boolean) => {
	const { form } = editor
	const remove = canEdit && !editor.isSaving ? (tag: string) => SlaMessage.RemovedTag({ tag }) : null
	return h.stack.density("snug").children(
		h.text.role("label").strong().children("Tags"),
		chips(
			h,
			form.tags.map((tag) => [tag, tag] as const),
			remove,
		),
		canEdit
			? h.stack
					.axis("horizontal")
					.density("compact")
					.children(
						h.textField
							.placeholder("Any of these tags, e.g. vip")
							.value(field(h, editor, "tag"))
							.disabled(editor.isSaving)
							.on("change", (payload) => SlaMessage.ChangedField({ field: "tag", payload }))
							.on("submit", () => SlaMessage.PressedAddTag()),
						h.button
							.label("Add")
							.variant("outline")
							.disabled(form.tagInput.trim() === "" || editor.isSaving)
							.on("press", SlaMessage.PressedAddTag()),
					)
			: form.tags.length === 0
				? help(h, "None")
				: null,
	)
}

const accountsField = (h: H, model: SlaModel, editor: Editor, canEdit: boolean) => {
	const { form } = editor
	const nameOf = (accountId: string) =>
		model.accounts.find((account) => account.id === accountId)?.name ?? "Unknown customer"
	const query = form.accountSearch.trim().toLowerCase()
	const results =
		query === ""
			? []
			: model.accounts
					.filter(
						(account) =>
							!form.accountIds.includes(account.id) &&
							(account.name.toLowerCase().includes(query) ||
								(account.domain?.toLowerCase().includes(query) ?? false)),
					)
					.slice(0, MAX_ACCOUNT_RESULTS)
	const remove =
		canEdit && !editor.isSaving ? (accountId: string) => SlaMessage.RemovedAccount({ accountId }) : null
	return h.stack.density("snug").children(
		h.text.role("label").strong().children("Specific customers"),
		chips(
			h,
			form.accountIds.map((id) => [id, nameOf(id)] as const),
			remove,
		),
		...(canEdit
			? [
					h.searchField
						.placeholder("Search customers by name or domain")
						.value(field(h, editor, "accounts"))
						.on("change", (payload) => SlaMessage.ChangedField({ field: "accounts", payload })),
					query === ""
						? null
						: results.length === 0
							? help(h, "No matching customers.")
							: h.frame.surface("inset").children(
									...results.map((account) =>
										h.button
											.key(account.id)
											.label(account.name)
											.detail(account.domain ?? undefined)
											.icon("plus")
											.variant("ghost")
											.size("small")
											.disabled(editor.isSaving)
											.on("press", SlaMessage.AddedAccount({ accountId: account.id })),
									),
								),
				]
			: [form.accountIds.length === 0 ? help(h, "None") : null]),
	)
}

const appliesToCard = (h: H, model: SlaModel, plans: Plans, editor: Editor, canEdit: boolean) => {
	const { form } = editor
	const isDefault = form.planNames.length === 0 && form.tags.length === 0 && form.accountIds.length === 0
	return card(
		h,
		{
			key: "applies",
			title: "Applies to",
			description: "Any one match is enough. Leave everything empty for a default policy.",
			aside: isDefault ? h.badge.label("Default · any customer") : null,
		},
		plansField(h, plans, editor, canEdit),
		tagsField(h, editor, canEdit),
		accountsField(h, model, editor, canEdit),
	)
}

const BUSINESS_UNITS = [
	{ value: "minutes", label: "minutes" },
	{ value: "hours", label: "hours" },
]
const ALWAYS_UNITS = [...BUSINESS_UNITS, { value: "days", label: "days" }]

const targetsCard = (h: H, model: SlaModel, editor: Editor, errors: PolicyErrors, canEdit: boolean) => {
	const example = exampleLine(editor.form, businessHoursOf(model))
	const isDisabled = !canEdit || editor.isSaving
	// HAZEL-GAP(pk8-target-grid): today the targets are a `6rem | 1fr | 1fr` grid with column heads, each
	// amount a 5rem field beside a 7rem unit select; the field and select name themselves by their labels.
	return card(
		h,
		{
			key: "targets",
			title: "Targets",
			description:
				editor.form.hours === "business"
					? "Per issue priority, counted in working hours only."
					: "Per issue priority, around the clock.",
		},
		...PRIORITIES.map((priority) =>
			h.stack
				.key(priority)
				.density("snug")
				.children(
					h.text.role("label").strong().children(PRIORITY_LABEL[priority]),
					h.grid.columns("2").children(
						...CLOCKS.map((clock) =>
							h.stack
								.key(clock)
								.axis("horizontal")
								.align("start")
								.density("compact")
								.children(
									h.textField
										.label(CLOCK_LABEL[clock])
										.inputKind("number")
										.value(field(h, editor, `${priority}.${clock}`))
										.error(
											editor.showErrors
												? errors.targets[`${priority}.${clock}`]
												: undefined,
										)
										.disabled(isDisabled)
										.on("change", (payload) =>
											SlaMessage.ChangedField({
												field: `${priority}.${clock}`,
												payload,
											}),
										),
									h.select
										.label("Unit")
										.width("narrow")
										.options(
											editor.form.hours === "business" ? BUSINESS_UNITS : ALWAYS_UNITS,
										)
										.value(editor.form.targets[priority][clock].unit)
										.disabled(isDisabled)
										.on("change", ({ value }) =>
											SlaMessage.ChangedUnit({ priority, clock, value }),
										),
								),
						),
					),
				),
		),
		example === undefined
			? null
			: h.frame
					.surface("muted")
					.children(
						h.stack
							.axis("horizontal")
							.density("snug")
							.align("start")
							.children(h.icon.name("clock"), h.text.children(example)),
					),
	)
}

const editorView = (h: H, model: SlaModel, plans: Plans, editor: Editor, canEdit: boolean) => {
	const errors = policyErrors(editor.form)
	const isNew = editor.policyId === null
	const crumbs: ReadonlyArray<Crumb<SlaMessage>> = [
		// Plain text while a save is in flight: its answer closes the editor.
		editor.isSaving
			? { label: "Support SLAs" }
			: { label: "Support SLAs", press: SlaMessage.PressedCloseEditor() },
		{ label: isNew ? "New policy" : canEdit ? "Edit policy" : "Policy" },
	]
	return settingsColumn(h, "customers-settings-sla", [
		pageHeader(h, {
			title: isNew ? "New policy" : editor.form.name || "Policy",
			crumbs,
			actions: canEdit
				? [
						h.button
							.label("Cancel")
							.variant("ghost")
							.disabled(editor.isSaving)
							.on("press", SlaMessage.PressedCloseEditor()),
						h.button
							.label(isNew ? "Create policy" : "Save policy")
							.loading(editor.isSaving)
							.on("press", SlaMessage.PressedSavePolicy()),
					]
				: [h.button.label("Close").variant("ghost").on("press", SlaMessage.PressedCloseEditor())],
		}),
		canEdit ? null : readOnlyNotice(h, "SLA policies"),
		policyCard(h, editor, errors, canEdit),
		appliesToCard(h, model, plans, editor, canEdit),
		targetsCard(h, model, editor, errors, canEdit),
	])
}

// UPDATE HELPERS

const orgOf = (session: Session) =>
	isCustomersAdmin(session) && session.organization !== null ? session.organization.id : null

const slaWrite = (organizationId: OrganizationId, request: SlaWrite) =>
	RunSlaWrite.make({ organizationId, write: request })

interface Ctx {
	readonly model: SlaModel
	readonly props: SlaProps
}

const editedHours = ($: Ctx, change: (form: HoursForm) => HoursForm): SlaModel =>
	!isCustomersAdmin($.props.session) || $.model.isSavingHours
		? $.model
		: { ...$.model, hoursForm: change(hoursFormOf($.model)) }

const editedForm = ($: Ctx, change: (form: PolicyForm) => PolicyForm): SlaModel => {
	const editor = $.model.editor
	if (editor === null || editor.isSaving || !isCustomersAdmin($.props.session)) return $.model
	const form = change(editor.form)
	return { ...$.model, editor: { ...editor, form, fields: syncedFields(form, editor.fields) } }
}

const withTag = (form: PolicyForm): PolicyForm => {
	const tag = form.tagInput.trim().slice(0, 50)
	return tag === "" || form.tags.includes(tag) || form.tags.length >= 50
		? { ...form, tagInput: "" }
		: { ...form, tags: [...form.tags, tag], tagInput: "" }
}

const opened = (model: SlaModel, policyId: CustomerSlaPolicyId | null, form: PolicyForm): SlaModel => ({
	...model,
	editor: {
		policyId,
		token: model.editorsOpened + 1,
		form,
		fields: syncedFields(form, {}),
		showErrors: false,
		isSaving: false,
	},
	editorsOpened: model.editorsOpened + 1,
})

const isUnit = Schema.is(DurationUnit)
const isHours = Schema.is(Customers.SlaHours)

export const SlaPageNoDeps = SlaDef.make({
	init: () => ({
		policies: null,
		settings: null,
		accounts: [],
		plansAttempt: 0,
		hoursForm: null,
		isSavingHours: false,
		triageForm: null,
		isSavingTriage: false,
		isWritingList: false,
		editor: null,
		editorsOpened: 0,
		deleting: Confirm.closed,
	}),
	update: {
		UpdatedPolicies: ($, { policies }) => $.evolve({ policies: () => policies }),
		UpdatedSettings: ($, { settings }) => $.evolve({ settings: () => settings }),
		UpdatedAccounts: ($, { accounts }) => $.evolve({ accounts: () => accounts }),
		PressedRetryPlans: ($) => $.evolve({ plansAttempt: (attempt) => attempt + 1 }),

		ChangedTimeZone: ($, { value }) => editedHours($, (form) => ({ ...form, timeZone: value })),
		ChangedDays: ($, { selected }) => editedHours($, (form) => ({ ...form, days: selected.map(Number) })),
		ChangedStart: ($, { value }) => editedHours($, (form) => ({ ...form, start: value ?? "" })),
		ChangedEnd: ($, { value }) => editedHours($, (form) => ({ ...form, end: value ?? "" })),
		PressedSaveHours: ($) => {
			const organizationId = orgOf($.props.session)
			const { settings, hoursForm, isSavingHours } = $.model
			const businessHours = hoursForm === null ? undefined : businessHoursOfForm(hoursForm)
			if (organizationId === null || settings === null || businessHours === undefined || isSavingHours)
				return $.model
			return $.set({ ...$.model, isSavingHours: true }).run(
				slaWrite(organizationId, {
					_tag: "SaveHours",
					settingsId: settings.id,
					businessHours,
				}),
			)
		},
		PressedResetHours: ($) => ($.model.isSavingHours ? $.model : { ...$.model, hoursForm: null }),

		// Not before the saved settings are here: a draft made from the defaults would save fields nobody changed.
		ToggledTriage: ($, { enabled }) =>
			!isCustomersAdmin($.props.session) || $.model.isSavingTriage || $.model.settings === null
				? $.model
				: { ...$.model, triageForm: { ...triageFormOf($.model), enabled } },
		ChangedTriageAbout: ($, { payload }) =>
			!isCustomersAdmin($.props.session) || $.model.isSavingTriage || $.model.settings === null
				? $.model
				: (() => {
						const form = triageFormOf($.model)
						return {
							...$.model,
							triageForm: { ...form, about: TextField.changed(form.about, payload) },
						}
					})(),
		PressedSaveTriage: ($) => {
			const organizationId = orgOf($.props.session)
			const { settings, triageForm, isSavingTriage } = $.model
			if (
				organizationId === null ||
				settings === null ||
				triageForm === null ||
				triageForm.about.text.trim().length > ABOUT_MAX ||
				isSavingTriage
			)
				return $.model
			return $.set({ ...$.model, isSavingTriage: true }).run(
				slaWrite(organizationId, {
					_tag: "SaveTriage",
					settingsId: settings.id,
					supportTriage: { enabled: triageForm.enabled, about: triageForm.about.text.trim() },
				}),
			)
		},
		PressedResetTriage: ($) => ($.model.isSavingTriage ? $.model : { ...$.model, triageForm: null }),

		ToggledPolicy: ($, { policyId, enabled }) => {
			const organizationId = orgOf($.props.session)
			const policy = policyById($.model, policyId)
			if (organizationId === null || policy === undefined || $.model.isWritingList) return $.model
			return $.set({
				...$.model,
				isWritingList: true,
				policies: ($.model.policies ?? []).map((row) =>
					row.id === policyId ? { ...row, enabled } : row,
				),
			}).run(
				slaWrite(organizationId, {
					_tag: "Toggle",
					policyId,
					policy: draftOfRow({ ...policy, enabled }),
				}),
			)
		},
		PressedMove: ($, { policyId, offset }) => {
			const organizationId = orgOf($.props.session)
			const policies = $.model.policies ?? []
			const from = policies.findIndex((policy) => policy.id === policyId)
			const to = from + offset
			if (
				organizationId === null ||
				from === -1 ||
				to < 0 ||
				to >= policies.length ||
				$.model.isWritingList
			)
				return $.model
			const order = [...policies]
			const [policy] = order.splice(from, 1)
			if (policy === undefined) return $.model
			order.splice(to, 0, policy)
			return $.set({
				...$.model,
				isWritingList: true,
				policies: order.map((row, position) => ({ ...row, position })),
			}).run(slaWrite(organizationId, { _tag: "Reorder", policyIds: order.map((row) => row.id) }))
		},
		PressedDelete: ($, { policyId }) =>
			!isCustomersAdmin($.props.session) || policyById($.model, policyId) === undefined
				? $.model
				: $.evolve({ deleting: (state) => Confirm.ask(state, policyId) }),
		CancelledDelete: ($) => $.evolve({ deleting: Confirm.cancel }),
		PressedConfirmDelete: ($) => {
			const organizationId = orgOf($.props.session)
			const confirmed = Confirm.confirm($.model.deleting)
			if (organizationId === null || confirmed === undefined) return $.model
			const [, policyId] = confirmed
			return $.set({
				...$.model,
				deleting: Confirm.closed,
				policies: ($.model.policies ?? []).filter((policy) => policy.id !== policyId),
				editor: $.model.editor?.policyId === policyId ? null : $.model.editor,
			}).run(slaWrite(organizationId, { _tag: "Delete", policyId }))
		},

		PressedNewPolicy: ($) =>
			isCustomersAdmin($.props.session) ? opened($.model, null, newPolicyForm()) : $.model,
		PressedEdit: ($, { policyId }) => {
			const policy = policyById($.model, policyId)
			return policy === undefined ? $.model : opened($.model, policyId, formOfPolicy(policy))
		},
		// Waits for a save in flight: its answer closes the editor or shows why not.
		PressedCloseEditor: ($) =>
			$.model.editor?.isSaving === true ? $.model : { ...$.model, editor: null },
		ChangedField: ($, { field: id, payload }) => {
			const editor = $.model.editor
			if (editor === null || editor.isSaving || !isCustomersAdmin($.props.session)) return $.model
			const state = TextField.changed(editor.fields[id] ?? TextField.empty, payload)
			return {
				...$.model,
				editor: {
					...editor,
					fields: { ...editor.fields, [id]: state },
					form: withFieldText(editor.form, id, state.text),
				},
			}
		},
		ToggledEnabled: ($, { enabled }) => editedForm($, (form) => ({ ...form, enabled })),
		// Business hours have no "day" unit: day targets become hours.
		ChangedHours: ($, { selected }) => {
			const hours = selected[0]
			if (hours === undefined || !isHours(hours)) return $.model
			return editedForm($, (form) =>
				hours === "business"
					? { ...form, hours, targets: withoutDays(form.targets) }
					: { ...form, hours },
			)
		},
		ChangedWarn: ($, { value }) => editedForm($, (form) => ({ ...form, warnBeforePct: Number(value) })),
		ChangedPlans: ($, { selected }) => editedForm($, (form) => ({ ...form, planNames: selected })),
		PressedAddTag: ($) => editedForm($, withTag),
		RemovedTag: ($, { tag }) =>
			editedForm($, (form) => ({ ...form, tags: form.tags.filter((other) => other !== tag) })),
		AddedAccount: ($, { accountId }) =>
			editedForm($, (form) =>
				form.accountIds.includes(accountId)
					? form
					: { ...form, accountIds: [...form.accountIds, accountId], accountSearch: "" },
			),
		RemovedAccount: ($, { accountId }) =>
			editedForm($, (form) => ({
				...form,
				accountIds: form.accountIds.filter((other) => other !== accountId),
			})),
		ChangedUnit: ($, { priority, clock, value }) =>
			!isUnit(value)
				? $.model
				: editedForm($, (form) => ({
						...form,
						targets: {
							...form.targets,
							[priority]: {
								...form.targets[priority],
								[clock]: { ...form.targets[priority][clock], unit: value },
							},
						},
					})),
		PressedSavePolicy: ($) => {
			const organizationId = orgOf($.props.session)
			const editor = $.model.editor
			if (organizationId === null || editor === null || editor.isSaving) return $.model
			// A tag still in the box counts.
			const form = withTag(editor.form)
			const fields = syncedFields(form, editor.fields)
			const policy = draftOfForm(form)
			if (policy === undefined)
				return { ...$.model, editor: { ...editor, form, fields, showErrors: true } }
			return $.set({
				...$.model,
				editor: { ...editor, form, fields, showErrors: true, isSaving: true },
			}).run(
				slaWrite(organizationId, {
					_tag: "SavePolicy",
					policyId: editor.policyId,
					policy,
					token: editor.token,
				}),
			)
		},

		Settled: ($, { write: kind, ok, token }) =>
			Match.value(kind).pipe(
				Match.when("list", () => ({ ...$.model, isWritingList: false })),
				Match.when("delete", () => $.model),
				Match.when("hours", () => ({
					...$.model,
					isSavingHours: false,
					hoursForm: ok ? null : $.model.hoursForm,
				})),
				Match.when("triage", () => ({
					...$.model,
					isSavingTriage: false,
					triageForm: ok ? null : $.model.triageForm,
				})),
				// Only its own editor closes; a failed save lets the admin try again.
				Match.when("policy", () => {
					const editor = $.model.editor
					if (editor === null || editor.token !== token) return $.model
					return ok
						? { ...$.model, editor: null }
						: { ...$.model, editor: { ...editor, isSaving: false } }
				}),
				Match.exhaustive,
			),
	},
	subscriptions: ({ props }) => {
		const organizationId = props.session.organization?.id ?? ""
		const live = <A>(
			name: string,
			stream: (data: ClientData["Service"], id: OrganizationId) => Stream.Stream<A>,
		) =>
			Subscription.make(name, [organizationId], ([id]) =>
				id === ""
					? Stream.empty
					: Stream.unwrap(
							Effect.map(
								ClientData.useSync((data) => data),
								(data) => stream(data, OrganizationId.make(id)),
							),
						),
			)
		return [
			live("policies", (data, id) =>
				makeSettingsData(data).policiesStream(id, (policies) =>
					SlaMessage.UpdatedPolicies({ policies }),
				),
			),
			live("settings", (data, id) =>
				makeSettingsData(data).settingsStream(id, (settings) =>
					SlaMessage.UpdatedSettings({ settings }),
				),
			),
			live("accounts", (data, id) =>
				makeCustomerQueries(data).accountsStream(id, (accounts) =>
					SlaMessage.UpdatedAccounts({
						accounts: accounts.map((account) => ({
							id: account.id,
							name: account.name,
							domain: account.domain,
						})),
					}),
				),
			),
		]
	},
	view: (h, model) => {
		const canEdit = isCustomersAdmin(h.props.session)
		const plans: Plans = Match.value(h.queries.plans).pipe(
			Match.tag("Success", ({ value }): Plans => value),
			Match.tag("Failure", (): Plans => "failed"),
			Match.orElse((): Plans => "loading"),
		)
		if (model.editor !== null) return editorView(h, model, plans, model.editor, canEdit)
		const deleting = policyById(model, Confirm.targetOf(model.deleting))
		return settingsColumn(h, "customers-settings-sla", [
			pageHeader(h, { title: "Support SLAs", subtitle: SUBTITLE }),
			canEdit ? null : readOnlyNotice(h, "SLAs"),
			hoursCard(h, model, canEdit),
			policiesCard(h, model, canEdit),
			triageCard(h, model, canEdit),
			Confirm.confirmDialog(h, model.deleting, {
				key: "delete-policy",
				title: "Delete this policy?",
				description: `“${deleting?.name ?? "This policy"}” stops applying to new issues. Open issues keep the targets they started with.`,
				confirmLabel: "Delete policy",
				runningLabel: "Deleting...",
				confirmed: SlaMessage.PressedConfirmDelete(),
				cancelled: SlaMessage.CancelledDelete(),
			}),
		])
	},
})

/** The page with its plans query and write Command, on the host's data and RPC client. */
export const SlaPage = SlaPageNoDeps.pipe(
	Component.provide(Layer.mergeAll(GetPlans.layer, RunSlaWrite.layer)),
)
