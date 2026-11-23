import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Provider } from "../../../auth/client"
import { IconExternalLink, IconGitHub, IconGoogle, IconLock, type IconOptions } from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { button } from "../../../ui/button"
import { loader } from "../../../ui/loader"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs } from "../../contract"
import type { UserErrorMessage } from "~/lib/error-messages"
import { authError, authFailureMessage, authFrame, authHeading } from "../layout"
import { Message } from "./message"
import {
	type Attempt,
	type Model,
	pendingAttempt,
	type ServerChoice,
	type ServerForm,
	type ServerProblem,
	type SignInFailure,
} from "./model"

const providers: ReadonlyArray<{
	readonly id: Provider
	readonly label: string
	readonly icon: (h: HtmlBuilder<Message>, options?: IconOptions) => Html
}> = [
	{ id: "github", label: "GitHub", icon: IconGitHub },
	{ id: "google", label: "Google", icon: IconGoogle },
]

/** Brand marks keep their own colors, so they skip the button's muted `data-slot="icon"` tint. */
const brandIconOptions: IconOptions = {
	className: "size-4 shrink-0",
	attributes: { "aria-hidden": "true" },
}

const choice = (
	h: HtmlBuilder<Message>,
	options: {
		readonly label: string
		readonly icon: Html
		readonly isPending: boolean
		readonly isDisabled: boolean
		readonly onPress: Message
	},
): Html =>
	button(
		h,
		{
			intent: "outline",
			className: "w-full",
			isDisabled: options.isDisabled,
			onPress: options.onPress,
		},
		[options.isPending ? loader(h, { className: "size-4" }) : options.icon, options.label],
	)

const divider = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex items-center gap-3 text-muted-fg text-xs")],
		[h.div([h.Class("h-px flex-1 bg-border")]), "or", h.div([h.Class("h-px flex-1 bg-border")])],
	)

const choices = (h: HtmlBuilder<Message>, pending: Attempt | null): Html =>
	h.div(
		[h.Class("flex flex-col gap-3")],
		[
			...providers.map(({ id, label, icon }) =>
				choice(h, {
					label: `Continue with ${label}`,
					icon: icon(h, brandIconOptions),
					isPending: pending === id,
					isDisabled: pending !== null,
					onPress: Message.ClickedProvider({ provider: id }),
				}),
			),
			divider(h),
			choice(h, {
				label: "Sign in with a passkey",
				icon: IconLock(h, { className: "size-4", attributes: { "aria-hidden": "true" } }),
				isPending: pending === "passkey",
				isDisabled: pending !== null,
				onPress: Message.ClickedPasskey(),
			}),
		],
	)

const switchLink = (h: HtmlBuilder<Message>, model: Model): Html => {
	const isSignIn = model.mode === "SignIn"
	const redirectUrl = Option.fromNullishOr(model.redirectUrl)
	const target = isSignIn
		? AppRoute.SignUp({ redirectUrl })
		: AppRoute.SignIn({ redirectUrl, error: Option.none() })
	return h.p(
		[h.Class("mt-8 text-muted-fg text-sm")],
		[
			isSignIn ? "New to Hazel? " : "Already have an account? ",
			h.a(
				[h.Class("text-fg underline underline-offset-2"), h.Href(hrefOf(target))],
				[isSignIn ? "Create an account" : "Sign in"],
			),
		],
	)
}

/** What a failed sign-in says, including the desktop browser's own failures. */
const signInFailureMessage = (reason: SignInFailure): UserErrorMessage | null =>
	reason === "BrowserTimedOut"
		? { title: "Signing in took too long", description: "Please try again." }
		: reason === "BrowserBusy"
			? { title: "A sign-in is already in progress in your browser" }
			: reason === "BrowserIndeterminate"
				? { title: "Couldn't finish signing in", description: "Please try again." }
				: authFailureMessage(reason)

const failureOf = (model: Model): UserErrorMessage | null =>
	model.submission._tag === "Failed" ? signInFailureMessage(model.submission.reason) : null

/** The desktop app signs in through the system browser, where GitHub, Google and passkeys work. */
const desktopChoices = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html> => [
	authHeading(h, "Sign in to Hazel", "Continue in your browser, then come back here."),
	pendingAttempt(model) === "browser"
		? h.div(
				[h.Class("flex flex-col gap-3")],
				[
					button(h, { intent: "primary", className: "w-full", isDisabled: true }, [
						loader(h, { className: "size-4" }),
						"Waiting for your browser...",
					]),
					button(
						h,
						{
							intent: "outline",
							className: "w-full",
							onPress: Message.ClickedCancelBrowserSignIn(),
						},
						["Cancel"],
					),
				],
			)
		: button(h, { intent: "primary", className: "w-full", onPress: Message.ClickedBrowserSignIn() }, [
				IconExternalLink(h, { className: "size-4", attributes: { "aria-hidden": "true" } }),
				"Sign in with your browser",
			]),
	...[authError(h, failureOf(model))].filter((html): html is Html => html !== null),
]

const serverProblemText = (problem: ServerProblem): string =>
	problem === "Empty"
		? "Enter your workspace's web address"
		: problem === "Invalid"
			? "That isn't a web address, e.g. chat.acme.com"
			: problem === "Insecure"
				? "The address must use https"
				: problem === "Unreachable"
					? "Couldn't reach that address. Check it and your connection."
					: "No Hazel workspace answers at that address"

const toServerAddress = (value: string) => Message.ChangedServerAddress({ value })

/** Native: another install's address (a customer's), resolved through its `/.well-known/hazel.json`. */
const serverFormView = (
	h: HtmlBuilder<Message>,
	server: ServerChoice,
	form: ServerForm,
): ReadonlyArray<Html> => [
	authHeading(
		h,
		"Sign in to another Hazel",
		"Enter the web address your workspace uses, e.g. chat.acme.com.",
	),
	h.form(
		[h.Class("flex flex-col gap-4"), h.OnSubmit(Message.SubmittedServerAddress())],
		[
			textField(
				h,
				{
					id: "sign-in-server-address",
					value: form.address,
					isRequired: true,
					isDisabled: form.isBusy,
					isInvalid: form.problem !== null,
					onInput: toServerAddress,
				},
				(parts) => [
					parts.label(["Web address"]),
					parts.input({
						attributes: [
							h.Attribute("inputmode", "url"),
							h.Attribute("autocapitalize", "none"),
							h.Attribute("autocorrect", "off"),
							h.Attribute("spellcheck", "false"),
							h.Attribute("placeholder", "chat.acme.com"),
							h.Autofocus(true),
						],
					}),
					parts.fieldError([form.problem === null ? "" : serverProblemText(form.problem)]),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-3")],
				[
					button(
						h,
						{
							intent: "primary",
							className: "w-full",
							isDisabled: form.isBusy,
							onPress: Message.SubmittedServerAddress(),
						},
						form.isBusy ? [loader(h, { className: "size-4" }), "Connecting..."] : ["Continue"],
					),
					button(
						h,
						{
							intent: "outline",
							className: "w-full",
							isDisabled: form.isBusy,
							onPress: Message.ClickedCancelServerChange(),
						},
						["Cancel"],
					),
					...(server.isDefault
						? []
						: [
								button(
									h,
									{
										intent: "plain",
										className: "w-full",
										isDisabled: form.isBusy,
										onPress: Message.ClickedUseHazelCloud(),
									},
									["Use Hazel cloud"],
								),
							]),
				],
			),
		],
	),
]

/** Native: which install the app signs in to, and the way to another. */
const serverLine = (h: HtmlBuilder<Message>, model: Model, server: ServerChoice): Html =>
	h.div(
		[h.Class("mt-8 flex items-center gap-1 text-muted-fg text-sm")],
		[
			h.span([], ["Signing in to ", h.span([h.Class("font-medium text-fg")], [server.label])]),
			h.span([h.Attribute("aria-hidden", "true")], ["·"]),
			button(
				h,
				{
					intent: "plain",
					size: "xs",
					isDisabled: pendingAttempt(model) !== null,
					onPress: Message.ClickedChangeServer(),
					attributes: [h.AriaLabel(`Change from ${server.label}`)],
				},
				["Change"],
			),
		],
	)

const nativeView = (h: HtmlBuilder<Message>, model: Model, server: ServerChoice): ReadonlyArray<Html> =>
	server.form === null
		? [...desktopChoices(h, model), serverLine(h, model, server)]
		: serverFormView(h, server, server.form)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	model.server !== null
		? authFrame(h, shared.nowMs, nativeView(h, model, model.server))
		: authFrame(h, shared.nowMs, [
				model.mode === "SignIn"
					? authHeading(h, "Sign in to Hazel", "Welcome back. Pick how you'd like to sign in.")
					: authHeading(
							h,
							"Create your Hazel account",
							"Sign up with GitHub or Google. It takes a few seconds.",
						),
				choices(h, pendingAttempt(model)),
				authError(h, failureOf(model)),
				switchLink(h, model),
			]),
)
