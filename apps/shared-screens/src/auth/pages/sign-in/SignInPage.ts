// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/sign-in` and `/sign-up` (`web-foldkit/src/page/auth/sign-in`, now deleted): GitHub, Google or a
 * passkey, only the methods the install offers. The desktop and native apps sign in through the
 * system browser instead, and native can sign in to another install by its address.
 */
import { Command, Component, Query, UiSchema } from "@effect/ui"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Match, Schema } from "effect"
import { authFrame, messageText } from "../../components/AuthFrame"
import {
	authFailureMessage,
	failureTone,
	type MessageTone,
	ServerProblem,
	SignInFailure,
	type UserErrorMessage,
} from "../../domain/AuthFailure"
import { allSignInMethods, AuthFlows, Provider, SignInMethods } from "../../services/AuthFlows"

/** What the visitor started: a provider's OAuth redirect, the passkey prompt, or the system browser. */
export const Attempt = Schema.Union([Provider, Schema.Literals(["passkey", "browser"])])
export type Attempt = typeof Attempt.Type

export const Submission = UiSchema.TaggedEnum({
	Idle: {},
	/** Stays pending until the browser navigates away. */
	Pending: { attempt: Attempt },
	Failed: { reason: SignInFailure },
})
export type Submission = typeof Submission.Type

/** The native app's "sign in to another install" form. */
export const ServerForm = Schema.Struct({
	address: TextField.State,
	/** Resolving the address, or switching to it (the app then reloads). */
	isBusy: Schema.Boolean,
	problem: Schema.NullOr(ServerProblem),
})
export type ServerForm = typeof ServerForm.Type

/** The install the native app signs in to; `null` on the web, where it is the page's own. */
export const ServerChoice = Schema.Struct({
	/** How it is named on screen, e.g. `hazel.sh` or `chat.acme.com`. */
	label: Schema.String,
	/** The build's own install (Hazel cloud): nothing to reset to. */
	isDefault: Schema.Boolean,
	/** Open while the user enters another address. */
	form: Schema.NullOr(ServerForm),
})
export type ServerChoice = typeof ServerChoice.Type

export const SignInProps = Schema.Struct({
	mode: Schema.Literals(["SignIn", "SignUp"]),
	/** `?redirect_url=`, already narrowed to a same-origin path: where to go once signed in. */
	redirectUrl: Schema.NullOr(Schema.String),
	/** A failed OAuth callback's `?error=`, shown once so the next press starts afresh. */
	initialError: Schema.NullOr(Schema.String),
	/** The other mode's URL (`/sign-up` from sign-in, and back), keeping `redirect_url`. */
	switchHref: Schema.String,
	/**
	 * Desktop and native: the install they sign in to, which the visitor can change; they sign in
	 * through the system browser, which lists the methods itself. `null` on the web.
	 */
	initialServer: Schema.NullOr(ServerChoice),
})
export type SignInProps = typeof SignInProps.Type

export const SignInModel = Schema.Struct({
	submission: Submission,
	server: Schema.NullOr(ServerChoice),
})
export type SignInModel = typeof SignInModel.Type

export const SignInMessage = UiSchema.TaggedEnum({
	PressedProvider: { provider: Provider },
	PressedPasskey: {},
	/** The browser is leaving for the provider or the app; nothing to render. */
	LeftForSignIn: {},
	/** `Cancelled` when the visitor closed the passkey prompt themselves. */
	FailedSignIn: { reason: SignInFailure },
	PressedBrowserSignIn: {},
	PressedCancelBrowserSignIn: {},
	CompletedRetireBrowserSignIn: {},
	PressedChangeServer: {},
	ChangedServerAddress: { payload: TextField.ChangePayload },
	SubmittedServerAddress: {},
	PressedCancelServerChange: {},
	PressedUseHazelCloud: {},
	FailedServerChange: { problem: ServerProblem },
	/** The app is reloading on the chosen install; nothing to render. */
	LeftForServer: {},
})
export type SignInMessage = typeof SignInMessage.Type

const isSignInFailure = Schema.is(SignInFailure)

/** Which providers the install has OAuth apps for. */
export class GetSignInMethods extends Query.Service<GetSignInMethods>()("hazel/auth/GetSignInMethods", {
	args: {},
	success: SignInMethods,
	error: Schema.Literal("Unanswered"),
	staleTime: "5 minutes",
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) => () => flows.signInMethods.pipe(Effect.mapError(() => "Unanswered" as const)),
		),
	)
}

const failed = (reason: SignInFailure) => SignInMessage.FailedSignIn({ reason })

export class StartOAuthSignIn extends Command.Service<StartOAuthSignIn>()("hazel/auth/StartOAuthSignIn", {
	args: { provider: Provider, returnTo: Schema.NullOr(Schema.String) },
	success: SignInMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) =>
				({ provider, returnTo }) =>
					flows.startOAuth(provider, returnTo).pipe(
						Effect.match({
							onSuccess: () => SignInMessage.LeftForSignIn(),
							onFailure: (e) => failed(e.reason),
						}),
					),
		),
	)
}

export class StartPasskeySignIn extends Command.Service<StartPasskeySignIn>()(
	"hazel/auth/StartPasskeySignIn",
	{ args: { returnTo: Schema.NullOr(Schema.String) }, success: SignInMessage },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) =>
				({ returnTo }) =>
					flows.signInWithPasskey(returnTo).pipe(
						Effect.match({
							onSuccess: () => SignInMessage.LeftForSignIn(),
							onFailure: (e) => failed(e.reason),
						}),
					),
		),
	)
}

/** Desktop: the browser at `/auth/desktop`, its link back, then a load into the app. Cancel interrupts it. */
export class StartBrowserSignIn extends Command.Service<StartBrowserSignIn>()(
	"hazel/auth/StartBrowserSignIn",
	{ args: {}, success: SignInMessage },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) => () =>
				flows.signInWithBrowser.pipe(
					Effect.match({
						onSuccess: () => SignInMessage.LeftForSignIn(),
						onFailure: (e) => failed(e.reason),
					}),
				),
		),
	)
}

/** After Cancel stopped the wait: retires the attempt, so the next sign-in starts fresh. */
export class RetireBrowserSignIn extends Command.Service<RetireBrowserSignIn>()(
	"hazel/auth/RetireBrowserSignIn",
	{ args: {}, success: SignInMessage },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) => () =>
				flows.retireBrowserSignIn.pipe(Effect.as(SignInMessage.CompletedRetireBrowserSignIn())),
		),
	)
}

/** Native: resolves the address to an install and starts over on it; the current one only closes the form. */
export class ChangeServer extends Command.Service<ChangeServer>()("hazel/auth/ChangeServer", {
	args: { address: Schema.String },
	success: SignInMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) =>
				({ address }) =>
					flows.changeServer(address).pipe(
						Effect.match({
							onSuccess: (left) =>
								left
									? SignInMessage.LeftForServer()
									: SignInMessage.PressedCancelServerChange(),
							onFailure: ({ problem }) => SignInMessage.FailedServerChange({ problem }),
						}),
					),
		),
	)
}

/** Native: back to the build's own install (Hazel cloud), signed out of the previous one. */
export class UseDefaultServer extends Command.Service<UseDefaultServer>()("hazel/auth/UseDefaultServer", {
	args: {},
	success: SignInMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(AuthFlows),
			(flows) => () => flows.useDefaultServer.pipe(Effect.as(SignInMessage.LeftForServer())),
		),
	)
}

const SignInDef = Hazel.component({
	name: "SignInPage",
	props: SignInProps,
	model: SignInModel,
	message: SignInMessage,
	queries: {
		methods: {
			query: GetSignInMethods,
			args: ({ props }) => (props.initialServer === null ? {} : undefined),
		},
	},
	// After Back, an attempt or a server switch that was in flight is not running any more.
	restore: (model) => ({
		submission: model.submission._tag === "Pending" ? Submission.Idle() : model.submission,
		server:
			model.server?.form == null
				? model.server
				: { ...model.server, form: { ...model.server.form, isBusy: false } },
	}),
})

type H = Parameters<Parameters<typeof SignInDef.make>[0]["view"]>[0]

/** The attempt in flight, if any. */
export const pendingAttempt = (model: SignInModel): Attempt | null =>
	model.submission._tag === "Pending" ? model.submission.attempt : null

const providerLabels = { github: "GitHub", google: "Google" } satisfies { readonly [P in Provider]: string }

/** "GitHub", "GitHub or Google": the offered providers, for copy. */
const providerNames = (providers: ReadonlyArray<Provider>): string =>
	providers.map((provider) => providerLabels[provider]).join(" or ")

/** The methods the page offers: `null` until the install answers, every one if it can't. */
const methodsOf = (h: H): SignInMethods | null =>
	Match.value(h.queries.methods).pipe(
		Match.tag("Initial", () => null),
		Match.tag("Failure", () => allSignInMethods),
		Match.tag("Success", ({ value }) => value),
		Match.exhaustive,
	)

/** What a failed sign-in says, including the desktop browser's own failures. */
const failureMessageOf = (reason: SignInFailure, methods: SignInMethods | null): UserErrorMessage | null =>
	Match.value(reason).pipe(
		Match.when("PasskeyUnsupported", () => {
			const providers = (methods ?? allSignInMethods).providers
			return {
				title: "This browser can't use passkeys",
				description:
					providers.length === 0
						? "Try a browser that supports passkeys."
						: `Continue with ${providerNames(providers)} instead.`,
			}
		}),
		Match.when("BrowserTimedOut", () => ({
			title: "Signing in took too long",
			description: "Please try again.",
		})),
		Match.when("BrowserBusy", () => ({ title: "A sign-in is already in progress in your browser" })),
		Match.when("BrowserIndeterminate", () => ({
			title: "Couldn't finish signing in",
			description: "Please try again.",
		})),
		Match.orElse((other) => authFailureMessage(other)),
	)

const failureRow = (h: H, model: SignInModel, methods: SignInMethods | null) => {
	if (model.submission._tag !== "Failed") return null
	const message = failureMessageOf(model.submission.reason, methods)
	const tone: MessageTone = failureTone(model.submission.reason)
	return message === null ? null : messageText(h, message, tone)
}

const choice = (
	h: H,
	label: string,
	icon: "github" | "google" | "lock",
	pending: Attempt | null,
	mine: Attempt,
) =>
	h.button
		.label(label)
		.icon(icon)
		.variant("outline")
		.loading(pending === mine)
		.disabled(pending !== null)

// HAZEL-GAP(p4-divider-label): today's "or" sits between two hairlines; `divider` takes no label.
const orDivider = (h: H) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.density("compact")
		.children(h.divider, h.text.role("caption").tone("muted").children("or"), h.divider)

/** Only the methods the install offers; until it answers, a quiet placeholder. */
const choices = (h: H, methods: SignInMethods | null, pending: Attempt | null) => {
	if (methods === null) return h.progress.style("spinner").label("Loading sign-in options")
	const oauth = methods.providers.map((provider) =>
		choice(h, `Continue with ${providerLabels[provider]}`, provider, pending, provider).on(
			"press",
			SignInMessage.PressedProvider({ provider }),
		),
	)
	const passkey = methods.passkeys
		? [
				choice(h, "Sign in with a passkey", "lock", pending, "passkey").on(
					"press",
					SignInMessage.PressedPasskey(),
				),
			]
		: []
	// HAZEL-GAP(p4-stack-gap-3): today's choices are 12px apart; `compact` is 8px, `regular` 16px.
	return h.stack
		.density("compact")
		.children(...oauth, ...(oauth.length > 0 && passkey.length > 0 ? [orDivider(h)] : []), ...passkey)
}

// Today's one sentence with an underlined link inside it (`switchLink`).
const switchLine = (h: H) => {
	const isSignIn = h.props.mode === "SignIn"
	return h.text
		.role("label")
		.tone("muted")
		.children(
			isSignIn ? "New to Hazel? " : "Already have an account? ",
			h.link
				.tone("inline")
				.label(isSignIn ? "Create an account" : "Sign in")
				.href(h.props.switchHref),
		)
}

const signUpSubtitle = (methods: SignInMethods | null) =>
	methods === null || methods.providers.length === 0
		? "It takes a few seconds."
		: `Sign up with ${providerNames(methods.providers)}. It takes a few seconds.`

const webView = (h: H, model: SignInModel) => {
	const methods = methodsOf(h)
	const isSignIn = h.props.mode === "SignIn"
	return authFrame(
		h,
		isSignIn
			? { title: "Sign in to Hazel", subtitle: "Welcome back. Pick how you'd like to sign in." }
			: { title: "Create your Hazel account", subtitle: signUpSubtitle(methods) },
		// HAZEL-GAP(p4-stack-gap-8): today the switch line sits 32px under the card; `relaxed` is 24px.
		h.stack
			.density("relaxed")
			.children(
				choices(h, methods, pendingAttempt(model)),
				failureRow(h, model, methods),
				switchLine(h),
			),
	)
}

/** The desktop app signs in through the system browser, where GitHub, Google and passkeys work. */
const browserRows = (h: H, model: SignInModel) =>
	pendingAttempt(model) === "browser"
		? h.stack
				.density("compact")
				.children(
					h.button.label("Waiting for your browser...").loading(true).disabled(true),
					h.button
						.label("Cancel")
						.variant("outline")
						.on("press", SignInMessage.PressedCancelBrowserSignIn()),
				)
		: h.button
				.label("Sign in with your browser")
				.icon("external-link")
				.on("press", SignInMessage.PressedBrowserSignIn())

const serverProblemText = (problem: ServerProblem): string =>
	Match.value(problem).pipe(
		Match.when("Empty", () => "Enter your workspace's web address"),
		Match.when("Invalid", () => "That isn't a web address, e.g. chat.acme.com"),
		Match.when("Insecure", () => "The address must use https"),
		Match.when("Unreachable", () => "Couldn't reach that address. Check it and your connection."),
		Match.when("NotHazel", () => "No Hazel workspace answers at that address"),
		Match.exhaustive,
	)

/** Native: another install's address (a customer's), resolved through its `/.well-known/hazel.json`. */
const serverFormView = (h: H, server: ServerChoice, form: ServerForm) =>
	authFrame(
		h,
		{
			title: "Sign in to another Hazel",
			subtitle: "Enter the web address your workspace uses, e.g. chat.acme.com.",
		},
		h.stack.density("regular").children(
			// HAZEL-GAP(p4-field-autofocus): today's address field takes focus when the form opens.
			h.textField
				.label("Web address")
				.placeholder("chat.acme.com")
				.inputKind("url")
				.required(true)
				.disabled(form.isBusy)
				.value(form.address)
				.error(form.problem === null ? undefined : serverProblemText(form.problem))
				.on("change", (payload) => SignInMessage.ChangedServerAddress({ payload }))
				.on("submit", () => SignInMessage.SubmittedServerAddress()),
			h.stack.density("compact").children(
				h.button
					.label(form.isBusy ? "Connecting..." : "Continue")
					.loading(form.isBusy)
					.disabled(form.isBusy)
					.on("press", SignInMessage.SubmittedServerAddress()),
				h.button
					.label("Cancel")
					.variant("outline")
					.disabled(form.isBusy)
					.on("press", SignInMessage.PressedCancelServerChange()),
				server.isDefault
					? null
					: h.button
							.label("Use Hazel cloud")
							.variant("ghost")
							.disabled(form.isBusy)
							.on("press", SignInMessage.PressedUseHazelCloud()),
			),
		),
	)

/** Native: which install the app signs in to, and the way to another. */
const serverLine = (h: H, model: SignInModel, server: ServerChoice) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.density("tight")
		.children(
			// Today's one span: `Signing in to ` with the server as a `font-medium text-fg` run.
			h.text
				.role("label")
				.tone("muted")
				.children("Signing in to ", h.text.role("label").strong(true).children(server.label)),
			h.text.role("label").tone("muted").children("·"),
			h.button
				.label("Change")
				.variant("ghost")
				.size("xsmall")
				.disabled(pendingAttempt(model) !== null)
				.on("press", SignInMessage.PressedChangeServer()),
		)

const browserView = (h: H, model: SignInModel, server: ServerChoice) =>
	authFrame(
		h,
		{ title: "Sign in to Hazel", subtitle: "Continue in your browser, then come back here." },
		h.stack
			.density("relaxed")
			.children(browserRows(h, model), failureRow(h, model, null), serverLine(h, model, server)),
	)

/** Changes the open server form; nothing when it is closed (or on the web). */
const withForm = (model: SignInModel, f: (form: ServerForm) => ServerForm): SignInModel =>
	model.server?.form == null ? model : { ...model, server: { ...model.server, form: f(model.server.form) } }

export const SignInPageNoDeps = SignInDef.make({
	init: ($) => ({
		submission:
			$.props.initialError === null
				? Submission.Idle()
				: Submission.Failed({
						reason: isSignInFailure($.props.initialError) ? $.props.initialError : "Unexpected",
					}),
		server: $.props.initialServer,
	}),
	update: {
		// One attempt at a time: a press while another is pending does nothing.
		PressedProvider: ($, { provider }) =>
			pendingAttempt($.model) !== null
				? $.model
				: $.evolve({ submission: () => Submission.Pending({ attempt: provider }) }).run(
						StartOAuthSignIn.make({ provider, returnTo: $.props.redirectUrl }),
					),
		PressedPasskey: ($) =>
			pendingAttempt($.model) !== null
				? $.model
				: $.evolve({ submission: () => Submission.Pending({ attempt: "passkey" }) }).run(
						StartPasskeySignIn.make({ returnTo: $.props.redirectUrl }),
					),
		PressedBrowserSignIn: ($) =>
			pendingAttempt($.model) !== null
				? $.model
				: $.evolve({ submission: () => Submission.Pending({ attempt: "browser" }) }).run(
						StartBrowserSignIn.make({}),
					),
		// Stops the wait, then retires the attempt so the next sign-in starts fresh.
		PressedCancelBrowserSignIn: ($) =>
			pendingAttempt($.model) !== "browser"
				? $.model
				: $.evolve({ submission: () => Submission.Idle() }).run(
						Command.interrupt(StartBrowserSignIn),
						RetireBrowserSignIn.make({}),
					),
		CompletedRetireBrowserSignIn: ($) => $.model,
		// The page stays busy until the browser navigates away.
		LeftForSignIn: ($) => $.model,
		FailedSignIn: ($, { reason }) => $.evolve({ submission: () => Submission.Failed({ reason }) }),
		// Not while a sign-in is waiting: its callback belongs to the install it started on.
		PressedChangeServer: ($) =>
			$.model.server === null || pendingAttempt($.model) !== null
				? $.model
				: $.evolve({
						server: (server) =>
							server === null
								? null
								: {
										...server,
										form: { address: TextField.empty, isBusy: false, problem: null },
									},
					}),
		ChangedServerAddress: ($, { payload }) =>
			withForm($.model, (form) =>
				form.isBusy
					? form
					: { ...form, address: TextField.changed(form.address, payload), problem: null },
			),
		SubmittedServerAddress: ($) => {
			const form = $.model.server?.form ?? null
			if (form === null || form.isBusy) return $.model
			if (form.address.text.trim() === "")
				return withForm($.model, (open) => ({ ...open, problem: "Empty" }))
			return $.set(withForm($.model, (open) => ({ ...open, isBusy: true, problem: null }))).run(
				ChangeServer.make({ address: form.address.text }),
			)
		},
		PressedCancelServerChange: ($) =>
			$.evolve({ server: (server) => (server === null ? null : { ...server, form: null }) }),
		PressedUseHazelCloud: ($) => {
			const form = $.model.server?.form ?? null
			if (form === null || form.isBusy || $.model.server?.isDefault !== false) return $.model
			return $.set(withForm($.model, (open) => ({ ...open, isBusy: true, problem: null }))).run(
				UseDefaultServer.make({}),
			)
		},
		FailedServerChange: ($, { problem }) =>
			withForm($.model, (form) => ({ ...form, isBusy: false, problem })),
		// The app reloads on the new install.
		LeftForServer: ($) => $.model,
	},
	view: (h, model) => {
		const server = model.server
		if (server === null) return webView(h, model)
		return server.form === null ? browserView(h, model, server) : serverFormView(h, server, server.form)
	},
})

/** The page with its query and Commands, on the platform's `AuthFlows`. */
export const SignInPage = SignInPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(
			GetSignInMethods.layer,
			StartOAuthSignIn.layer,
			StartPasskeySignIn.layer,
			StartBrowserSignIn.layer,
			RetireBrowserSignIn.layer,
			ChangeServer.layer,
			UseDefaultServer.layer,
		),
	),
)
