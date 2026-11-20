import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSettingsId, CustomerSlaPolicyId } from "@hazel/schema"
import { Option, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import * as Modal from "../../../../ui/modal"
import * as Select from "../../../../ui/select"

/**
 * Support SLAs (`docs/customers/sla.md` §1–§2): the org's business hours, and the ordered policies
 * (first match wins) with their editor. The editor opens in place of the list.
 */

// ROWS

/** A live policy as the page keeps it. */
export const PolicyRow = Schema.Struct({
	id: CustomerSlaPolicyId,
	name: Schema.String,
	position: Schema.Int,
	enabled: Schema.Boolean,
	appliesTo: Customers.SlaAppliesTo,
	targets: Customers.SlaTargets,
	hours: Customers.SlaHours,
	warnBeforePct: Schema.Int,
})
export type PolicyRow = typeof PolicyRow.Type

/** The settings row's business hours, with the row they are saved to. */
export const SavedHours = Schema.Struct({
	settingsId: CustomerSettingsId,
	businessHours: Customers.BusinessHours,
})
export type SavedHours = typeof SavedHours.Type

/** What the account picker needs of an account. */
export const AccountOption = Schema.Struct({
	id: CustomerAccountId,
	name: Schema.String,
	domain: Schema.NullOr(Schema.String),
})
export type AccountOption = typeof AccountOption.Type

// FORMS

/** The business hours as typed; validated before saving (`hoursErrors`). */
export const HoursForm = Schema.Struct({
	timeZone: Schema.String,
	days: Schema.Array(Schema.Int),
	start: Schema.String,
	end: Schema.String,
})
export type HoursForm = typeof HoursForm.Type

export const DurationUnit = Schema.Literals(["minutes", "hours", "days"])
export type DurationUnit = typeof DurationUnit.Type

/** A target as typed: the amount stays text until saved. */
export const DurationForm = Schema.Struct({ amount: Schema.String, unit: DurationUnit })
export type DurationForm = typeof DurationForm.Type

export const SlaClock = Schema.Literals(["firstResponse", "resolution"])
export type SlaClock = typeof SlaClock.Type

const TargetForm = Schema.Struct({ firstResponse: DurationForm, resolution: DurationForm })
export const TargetsForm = Schema.Struct({
	urgent: TargetForm,
	high: TargetForm,
	medium: TargetForm,
	low: TargetForm,
})
export type TargetsForm = typeof TargetsForm.Type

export const PolicyForm = Schema.Struct({
	name: Schema.String,
	enabled: Schema.Boolean,
	hours: Customers.SlaHours,
	warnBeforePct: Schema.Int,
	planNames: Schema.Array(Schema.String),
	tags: Schema.Array(Schema.String),
	/** The tag being typed; Enter or "Add" makes it a chip. */
	tagInput: Schema.String,
	accountIds: Schema.Array(Schema.String),
	accountSearch: Schema.String,
	targets: TargetsForm,
})
export type PolicyForm = typeof PolicyForm.Type

export const Editor = Schema.Struct({
	/** Null: a new policy. */
	policyId: Schema.NullOr(CustomerSlaPolicyId),
	/** Which opening of the editor this is: a save's answer for an earlier one is dropped. */
	token: Schema.Int,
	form: PolicyForm,
	/** Save was pressed: the errors show from then on. */
	showErrors: Schema.Boolean,
	isSaving: Schema.Boolean,
})
export type Editor = typeof Editor.Type

export const Plans = AsyncData.Schema(Schema.Array(Schema.String), CommonReason)
export type Plans = typeof Plans.schema.Type

// MODEL

export const Model = Schema.Struct({
	/** Live rows; null until the query answers. */
	policies: Schema.NullOr(Schema.Array(PolicyRow)),
	/** Null until the settings row syncs. */
	settings: Schema.NullOr(SavedHours),
	accounts: Schema.Array(AccountOption),
	/** `customers.plans.list`, for the plan picker. */
	plans: Plans.schema,
	/** Null: the saved hours, unedited. */
	hoursForm: Schema.NullOr(HoursForm),
	isSavingHours: Schema.Boolean,
	/** A reorder or toggle is in flight: the row controls wait, so writes cannot land out of order. */
	isWritingList: Schema.Boolean,
	/** Null: the list. */
	editor: Schema.NullOr(Editor),
	/** Editors opened so far: the next one's token. */
	editorsOpened: Schema.Int,
	deleteModal: Modal.Model,
	deletingPolicyId: Schema.NullOr(CustomerSlaPolicyId),
	/** The page's Selects (time zone, warn before, each target's unit), by id. */
	selects: Schema.Record(Schema.String, Select.Model),
})
export type Model = typeof Model.Type

export const DELETE_MODAL_ID = "sla-delete-policy"
export const TIME_ZONE_SELECT_ID = "sla-time-zone"
export const WARN_SELECT_ID = "sla-warn-before"
export const unitSelectId = (priority: Customers.SlaPriority, clock: SlaClock) =>
	`sla-unit-${priority}-${clock}`

export const PRIORITIES = Customers.SlaPriority.literals
export const CLOCKS: ReadonlyArray<SlaClock> = ["firstResponse", "resolution"]
export const WARN_OPTIONS: ReadonlyArray<number> = [0, 10, 25, 50]

/** Common IANA zones for the picker; the saved zone is added when it is not among them. */
export const COMMON_TIME_ZONES: ReadonlyArray<string> = [
	"UTC",
	"America/Los_Angeles",
	"America/Denver",
	"America/Chicago",
	"America/New_York",
	"America/Sao_Paulo",
	"Europe/London",
	"Europe/Dublin",
	"Europe/Lisbon",
	"Europe/Paris",
	"Europe/Berlin",
	"Europe/Amsterdam",
	"Europe/Madrid",
	"Europe/Stockholm",
	"Europe/Helsinki",
	"Europe/Istanbul",
	"Africa/Johannesburg",
	"Asia/Dubai",
	"Asia/Kolkata",
	"Asia/Singapore",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Australia/Sydney",
	"Pacific/Auckland",
]

/** The hours the card shows: the edit in progress, else the saved ones, else the default. */
export const hoursFormOf = (model: Model): HoursForm =>
	model.hoursForm ?? model.settings?.businessHours ?? Customers.DEFAULT_BUSINESS_HOURS

/** The org's saved working week (the editor's example uses it). */
export const businessHoursOf = (model: Model): Customers.BusinessHours =>
	model.settings?.businessHours ?? Customers.DEFAULT_BUSINESS_HOURS

/** The plans to pick from: the subscriptions' and those the editor's policy already names. */
export const planNamesOf = (model: Model, selected: ReadonlyArray<string>): ReadonlyArray<string> =>
	[...new Set([...Option.getOrElse(AsyncData.getData(model.plans), () => []), ...selected])].sort()

export const policyById = (model: Model, policyId: CustomerSlaPolicyId | null): PolicyRow | undefined =>
	policyId === null ? undefined : model.policies?.find((policy) => policy.id === policyId)
