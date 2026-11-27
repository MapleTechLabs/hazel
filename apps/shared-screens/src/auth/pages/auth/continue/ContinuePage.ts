// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/auth/continue?provider=` (`web-foldkit/src/page/auth/continue`, now deleted): the OAuth callback
 * just linked this provider account to an existing Hazel account (same verified email), so signing
 * in once more lands in it. The page starts that sign-in as it opens.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { authFrame, messageText, textLink } from "../../../components/AuthFrame"
import { AuthFailure, authFailureMessage } from "../../../domain/AuthFailure"
import { AuthFlows, Provider } from "../../../services/AuthFlows"

export const ContinueProps = Schema.Struct({
	/** `?provider=`, as given: anything but a known provider makes the link unusable. */
	provider: Schema.NullOr(Schema.String),
	signInHref: Schema.String,
})
export type ContinueProps = typeof ContinueProps.Type

/** `Invalid`: `?provider=` is missing or not one the API offers. */
export const ContinueModel = UiSchema.TaggedEnum({
	Invalid: {},
	Redirecting: { provider: Provider },
	Failed: { reason: AuthFailure },
})
export type ContinueModel = typeof ContinueModel.Type

export const ContinueMessage = UiSchema.TaggedEnum({
	LeftForProvider: {},
	FailedSignIn: { reason: AuthFailure },
})
export type ContinueMessage = typeof ContinueMessage.Type

/** The page the visitor started from is still remembered from the first attempt. */
export class ContinueSignIn extends Command.Service<ContinueSignIn>()("hazel/auth/ContinueSignIn", {
	args: { provider: Provider },
	success: ContinueMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) =>
				({ provider }) =>
					flows.startOAuth(provider, null).pipe(
						Effect.match({
							onSuccess: () => ContinueMessage.LeftForProvider(),
							onFailure: ({ reason }) => ContinueMessage.FailedSignIn({ reason }),
						}),
					),
		),
	)
}

const isProvider = Schema.is(Provider)

const ContinueDef = Hazel.component({
	name: "ContinuePage",
	props: ContinueProps,
	model: ContinueModel,
	message: ContinueMessage,
})

type H = Parameters<Parameters<typeof ContinueDef.make>[0]["view"]>[0]

const failed = (h: H, reason: AuthFailure | null) => {
	if (reason === "AccountCreated")
		// Not a failure: the account exists and only needs a sign-in.
		return authFrame(
			h,
			{ title: "Your account is ready", subtitle: "Sign in to continue." },
			textLink(h, "Sign in", h.props.signInHref),
		)
	const message = reason === null ? null : authFailureMessage(reason)
	return authFrame(
		h,
		{ title: "Couldn't finish signing in", subtitle: "Start again and pick the same account." },
		h.stack
			.density("regular")
			.children(
				message === null ? null : messageText(h, message),
				textLink(h, "Back to sign in", h.props.signInHref),
			),
	)
}

export const ContinuePageNoDeps = ContinueDef.make({
	init: ($) => {
		const provider = $.props.provider
		return provider !== null && isProvider(provider)
			? $.set(ContinueModel.Redirecting({ provider })).run(ContinueSignIn.make({ provider }))
			: ContinueModel.Invalid()
	},
	update: {
		LeftForProvider: ($) => $.model,
		FailedSignIn: (_$, { reason }) => ContinueModel.Failed({ reason }),
	},
	view: (h, model) =>
		ContinueModel.match(model, {
			Invalid: () => failed(h, null),
			Failed: ({ reason }) => failed(h, reason),
			Redirecting: () =>
				authFrame(
					h,
					{ title: "Your accounts are linked", subtitle: "Finishing sign-in..." },
					h.progress.style("spinner").label("Finishing sign-in"),
				),
		}),
})

export const ContinuePage = ContinuePageNoDeps.pipe(Component.provide(ContinueSignIn.layer))
