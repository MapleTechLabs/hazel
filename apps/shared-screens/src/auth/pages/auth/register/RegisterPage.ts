// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/auth/register` (`web-foldkit/src/page/auth/register`, now deleted): a verified provider identity
 * with no Hazel account yet picks a name, and the account is created and signed in.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { authFrame, messageText, textLink } from "../../../components/AuthFrame"
import { AuthFailure, authFailureMessage } from "../../../domain/AuthFailure"
import { AuthFlows } from "../../../services/AuthFlows"

/**
 * `Invalid`: a submit was blocked by a missing name, so field errors show from then on (not while
 * the visitor is still typing). `Submitting` stays until the browser navigates away.
 */
export const Submission = UiSchema.TaggedEnum({
	NotSubmitted: {},
	Invalid: {},
	Submitting: {},
	Failed: { reason: AuthFailure },
})
export type Submission = typeof Submission.Type

export const RegisterProps = Schema.Struct({
	/** From the OAuth callback's redirect; either missing makes the link unusable. */
	flowId: Schema.NullOr(Schema.String),
	reference: Schema.NullOr(Schema.String),
	/** `/sign-in`, to start again. */
	signInHref: Schema.String,
})
export type RegisterProps = typeof RegisterProps.Type

export const RegisterModel = Schema.Struct({
	firstName: TextField.State,
	lastName: TextField.State,
	submission: Submission,
})
export type RegisterModel = typeof RegisterModel.Type

export const RegisterMessage = UiSchema.TaggedEnum({
	ChangedFirstName: { payload: TextField.ChangePayload },
	ChangedLastName: { payload: TextField.ChangePayload },
	SubmittedRegistration: {},
	/** The account exists and the browser is loading the app. */
	LeftForApp: {},
	FailedRegistration: { reason: AuthFailure },
})
export type RegisterMessage = typeof RegisterMessage.Type

export class Register extends Command.Service<Register>()("hazel/auth/Register", {
	args: {
		flowId: Schema.String,
		reference: Schema.String,
		firstName: Schema.String,
		lastName: Schema.String,
	},
	success: RegisterMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) => (input) =>
				flows.register(input).pipe(
					Effect.match({
						onSuccess: () => RegisterMessage.LeftForApp(),
						onFailure: ({ reason }) => RegisterMessage.FailedRegistration({ reason }),
					}),
				),
		),
	)
}

export const isFirstNameMissing = (model: RegisterModel) => model.firstName.text.trim().length === 0

const RegisterDef = Hazel.component({
	name: "RegisterPage",
	props: RegisterProps,
	model: RegisterModel,
	message: RegisterMessage,
	// After Back, a registration that was in flight is not running any more.
	restore: (model) =>
		model.submission._tag === "Submitting" ? { ...model, submission: Submission.NotSubmitted() } : model,
})

type H = Parameters<Parameters<typeof RegisterDef.make>[0]["view"]>[0]

const brokenLink = (h: H) =>
	authFrame(
		h,
		{
			title: "This sign-up link doesn't work",
			subtitle: "It's missing details from your sign-in. Start again to continue.",
		},
		textLink(h, "Back to sign in", h.props.signInHref),
	)

const registration = (h: H, model: RegisterModel) => {
	const isSubmitting = model.submission._tag === "Submitting"
	const failure = model.submission._tag === "Failed" ? authFailureMessage(model.submission.reason) : null
	return authFrame(
		h,
		{ title: "Welcome to Hazel", subtitle: "What should your teammates call you?" },
		// HAZEL-GAP(p4-field-autofocus): today's first name field takes focus on arrival.
		h.stack.density("regular").children(
			h.textField
				.label("First name")
				.required(true)
				.value(model.firstName)
				.error(
					model.submission._tag !== "NotSubmitted" && isFirstNameMissing(model)
						? "Enter your first name"
						: undefined,
				)
				.on("change", (payload) => RegisterMessage.ChangedFirstName({ payload }))
				.on("submit", () => RegisterMessage.SubmittedRegistration()),
			h.textField
				.label("Last name")
				.value(model.lastName)
				.on("change", (payload) => RegisterMessage.ChangedLastName({ payload }))
				.on("submit", () => RegisterMessage.SubmittedRegistration()),
			h.button
				.label(isSubmitting ? "Creating your account..." : "Continue")
				.loading(isSubmitting)
				.disabled(isSubmitting)
				.on("press", RegisterMessage.SubmittedRegistration()),
		),
		failure === null
			? null
			: h.stack
					.density("compact")
					.children(
						messageText(h, failure),
						textLink(h, "Start sign-in again", h.props.signInHref),
					),
	)
}

export const RegisterPageNoDeps = RegisterDef.make({
	init: () => ({
		firstName: TextField.empty,
		lastName: TextField.empty,
		submission: Submission.NotSubmitted(),
	}),
	update: {
		ChangedFirstName: ($, { payload }) =>
			$.evolve({ firstName: (state) => TextField.changed(state, payload) }),
		ChangedLastName: ($, { payload }) =>
			$.evolve({ lastName: (state) => TextField.changed(state, payload) }),
		SubmittedRegistration: ($) => {
			const { flowId, reference } = $.props
			if (flowId === null || reference === null || $.model.submission._tag === "Submitting")
				return $.model
			if (isFirstNameMissing($.model)) return $.evolve({ submission: () => Submission.Invalid() })
			return $.evolve({ submission: () => Submission.Submitting() }).run(
				Register.make({
					flowId,
					reference,
					firstName: $.model.firstName.text,
					lastName: $.model.lastName.text,
				}),
			)
		},
		// Stays busy until the browser navigates away.
		LeftForApp: ($) => $.model,
		FailedRegistration: ($, { reason }) => $.evolve({ submission: () => Submission.Failed({ reason }) }),
	},
	view: (h, model) =>
		h.props.flowId === null || h.props.reference === null ? brokenLink(h) : registration(h, model),
})

export const RegisterPage = RegisterPageNoDeps.pipe(Component.provide(Register.layer))
