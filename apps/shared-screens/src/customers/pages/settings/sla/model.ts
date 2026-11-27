/**
 * Support SLAs (`docs/customers/sla.md` §1–§2): the org's business hours, and the ordered policies
 * (first match wins) with their editor. The editor opens in place of the list.
 */
import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSlaPolicyId } from "@hazel/schema"
import { TextField } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import * as Confirm from "../../../../components/ConfirmAction"
import { PolicyRow, SettingsRow } from "../../../data/settings"

export { PolicyRow }

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
	/** The text fields' states, by field id (`fieldIds`); the form holds their text. */
	fields: Schema.Record(Schema.String, TextField.State),
	/** Save was pressed: the errors show from then on. */
	showErrors: Schema.Boolean,
	isSaving: Schema.Boolean,
})
export type Editor = typeof Editor.Type

/** The longest `SupportTriageSettings.about` the server takes. */
export const ABOUT_MAX = 2_000

/** The triage card's form: `about` as typed (its length is checked when saving). */
export const TriageForm = Schema.Struct({ enabled: Schema.Boolean, about: TextField.State })
export type TriageForm = typeof TriageForm.Type

// MODEL

export const SlaModel = Schema.Struct({
	/** Live rows; null until the query answers. */
	policies: Schema.NullOr(Schema.Array(PolicyRow)),
	/** Null until the settings row syncs. */
	settings: Schema.NullOr(SettingsRow),
	accounts: Schema.Array(AccountOption),
	/** Counts "Retry" on the plans: they are fetched again under a new key. */
	plansAttempt: Schema.Finite,
	/** Null: the saved hours, unedited. */
	hoursForm: Schema.NullOr(HoursForm),
	isSavingHours: Schema.Boolean,
	/** Null: the saved triage settings, unedited. The text is checked on save, not while typing. */
	triageForm: Schema.NullOr(TriageForm),
	isSavingTriage: Schema.Boolean,
	/** A reorder or toggle is in flight: the row controls wait, so writes cannot land out of order. */
	isWritingList: Schema.Boolean,
	/** Null: the list. */
	editor: Schema.NullOr(Editor),
	/** Editors opened so far: the next one's token. */
	editorsOpened: Schema.Int,
	deleting: Confirm.ConfirmState(CustomerSlaPolicyId),
})
export type SlaModel = typeof SlaModel.Type

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
export const hoursFormOf = (model: SlaModel): HoursForm =>
	model.hoursForm ?? model.settings?.businessHours ?? Customers.DEFAULT_BUSINESS_HOURS

/** The triage settings the card shows: the edit in progress, else the saved ones, else the default. */
export const triageFormOf = (model: SlaModel): TriageForm =>
	model.triageForm ?? triageFormFrom(model.settings?.supportTriage ?? Customers.DEFAULT_SUPPORT_TRIAGE)

export const triageFormFrom = (saved: Customers.SupportTriageSettings): TriageForm => ({
	enabled: saved.enabled,
	about: { text: saved.about, rev: 0, edit: 0 },
})

/** The org's saved working week (the editor's example uses it). */
export const businessHoursOf = (model: SlaModel): Customers.BusinessHours =>
	model.settings?.businessHours ?? Customers.DEFAULT_BUSINESS_HOURS

/** The plans to pick from: the subscriptions' and those the editor's policy already names. */
export const planNamesOf = (
	plans: ReadonlyArray<string>,
	selected: ReadonlyArray<string>,
): ReadonlyArray<string> => [...new Set([...plans, ...selected])].sort()

export const policyById = (
	model: SlaModel,
	policyId: CustomerSlaPolicyId | null | undefined,
): PolicyRow | undefined =>
	policyId == null ? undefined : model.policies?.find((policy) => policy.id === policyId)

// TEXT FIELDS

/** The editor's text fields: name, tag, account search, and each target's amount. */
export const fieldIds: ReadonlyArray<string> = [
	"name",
	"tag",
	"accounts",
	...PRIORITIES.flatMap((priority) => CLOCKS.map((clock) => `${priority}.${clock}`)),
]

export const fieldText = (form: PolicyForm, id: string): string => {
	if (id === "name") return form.name
	if (id === "tag") return form.tagInput
	if (id === "accounts") return form.accountSearch
	const [priority, clock] = id.split(".") as [Customers.SlaPriority, SlaClock]
	return form.targets[priority]?.[clock]?.amount ?? ""
}

/** The form with field `id`'s text set. */
export const withFieldText = (form: PolicyForm, id: string, text: string): PolicyForm => {
	if (id === "name") return { ...form, name: text }
	if (id === "tag") return { ...form, tagInput: text }
	if (id === "accounts") return { ...form, accountSearch: text }
	const [priority, clock] = id.split(".") as [Customers.SlaPriority, SlaClock]
	if (!PRIORITIES.includes(priority) || !CLOCKS.includes(clock)) return form
	return {
		...form,
		targets: {
			...form.targets,
			[priority]: {
				...form.targets[priority],
				[clock]: { ...form.targets[priority][clock], amount: text },
			},
		},
	}
}

/** The fields' states after the Model changed the form's text (a cleared tag, converted units). */
export const syncedFields = (
	form: PolicyForm,
	fields: Readonly<Record<string, TextField.State>>,
): Record<string, TextField.State> =>
	Object.fromEntries(
		fieldIds.map((id) => [id, TextField.set(fields[id] ?? TextField.empty, fieldText(form, id))]),
	)
