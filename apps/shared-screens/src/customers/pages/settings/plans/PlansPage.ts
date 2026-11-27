// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/customers/settings/plans` (`web-foldkit/src/page/customers/settings/plans`, now
 * deleted): which plans are add-ons billed on top of a base plan. A customer's plan is its base
 * plan; add-ons still count toward its MRR.
 */
import { Command, Component, Query, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { CustomerSettingsId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { Session } from "../../../../app/session"
import { commonCopy, CommonReason, errorToast, reasonOf, toast } from "../../../../modals/feedback"
import { modalServices } from "../../../../modals/services"
import { makeSettingsData, SettingsRow } from "../../../data/settings"
import { isCustomersAdmin, pageHeader, readOnlyNotice, settingsColumn } from "../settings-page"

const SUBTITLE =
	"Which plans are add-ons billed on top of a base plan. A customer’s plan is its base plan; add-ons still count toward its MRR."

export const PlansProps = Schema.Struct({ session: Session })
export type PlansProps = typeof PlansProps.Type

export const PlansModel = Schema.Struct({
	/** The synced settings row; null until it syncs. */
	settings: Schema.NullOr(SettingsRow),
	/** Counts "Try again": the plans are fetched again under a new key. */
	attempt: Schema.Finite,
	/** A save is in flight: the switches wait for it, so saves cannot land out of order. */
	isSaving: Schema.Boolean,
})
export type PlansModel = typeof PlansModel.Type

export const PlansMessage = UiSchema.TaggedEnum({
	UpdatedSettings: { settings: Schema.NullOr(SettingsRow) },
	ToggledAddOn: { plan: Schema.String, isAddOn: Schema.Boolean },
	PressedRetry: {},
	SettledSave: {},
})
export type PlansMessage = typeof PlansMessage.Type

/** `customers.plans.list`: the plan names on the org's subscriptions. */
export class GetPlans extends Query.Service<GetPlans>()("hazel/customers/GetPlans", {
	args: { organizationId: OrganizationId, attempt: Schema.Finite },
	success: Schema.Array(Schema.String),
	error: CommonReason,
	staleTime: "1 minute",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId }) =>
				rpc("customers.plans.list", { organizationId }).pipe(
					Effect.map(({ plans }) => plans),
					Effect.mapError(reasonOf),
				)
		}),
	)
}

/** Saves the add-on plans; a failure rolls the row back and says why. */
export class SavePlans extends Command.Service<SavePlans>()("hazel/customers/SavePlans", {
	args: {
		organizationId: OrganizationId,
		settingsId: CustomerSettingsId,
		addOnPlans: Schema.Array(Schema.String),
	},
	success: PlansMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { saveSettingsAction } = makeSettingsData(data)
			return ({ organizationId, settingsId, addOnPlans }) =>
				run(
					saveSettingsAction({ organizationId, settingsId, change: { addOnPlans } }).pipe(
						Effect.as(PlansMessage.SettledSave()),
						// BOUNDARY: every failure reads as its common reason.
						Effect.catchCause((cause) =>
							toast(
								errorToast(
									commonCopy(reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause)))),
								),
							).pipe(Effect.as(PlansMessage.SettledSave())),
						),
					),
				)
		}),
	)
}

/** The listed plans: the subscriptions' and the saved add-ons (so one no longer sold can be unmarked). */
export const planNamesOf = (plans: ReadonlyArray<string>, addOns: ReadonlyArray<string>) =>
	[...new Set([...plans, ...addOns])].sort()

const PlansDef = Hazel.component({
	name: "PlansPage",
	props: PlansProps,
	model: PlansModel,
	message: PlansMessage,
	queries: {
		plans: {
			query: GetPlans,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: { organizationId: props.session.organization.id, attempt: model.attempt },
		},
	},
	restore: (model) => ({ ...model, isSaving: false }),
})

type H = Parameters<Parameters<typeof PlansDef.make>[0]["view"]>[0]

const plansCard = (h: H, model: PlansModel, plans: ReadonlyArray<string>, canEdit: boolean) => {
	const addOns = model.settings?.addOnPlans ?? []
	const names = planNamesOf(plans, addOns)
	if (names.length === 0)
		return h.frame
			.surface("card")
			.children(
				h.emptyState
					.icon("cube")
					.title("No plans yet")
					.description("Plans show up here once a billing source has synced subscriptions."),
			)
	// HAZEL-GAP(pk8-row-gutter): today's rows are `px-4 py-3`, `sm:px-5`; the `bar` inset stays at 16px.
	return h.frame.surface("flush").children(
		...names
			.flatMap((plan, index) => [
				index === 0 ? null : h.divider.key(`divider-${plan}`),
				h.stack
					.key(plan)
					.axis("horizontal")
					.align("center")
					.inset("bar")
					.children(
						// HAZEL-GAP(pk8-toggle-label-trailing): today the plan's name leads the row and "Add-on"
						// sits by the switch; the toggle's label leads, so the row reads the plan's name only.
						h.toggle
							.label(plan)
							.checked(addOns.includes(plan))
							.disabled(!canEdit || model.isSaving)
							.on("change", ({ checked }) =>
								PlansMessage.ToggledAddOn({ plan, isAddOn: checked }),
							),
					),
			])
			.filter((item) => item !== null),
	)
}

const failure = (h: H, reason: CommonReason) => {
	const copy = commonCopy(reason)
	return h.frame.surface("card").children(
		h.emptyState
			.title(copy.title)
			.description(copy.description ?? "")
			.action(
				h.button
					.label("Try again")
					.icon("refresh")
					.variant("outline")
					.size("small")
					.on("press", PlansMessage.PressedRetry()),
			),
	)
}

export const PlansPageNoDeps = PlansDef.make({
	init: () => ({ settings: null, attempt: 0, isSaving: false }),
	update: {
		UpdatedSettings: ($, { settings }) => $.evolve({ settings: () => settings }),
		ToggledAddOn: ($, { plan, isAddOn }) => {
			const { settings, isSaving } = $.model
			const organization = $.props.session.organization
			if (settings === null || organization === null || isSaving || !isCustomersAdmin($.props.session))
				return $.model
			const others = settings.addOnPlans.filter((name) => name !== plan)
			const addOnPlans = isAddOn ? [...others, plan] : others
			return $.set({ ...$.model, settings: { ...settings, addOnPlans }, isSaving: true }).run(
				SavePlans.make({ organizationId: organization.id, settingsId: settings.id, addOnPlans }),
			)
		},
		PressedRetry: ($) => $.evolve({ attempt: (attempt) => attempt + 1 }),
		// On failure the collection rolls the row back, and the settings stream with it.
		SettledSave: ($) => $.evolve({ isSaving: () => false }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("settings", [props.session.organization?.id ?? ""], ([organizationId]) =>
			organizationId === ""
				? Stream.empty
				: Stream.unwrap(
						Effect.map(ClientData.useSync(makeSettingsData), (data) =>
							data.settingsStream(OrganizationId.make(organizationId), (settings) =>
								PlansMessage.UpdatedSettings({ settings }),
							),
						),
					),
		),
	],
	view: (h, model) => {
		const canEdit = isCustomersAdmin(h.props.session)
		const body = Match.value(h.queries.plans).pipe(
			Match.tag("Failure", ({ cause }) =>
				failure(
					h,
					Option.getOrElse(Cause.findErrorOption(cause), (): CommonReason => "Unexpected"),
				),
			),
			Match.tag("Success", ({ value }) =>
				model.settings === null
					? h.progress.style("spinner").label("Loading plans")
					: plansCard(h, model, value, canEdit),
			),
			Match.orElse(() => h.progress.style("spinner").label("Loading plans")),
		)
		return settingsColumn(h, "customers-settings-plans", [
			pageHeader(h, { title: "Plans", subtitle: SUBTITLE }),
			canEdit ? null : readOnlyNotice(h, "plans"),
			body,
		])
	},
})

/** The page with its plans query and save Command, on the host's data and RPC client. */
export const PlansPage = PlansPageNoDeps.pipe(
	Component.provide(Layer.mergeAll(GetPlans.layer, SavePlans.layer)),
)
