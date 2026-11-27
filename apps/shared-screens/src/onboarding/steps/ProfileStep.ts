// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The profile step (today's `steps/profile.ts`): the user's first and last name, saved through
 * `user.update`. The names start as `user.me`'s, which may arrive after the step opens; the form
 * shows a missing name only after an edit, as today's validates on change.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { ShowToast } from "../../app/requests"
import { Session } from "../../app/session"
import { CommonReason, copyOf, errorToast, reasonOf } from "../../modals/feedback"
import { StepHeader, StepNavigation } from "../components/StepLayout"
import { OnboardingStepEvents, type StepInput } from "./OnboardingStep"

/** Why `user.update` failed, beyond the shared reasons. */
export const UpdateProfileFailure = Schema.Union([Schema.Literals(["UserNotFound"]), CommonReason])
export type UpdateProfileFailure = typeof UpdateProfileFailure.Type

export const ProfileFormProps = Schema.Struct({ session: Session })
export type ProfileFormProps = typeof ProfileFormProps.Type

export const ProfileFormModel = Schema.Struct({
	/** `null` until edited: the field shows the session's name meanwhile. */
	firstName: Schema.NullOr(TextField.State),
	lastName: Schema.NullOr(TextField.State),
	isSubmitting: Schema.Boolean,
})
export type ProfileFormModel = typeof ProfileFormModel.Type

export const ProfileFormMessage = UiSchema.TaggedEnum({
	ChangedFirstName: { payload: TextField.ChangePayload },
	ChangedLastName: { payload: TextField.ChangePayload },
	SubmittedProfile: {},
	PressedBack: {},
	SucceededUpdateProfile: {},
	FailedUpdateProfile: { reason: UpdateProfileFailure },
})
export type ProfileFormMessage = typeof ProfileFormMessage.Type

/** The profile step's name, through `user.update`. */
export class UpdateProfile extends Command.Service<UpdateProfile>()("hazel/onboarding/UpdateProfile", {
	args: { userId: UserId, firstName: Schema.String, lastName: Schema.String },
	success: ProfileFormMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ userId, firstName, lastName }) =>
				rpc("user.update", { id: userId, firstName, lastName }).pipe(
					Effect.as(ProfileFormMessage.SucceededUpdateProfile()),
					Effect.catchTags({
						UserNotFoundError: () =>
							Effect.succeed(
								ProfileFormMessage.FailedUpdateProfile({ reason: "UserNotFound" }),
							),
					}),
					// BOUNDARY: every other failure reads as its common reason, never the server's text.
					Effect.catchCause((cause) =>
						Effect.succeed(ProfileFormMessage.FailedUpdateProfile({ reason: reasonOf(cause) })),
					),
				)
		}),
	)
}

const failureToast = (reason: UpdateProfileFailure) =>
	errorToast(
		copyOf(reason, {
			UserNotFound: {
				title: "User not found",
				description: "Your account could not be found. Please try signing in again.",
			},
		}),
	)

/** A field's state: the edit, else the session's name as a Model edit the field takes in. */
const fieldOf = (state: TextField.State | null, seed: string): TextField.State =>
	state ?? TextField.set(TextField.empty, seed)

const namesOf = (model: ProfileFormModel, props: ProfileFormProps) => ({
	firstName: fieldOf(model.firstName, props.session.user?.firstName ?? ""),
	lastName: fieldOf(model.lastName, props.session.user?.lastName ?? ""),
})

const isMissing = (field: TextField.State) => field.text.trim() === ""

const ProfileFormDef = Hazel.component({
	name: "ProfileForm",
	props: ProfileFormProps,
	model: ProfileFormModel,
	message: ProfileFormMessage,
	events: OnboardingStepEvents,
	// After Back, a save that was in flight is not running any more.
	restore: (model) => ({ ...model, isSubmitting: false }),
})

export const ProfileFormNoDeps = ProfileFormDef.make({
	init: () => ({ firstName: null, lastName: null, isSubmitting: false }),
	update: {
		ChangedFirstName: ($, { payload }) =>
			$.evolve({ firstName: () => TextField.changed(namesOf($.model, $.props).firstName, payload) }),
		ChangedLastName: ($, { payload }) =>
			$.evolve({ lastName: () => TextField.changed(namesOf($.model, $.props).lastName, payload) }),
		SubmittedProfile: ($) => {
			const names = namesOf($.model, $.props)
			const userId = $.props.session.user?.id
			if ($.model.isSubmitting) return $.model
			// A refused submit shows what is missing, as an edit would.
			if (isMissing(names.firstName) || isMissing(names.lastName) || userId === undefined)
				return $.evolve({ firstName: () => names.firstName, lastName: () => names.lastName })
			return $.evolve({ isSubmitting: true }).run(
				UpdateProfile.make({
					userId,
					firstName: names.firstName.text.trim(),
					lastName: names.lastName.text.trim(),
				}),
			)
		},
		PressedBack: ($) => ($.model.isSubmitting ? $.model : $.emit(OnboardingStepEvents.RequestedBack())),
		SucceededUpdateProfile: ($) =>
			$.model.isSubmitting
				? $.evolve({ isSubmitting: false }).emit(OnboardingStepEvents.Continued({ patch: {} }))
				: $.model,
		FailedUpdateProfile: ($, { reason }) =>
			$.evolve({ isSubmitting: false }).run(ShowToast.make({ toast: failureToast(reason) })),
	},
	view: (h, model) => {
		const names = namesOf(model, h.props)
		// Edited and empty: today marks the field invalid with no words (`aria-invalid` only).
		// HAZEL-GAP(p4-field-invalid-silent): `textField` shows invalid only with an error line.
		const errorOf = (edited: TextField.State | null, label: string) =>
			edited !== null && isMissing(edited) ? `${label} is required` : undefined
		const firstError = errorOf(model.firstName, "First name")
		const lastError = errorOf(model.lastName, "Last name")
		return h.stack.density("relaxed").children(
			StepHeader(h, {
				title: "Set up your profile",
				description: "Tell us a bit about yourself to personalize your experience",
			}),
			// HAZEL-GAP(p4-field-autofocus): today's first name field takes focus when the step opens.
			h.stack.children(
				h.textField
					.label("First name")
					.placeholder("John")
					.description("Your first name as you'd like it to appear")
					.value(names.firstName)
					.error(firstError)
					.on("change", (payload) => ProfileFormMessage.ChangedFirstName({ payload }))
					.on("submit", () => ProfileFormMessage.SubmittedProfile()),
				h.textField
					.label("Last name")
					.placeholder("Doe")
					.description("Your last name as you'd like it to appear")
					.value(names.lastName)
					.error(lastError)
					.on("change", (payload) => ProfileFormMessage.ChangedLastName({ payload }))
					.on("submit", () => ProfileFormMessage.SubmittedProfile()),
			),
			StepNavigation(h, {
				onContinue: ProfileFormMessage.SubmittedProfile(),
				onBack: ProfileFormMessage.PressedBack(),
				canContinue: firstError === undefined && lastError === undefined,
				isLoading: model.isSubmitting,
			}),
		)
	},
})

export const ProfileForm = ProfileFormNoDeps.pipe(Component.provide(UpdateProfile.layer))

/** The registry's entry: the component, its events mapped to the shell's Continue and Back. */
export const ProfileStep = <Msg>(h: Hazel.H<Msg>, { session, continued, back }: StepInput<Msg>) =>
	ProfileForm(h, {
		key: "profile",
		props: { session },
		onEmit: {
			Continued: ({ patch }) => continued(patch),
			RequestedBack: () => back,
		},
	})
