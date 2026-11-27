// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/auth/desktop?attempt=` (`web-foldkit/src/page/auth/desktop`, now deleted): the desktop app opened
 * this page to sign in. A signed-in browser confirms the account; Hazel then hands the desktop app its
 * own session through its link.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Match, Schema } from "effect"
import { LoadPage } from "../../../../app/requests"
import { isSessionLoading, Session } from "../../../../app/session"
import { authFrame, authWaiting, messageText, textLink } from "../../../components/AuthFrame"
import {
	failureMessage,
	HandoffFailure,
	isRetryableReason,
	type UserErrorMessage,
} from "../../../domain/AuthFailure"
import { AuthFlows } from "../../../services/AuthFlows"

export const DesktopProps = Schema.Struct({
	/** `?attempt=`: only the desktop app can start this. */
	attempt: Schema.NullOr(Schema.String),
	session: Session,
	/** Sign in in this browser, then come back to this page (the attempt lives for five minutes). */
	signInHref: Schema.String,
})
export type DesktopProps = typeof DesktopProps.Type

/** The attempt id travels with every step that can still use it. */
export const DesktopModel = UiSchema.TaggedEnum({
	NoAttempt: {},
	Loading: { attemptId: Schema.String },
	Ready: { attemptId: Schema.String, appName: Schema.String },
	Authorizing: { attemptId: Schema.String, appName: Schema.String },
	/** The callback opened; kept for a manual "Open" link if the browser didn't follow it. */
	Returned: { callbackUrl: Schema.String },
	Failed: { attemptId: Schema.String, reason: HandoffFailure },
})
export type DesktopModel = typeof DesktopModel.Type

export const DesktopMessage = UiSchema.TaggedEnum({
	DescribedAttempt: { appName: Schema.String },
	FailedDescribe: { reason: HandoffFailure },
	PressedContinue: {},
	PressedSignIn: {},
	PressedRetry: {},
	AuthorizedAttempt: { callbackUrl: Schema.String },
	FailedAuthorize: { reason: HandoffFailure },
})
export type DesktopMessage = typeof DesktopMessage.Type

export class DescribeAttempt extends Command.Service<DescribeAttempt>()("hazel/auth/DescribeAttempt", {
	args: { attemptId: Schema.String },
	success: DesktopMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) =>
				({ attemptId }) =>
					flows.describeAttempt(attemptId).pipe(
						Effect.match({
							onSuccess: (appName) => DesktopMessage.DescribedAttempt({ appName }),
							onFailure: ({ reason }) => DesktopMessage.FailedDescribe({ reason }),
						}),
					),
		),
	)
}

/** Authorizes, then opens the app's callback link (`com.hazel.app://...`); the OS hands it to the app. */
export class AuthorizeAttempt extends Command.Service<AuthorizeAttempt>()("hazel/auth/AuthorizeAttempt", {
	args: { attemptId: Schema.String },
	success: DesktopMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) =>
				({ attemptId }) =>
					flows.authorizeAttempt(attemptId).pipe(
						Effect.match({
							onSuccess: (callbackUrl) => DesktopMessage.AuthorizedAttempt({ callbackUrl }),
							onFailure: ({ reason }) => DesktopMessage.FailedAuthorize({ reason }),
						}),
					),
		),
	)
}

/** A failure this browser fixes by signing in (again) and continuing the same attempt. */
const isSignInReason = (reason: HandoffFailure): reason is "NeedsSignIn" | "SignInAgain" =>
	reason === "NeedsSignIn" || reason === "SignInAgain"

/** Only a transient failure is worth another try. */
export const isRetryableHandoff = (reason: HandoffFailure): boolean =>
	!isSignInReason(reason) && reason !== "Expired" && isRetryableReason(reason)

const handoffMessage = (reason: HandoffFailure): UserErrorMessage =>
	failureMessage(reason, {
		Expired: {
			title: "This sign-in request has expired or was already used",
			description: "Start again from the desktop app.",
		},
		NeedsSignIn: { title: "Sign in first, then continue" },
		SignInAgain: {
			title: "Sign in again to continue",
			description: "The app gets its own session from a fresh sign-in in this browser.",
		},
	})

const attemptIdOf = (model: DesktopModel): string | null =>
	DesktopModel.match(model, {
		NoAttempt: () => null,
		Loading: ({ attemptId }) => attemptId,
		Ready: ({ attemptId }) => attemptId,
		Authorizing: ({ attemptId }) => attemptId,
		Returned: () => null,
		Failed: ({ attemptId }) => attemptId,
	})

const DesktopDef = Hazel.component({
	name: "DesktopPage",
	props: DesktopProps,
	model: DesktopModel,
	message: DesktopMessage,
	// After Back, an authorization in flight is not running any more: confirm again.
	restore: (model) =>
		model._tag === "Authorizing"
			? DesktopModel.Ready({ attemptId: model.attemptId, appName: model.appName })
			: model,
})

type H = Parameters<Parameters<typeof DesktopDef.make>[0]["view"]>[0]

const SIGN_IN_HERE = "Sign in here in your browser; the app picks up from there."

const confirm = (h: H, appName: string, isAuthorizing: boolean) => {
	const user = h.props.session.user
	if (user === null)
		return authFrame(
			h,
			{ title: `Sign in to ${appName}`, subtitle: SIGN_IN_HERE },
			h.button.label("Sign in").on("press", DesktopMessage.PressedSignIn()),
		)
	return authFrame(
		h,
		{ title: `Continue to ${appName}?`, subtitle: `You're signed in as ${user.email}.` },
		h.stack.density("compact").children(
			h.button
				.label(isAuthorizing ? "Opening the app..." : "Continue")
				.loading(isAuthorizing)
				.disabled(isAuthorizing)
				.on("press", DesktopMessage.PressedContinue()),
			h.text
				.role("caption")
				.tone("muted")
				.children("Not you? Sign out of Hazel in this browser, then start again from the app."),
		),
	)
}

const failed = (h: H, reason: HandoffFailure) =>
	isSignInReason(reason)
		? authFrame(
				h,
				{ title: "Confirm it's you", subtitle: SIGN_IN_HERE },
				h.stack
					.density("regular")
					.children(
						messageText(h, handoffMessage(reason)),
						h.button.label("Sign in again").on("press", DesktopMessage.PressedSignIn()),
					),
			)
		: authFrame(
				h,
				{
					title: "Couldn't sign in the app",
					subtitle: "Start signing in again from the Hazel desktop app.",
				},
				h.stack
					.density("regular")
					.children(
						messageText(h, handoffMessage(reason)),
						isRetryableHandoff(reason)
							? h.button
									.label("Try again")
									.variant("outline")
									.on("press", DesktopMessage.PressedRetry())
							: null,
					),
			)

/** A result for an attempt that is no longer loading or authorizing is stale. */
const fail = (model: DesktopModel, reason: HandoffFailure, from: "Loading" | "Authorizing"): DesktopModel =>
	model._tag === from ? DesktopModel.Failed({ attemptId: model.attemptId, reason }) : model

export const DesktopPageNoDeps = DesktopDef.make({
	init: ($) => {
		const attemptId = $.props.attempt
		return attemptId === null
			? DesktopModel.NoAttempt()
			: $.set(DesktopModel.Loading({ attemptId })).run(DescribeAttempt.make({ attemptId }))
	},
	update: {
		DescribedAttempt: ($, { appName }) =>
			$.model._tag === "Loading"
				? DesktopModel.Ready({ attemptId: $.model.attemptId, appName })
				: $.model,
		FailedDescribe: ($, { reason }) => fail($.model, reason, "Loading"),
		PressedContinue: ($) =>
			$.model._tag === "Ready"
				? $.set(
						DesktopModel.Authorizing({ attemptId: $.model.attemptId, appName: $.model.appName }),
					).run(AuthorizeAttempt.make({ attemptId: $.model.attemptId }))
				: $.model,
		PressedSignIn: ($) =>
			attemptIdOf($.model) === null ? $.model : $.run(LoadPage.make({ href: $.props.signInHref })),
		PressedRetry: ($) =>
			$.model._tag === "Failed" && isRetryableHandoff($.model.reason)
				? $.set(DesktopModel.Loading({ attemptId: $.model.attemptId })).run(
						DescribeAttempt.make({ attemptId: $.model.attemptId }),
					)
				: $.model,
		AuthorizedAttempt: ($, { callbackUrl }) =>
			$.model._tag === "Authorizing" ? DesktopModel.Returned({ callbackUrl }) : $.model,
		FailedAuthorize: ($, { reason }) => fail($.model, reason, "Authorizing"),
	},
	view: (h, model) => {
		if (isSessionLoading(h.props.session)) return authWaiting(h, "Loading")
		return Match.value(model).pipe(
			Match.tag("NoAttempt", () =>
				authFrame(h, {
					title: "Couldn't sign in the app",
					subtitle: "Open this page from the Hazel desktop app.",
				}),
			),
			Match.tag("Loading", () => authWaiting(h, "Loading")),
			Match.tag("Ready", ({ appName }) => confirm(h, appName, false)),
			Match.tag("Authorizing", ({ appName }) => confirm(h, appName, true)),
			Match.tag("Returned", ({ callbackUrl }) =>
				authFrame(
					h,
					{
						title: "You're signed in",
						subtitle: "Switch back to the Hazel app. You can close this tab.",
					},
					textLink(h, "Open Hazel", callbackUrl),
				),
			),
			Match.tag("Failed", ({ reason }) => failed(h, reason)),
			Match.exhaustive,
		)
	},
})

export const DesktopPage = DesktopPageNoDeps.pipe(
	Component.provide(Layer.mergeAll(DescribeAttempt.layer, AuthorizeAttempt.layer)),
)
