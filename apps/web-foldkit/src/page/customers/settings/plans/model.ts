import { CustomerSettingsId } from "@hazel/schema"
import { Option, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"

/**
 * Plans: whether usage overage counts in MRR (`overageInMrr`), the plan names on the org's
 * subscriptions, and which are add-ons (`addOnPlans`). An account's plan is its base plan while it
 * has one; add-ons still count for its MRR.
 */

export const SavedSettings = Schema.Struct({
	id: CustomerSettingsId,
	addOnPlans: Schema.Array(Schema.String),
	overageInMrr: Schema.Boolean,
})
export type SavedSettings = typeof SavedSettings.Type

/** What one save changes. */
export const SettingsChange = Schema.Struct({
	addOnPlans: Schema.optionalKey(Schema.Array(Schema.String)),
	overageInMrr: Schema.optionalKey(Schema.Boolean),
})
export type SettingsChange = typeof SettingsChange.Type

export const Plans = AsyncData.Schema(Schema.Array(Schema.String), CommonReason)
export type Plans = typeof Plans.schema.Type

export const Model = Schema.Struct({
	/** The synced settings row; null until it syncs. */
	settings: Schema.NullOr(SavedSettings),
	/** `customers.plans.list`. */
	plans: Plans.schema,
	/** A save is in flight: the switches wait for it, so saves cannot land out of order. */
	isSaving: Schema.Boolean,
})
export type Model = typeof Model.Type

/** The listed plans: the subscriptions' and the saved add-ons (so one no longer sold can be unmarked). */
export const planNamesOf = (model: Model): ReadonlyArray<string> =>
	[
		...new Set([
			...Option.getOrElse(AsyncData.getData(model.plans), () => []),
			...(model.settings?.addOnPlans ?? []),
		]),
	].sort()
