import { OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import * as Interaction from "../../ui/aria/interaction"
import * as ChoiceBox from "../../ui/choice-box"
import { Direction, Step, UserType } from "./flow"

export const Theme = Schema.Literals(["system", "light", "dark"])
export type Theme = typeof Theme.Type

/** The user's first organization membership (creator vs invited flow). */
export const Membership = Schema.Struct({
	organizationId: OrganizationId,
	memberId: OrganizationMemberId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
})
export type Membership = typeof Membership.Type

/** `OnboardingData`: what the finished steps collected. */
export const Data = Schema.Struct({
	timezone: Schema.NullOr(Schema.String),
	useCases: Schema.Array(Schema.String),
	role: Schema.NullOr(Schema.String),
	emails: Schema.Array(Schema.String),
})
export type Data = typeof Data.Type

/** Each step's local form state; it resets whenever the step is entered, like a remount. */
export const StepForm = defineTaggedUnion({
	None: {},
	Profile: {
		firstName: Schema.String,
		lastName: Schema.String,
		/** The form validates on change, so errors show only after an edit. */
		hasChanged: Schema.Boolean,
		isSubmitting: Schema.Boolean,
	},
	Timezone: {
		selected: Schema.NullOr(Schema.String),
		query: Schema.String,
		debouncedQuery: Schema.String,
		hoveredOffset: Schema.NullOr(Schema.Number),
		detectionAttempted: Schema.Boolean,
		isSubmitting: Schema.Boolean,
	},
	Theme: { theme: Theme, brandColor: Schema.String },
	Choice: { box: ChoiceBox.Model },
	Invite: {
		emails: Schema.Array(Schema.String),
		errors: Schema.Record(Schema.String, Schema.String),
		isLoading: Schema.Boolean,
	},
})
export type StepForm = typeof StepForm.Type

export const Model = Schema.Struct({
	/** The route's `?step=` and `?orgId=` at load; later step changes rewrite the URL from these. */
	urlStep: Schema.NullOr(Schema.String),
	orgId: Schema.NullOr(OrganizationId),
	/** `undefined` until the live query is ready. */
	membership: Schema.UndefinedOr(Schema.NullOr(Membership)),
	isInitialized: Schema.Boolean,
	step: Step,
	direction: Direction,
	/** `AnimatePresence initial={false}`: the first step appears without its enter transition. */
	animatesStep: Schema.Boolean,
	userType: UserType,
	data: Data,
	form: StepForm,
	isProcessing: Schema.Boolean,
	error: Schema.NullOr(Schema.String),
	/** `undefined` until read; the flow starts once it is known. */
	browserTimezone: Schema.UndefinedOr(Schema.String),
	hasRedirected: Schema.Boolean,
	/** Focus and hover state for the form fields (React Aria's `data-focused` and friends). */
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
