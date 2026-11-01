import { Effect, Option, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { load } from "foldkit/navigation"
import { defineTaggedUnion } from "foldkit/schema"
import { failureMessage, isRetryableReason, type UserErrorMessage } from "~/lib/error-messages"
import { authorizeAttempt, describeAttempt, HandoffFailure } from "../../../auth/desktop-handoff"
import { AppRoute, hrefOf, signInHref, type RouteOf } from "../../../route"
import { button } from "../../../ui/button"
import { loader } from "../../../ui/loader"
import {
	definePage,
	isSessionLoading,
	type PageReturn,
	type PageViewInputs,
	type Shared,
} from "../../contract"
import { authError, authFrame, authHeading } from "../layout"

/**
 * `/auth/desktop?attempt=`: the desktop app opened this page to sign in. A signed-in browser
 * confirms the account; Hazel then hands the desktop app its own session through its link.
 */

/** The attempt id travels with every step that can still use it. */
const Model = defineTaggedUnion({
	/** Opened without `?attempt=`: only the desktop app can start this. */
	NoAttempt: {},
	Loading: { attemptId: Schema.String },
	Ready: { attemptId: Schema.String, appName: Schema.String },
	Authorizing: { attemptId: Schema.String, appName: Schema.String },
	/** The callback opened; kept for a manual "Open" link if the browser didn't follow it. */
	Returned: { callbackUrl: Schema.String },
	Failed: { attemptId: Schema.String, reason: HandoffFailure },
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	DescribedAttempt: { appName: Schema.String },
	FailedDescribe: { reason: HandoffFailure },
	ClickedContinue: {},
	ClickedSignIn: {},
	ClickedRetry: {},
	AuthorizedAttempt: { callbackUrl: Schema.String },
	FailedAuthorize: { reason: HandoffFailure },
	LeftForSignIn: {},
})
type Message = typeof Message.Type

type Return = PageReturn<Model, Message>

export const DescribeAttempt = Command.define("DescribeAttempt", {
	args: { attemptId: Schema.String },
	messages: [Message.DescribedAttempt, Message.FailedDescribe],
	execute: ({ attemptId }) =>
		describeAttempt(attemptId).pipe(
			Effect.map((description) => Message.DescribedAttempt({ appName: description.displayName })),
			Effect.catchTags({
				HandoffError: ({ reason }) => Effect.succeed(Message.FailedDescribe({ reason })),
			}),
		),
})

/** Authorizes, then opens the app's link (`hazel://…`); the OS hands it to the desktop app. */
export const AuthorizeAttempt = Command.define("AuthorizeAttempt", {
	args: { attemptId: Schema.String },
	messages: [Message.AuthorizedAttempt, Message.FailedAuthorize],
	execute: ({ attemptId }) =>
		authorizeAttempt(attemptId).pipe(
			Effect.tap(load),
			Effect.map((callbackUrl) => Message.AuthorizedAttempt({ callbackUrl })),
			Effect.catchTags({
				HandoffError: ({ reason }) => Effect.succeed(Message.FailedAuthorize({ reason })),
			}),
		),
})

/** Sign in in this browser, then come back here (the attempt lives for five minutes). */
export const SignInForDesktop = Command.define("SignInForDesktop", {
	args: { returnTo: Schema.String },
	messages: [Message.LeftForSignIn],
	execute: ({ returnTo }) => load(signInHref(returnTo)).pipe(Effect.as(Message.LeftForSignIn())),
})

export const init = (route: RouteOf<"AuthDesktop">): Return =>
	Option.match(route.attempt, {
		onNone: () => ({ model: Model.NoAttempt() }),
		onSome: (attemptId) => ({
			model: Model.Loading({ attemptId }),
			commands: [DescribeAttempt({ attemptId })],
		}),
	})

const attemptIdOf = (model: Model): string | null =>
	Model.match(model, {
		NoAttempt: () => null,
		Loading: ({ attemptId }) => attemptId,
		Ready: ({ attemptId }) => attemptId,
		Authorizing: ({ attemptId }) => attemptId,
		Returned: () => null,
		Failed: ({ attemptId }) => attemptId,
	})

/** A result for an attempt that is no longer loading or authorizing is stale. */
const fail = (model: Model, reason: HandoffFailure, from: "Loading" | "Authorizing"): Return =>
	model._tag === from ? { model: Model.Failed({ attemptId: model.attemptId, reason }) } : { model }

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		DescribedAttempt: ({ appName }) =>
			model._tag === "Loading"
				? { model: Model.Ready({ attemptId: model.attemptId, appName }) }
				: { model },
		FailedDescribe: ({ reason }) => fail(model, reason, "Loading"),
		ClickedContinue: () =>
			model._tag === "Ready"
				? {
						model: Model.Authorizing({ attemptId: model.attemptId, appName: model.appName }),
						commands: [AuthorizeAttempt({ attemptId: model.attemptId })],
					}
				: { model },
		ClickedSignIn: () => {
			const attemptId = attemptIdOf(model)
			return attemptId === null
				? { model }
				: {
						model,
						commands: [
							SignInForDesktop({
								returnTo: hrefOf(AppRoute.AuthDesktop({ attempt: Option.some(attemptId) })),
							}),
						],
					}
		},
		// Only a transient failure is worth another try; the attempt itself is described again.
		ClickedRetry: () =>
			model._tag === "Failed" && isRetryableHandoff(model.reason)
				? {
						model: Model.Loading({ attemptId: model.attemptId }),
						commands: [DescribeAttempt({ attemptId: model.attemptId })],
					}
				: { model },
		AuthorizedAttempt: ({ callbackUrl }) =>
			model._tag === "Authorizing" ? { model: Model.Returned({ callbackUrl }) } : { model },
		FailedAuthorize: ({ reason }) => fail(model, reason, "Authorizing"),
		LeftForSignIn: () => ({ model }),
	})

const isRetryableHandoff = (reason: HandoffFailure): boolean =>
	reason !== "Expired" && reason !== "NeedsSignIn" && isRetryableReason(reason)

const handoffMessage = (reason: HandoffFailure): UserErrorMessage =>
	failureMessage(reason, {
		Expired: {
			title: "This sign-in request has expired or was already used",
			description: "Start again from the desktop app.",
		},
		NeedsSignIn: { title: "Sign in first, then continue" },
	})

const confirm = (h: HtmlBuilder<Message>, appName: string, shared: Shared, isAuthorizing: boolean) =>
	shared.currentUser === null
		? [
				authHeading(
					h,
					`Sign in to ${appName}`,
					"Sign in here in your browser; the app picks up from there.",
				),
				button(h, { intent: "primary", className: "w-full", onPress: Message.ClickedSignIn() }, [
					"Sign in",
				]),
			]
		: [
				authHeading(h, `Continue to ${appName}?`, `You're signed in as ${shared.currentUser.email}.`),
				button(
					h,
					{
						intent: "primary",
						className: "w-full",
						isDisabled: isAuthorizing,
						onPress: Message.ClickedContinue(),
					},
					isAuthorizing ? [loader(h, { className: "size-4" }), "Opening the app..."] : ["Continue"],
				),
				h.p(
					[h.Class("mt-3 text-muted-fg text-xs")],
					["Not you? Sign out of Hazel in this browser, then start again from the app."],
				),
			]

const failed = (h: HtmlBuilder<Message>, reason: HandoffFailure | null): ReadonlyArray<Html> => [
	authHeading(h, "Couldn't sign in the app", "Start signing in again from the Hazel desktop app."),
	...(reason === null
		? []
		: [
				authError(h, handoffMessage(reason)) ?? h.empty,
				...(isRetryableHandoff(reason)
					? [
							button(
								h,
								{
									intent: "outline",
									className: "mt-4 w-full",
									onPress: Message.ClickedRetry(),
								},
								["Try again"],
							),
						]
					: []),
			]),
]

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	authFrame(
		h,
		shared.nowMs,
		isSessionLoading(shared)
			? [loader(h, { className: "size-6" })]
			: Model.match(model, {
					NoAttempt: () => [
						authHeading(
							h,
							"Couldn't sign in the app",
							"Open this page from the Hazel desktop app.",
						),
					],
					Loading: () => [loader(h, { className: "size-6" })],
					Ready: ({ appName }) => confirm(h, appName, shared, false),
					Authorizing: ({ appName }) => confirm(h, appName, shared, true),
					Returned: ({ callbackUrl }) => [
						authHeading(
							h,
							"You're signed in",
							"Switch back to the Hazel app. You can close this tab.",
						),
						h.a(
							[
								h.Class("text-fg text-sm underline underline-offset-2"),
								h.Href(callbackUrl),
								h.Attribute("rel", "noreferrer"),
							],
							["Open Hazel"],
						),
					],
					Failed: ({ reason }) => failed(h, reason),
				}),
	),
)

export const page = definePage(
	"AuthDesktop",
	{ Model, Message },
	{ routes: ["AuthDesktop"], init, update, view },
)
