import { OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Match, Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import { ThemeMode } from "../../theme"
import * as Interaction from "../../ui/aria/interaction"
import * as ChoiceBox from "../../ui/choice-box"
import * as ChatMigration from "../shared/chat-migration"
import { Direction, Step, UserType } from "./flow"

/** The theme step reads and requests `Shared.theme`; it keeps no theme state of its own. */
export const Theme = ThemeMode
export type Theme = ThemeMode

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
})
export type Data = typeof Data.Type

/** Why `user.update` failed (the timezone step), beyond the shared reasons. */
export const UpdateUserFailure = Schema.Union([Schema.Literals(["UserNotFound"]), CommonReason])
export type UpdateUserFailure = typeof UpdateUserFailure.Type

export const InviteRowError = Schema.Literals(["InvalidEmail"])
export type InviteRowError = typeof InviteRowError.Type

/** One address field; `id` keys the row, so removing one keeps focus on the right input. */
export const InviteRow = Schema.Struct({
	id: Schema.Finite,
	email: Schema.String,
	error: Schema.Option(InviteRowError),
})
export type InviteRow = typeof InviteRow.Type

/**
 * The step on screen with its own form state. A step's state is created fresh whenever the step
 * is entered, like the legacy step components remounting. `Native`: a step the native shell
 * (`shared-screens/src/onboarding`) draws itself; this page draws nothing for it.
 */
export const StepState = defineTaggedUnion({
	Native: { step: Step },
	Timezone: {
		selected: Schema.NullOr(Schema.String),
		query: Schema.String,
		debouncedQuery: Schema.String,
		hoveredOffset: Schema.NullOr(Schema.Finite),
		detectionAttempted: Schema.Boolean,
		isSubmitting: Schema.Boolean,
	},
	Theme: {},
	UseCases: { box: ChoiceBox.Model },
	Role: { box: ChoiceBox.Model },
	/** Bring channels over from Slack or Discord (optional; skippable). */
	Import: { migration: ChatMigration.Model },
	Invite: { rows: Schema.Array(InviteRow), nextRowId: Schema.Finite, isSending: Schema.Boolean },
	/** `failure` once `user.finalizeOnboarding` failed; the user can retry from here. */
	Finalizing: { failure: Schema.Option(CommonReason) },
	Completed: {},
})
export type StepState = typeof StepState.Type
export type StepOf<Tag extends StepState["_tag"]> = Extract<StepState, { readonly _tag: Tag }>

/** The flow, fixed when it starts (`userType`) or kept current by the live query (`membership`). */
export const Flow = Schema.Struct({
	userType: UserType,
	membership: Schema.NullOr(Membership),
	browserTimezone: Schema.String,
})
export type Flow = typeof Flow.Type

/**
 * `Starting`: waiting for the browser timezone and the membership query, both needed to pick the
 * flow. `Leaving`: an onboarded user who landed here is on the way to `/`.
 */
export const Phase = defineTaggedUnion({
	Starting: {
		membership: Schema.Option(Schema.NullOr(Membership)),
		browserTimezone: Schema.Option(Schema.String),
	},
	Leaving: {},
	Running: {
		flow: Flow,
		step: StepState,
		direction: Direction,
		data: Data,
	},
})
export type Phase = typeof Phase.Type
export type Running = Extract<Phase, { readonly _tag: "Running" }>

export const Model = Schema.Struct({
	/** The route's `?step=` and `?orgId=` at load; later step changes rewrite the URL from these. */
	urlStep: Schema.NullOr(Schema.String),
	orgId: Schema.NullOr(OrganizationId),
	phase: Phase,
	/** Answers kept across the import step's OAuth redirect, read before the flow starts. */
	restoredData: Schema.NullOr(Data),
	/** Focus and hover state for the form fields (React Aria's `data-focused` and friends). */
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

/** The flow position (and `?step=` value) of a step state. */
export const stepOf = (state: StepState): Step =>
	Match.valueTags(state, {
		Native: ({ step }): Step => step,
		Timezone: (): Step => "timezoneSelection",
		Theme: (): Step => "themeSelection",
		UseCases: (): Step => "useCases",
		Role: (): Step => "role",
		Import: (): Step => "import",
		Invite: (): Step => "teamInvitation",
		Finalizing: (): Step => "finalization",
		Completed: (): Step => "completed",
	})

/** A step with a request in flight (or finishing the flow): Back and resubmits wait for it. */
export const isBusy = (state: StepState): boolean =>
	Match.valueTags(state, {
		Native: () => false,
		Timezone: ({ isSubmitting }) => isSubmitting,
		Theme: () => false,
		UseCases: () => false,
		Role: () => false,
		Import: ({ migration }) => ChatMigration.isBusy(migration),
		Invite: ({ isSending }) => isSending,
		Finalizing: () => true,
		Completed: () => true,
	})
