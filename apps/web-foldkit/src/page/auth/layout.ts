import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import type { AuthFailure } from "../../auth/flows"
import { AppRoute, hrefOf } from "../../route"
import { backgroundImage, logoContent, panelCard, panelFrame } from "../onboarding/brand-panel"

/** The auth pages' frame: the pixel-art panel on large screens, the form beside it. */

const homeLink = <M>(h: HtmlBuilder<M>, className: string, children: ReadonlyArray<Html>): Html =>
	h.a([h.Class(className), h.Href(hrefOf(AppRoute.Root()))], [...children])

const DEFAULT_TAGLINE = "A calm place for your team to talk, decide and ship."

/**
 * The frame with its own right-hand `card` (which must carry `m-auto`). `tagline` is the panel's
 * text; `null` shows the panel without one.
 */
export const authShell = <M>(
	h: HtmlBuilder<M>,
	nowMs: number,
	card: Html,
	options: { readonly tagline?: string | null } = {},
): Html => {
	const tagline = options.tagline === undefined ? DEFAULT_TAGLINE : options.tagline
	return h.main(
		[h.Class("grid h-dvh grid-cols-1 lg:grid-cols-2")],
		[
			panelFrame(h, [
				backgroundImage(h, nowMs, "Background"),
				homeLink(
					h,
					"relative z-20 flex items-center gap-2",
					logoContent(h, { logoClassName: "size-8 text-white" }),
				),
				...(tagline === null
					? []
					: [panelCard(h, [h.p([h.Class("text-lg text-white")], [tagline])])]),
			]),
			h.div(
				[h.Class("flex h-full flex-col p-6 lg:p-12")],
				[
					h.div(
						[h.Class("mb-8 lg:hidden")],
						[
							homeLink(
								h,
								"flex items-center gap-2",
								logoContent(h, { logoClassName: "size-8", textClassName: "text-fg" }),
							),
						],
					),
					card,
				],
			),
		],
	)
}

export const authFrame = <M>(h: HtmlBuilder<M>, nowMs: number, content: ReadonlyArray<Html>): Html =>
	authShell(h, nowMs, h.div([h.Class("m-auto flex w-full max-w-sm flex-col")], [...content]))

export const authHeading = <M>(h: HtmlBuilder<M>, title: string, description: string): Html =>
	h.div(
		[h.Class("mb-8 space-y-2")],
		[
			h.h1([h.Class("font-semibold text-2xl text-fg")], [title]),
			h.p([h.Class("text-muted-fg text-sm")], [description]),
		],
	)

/** A failure under the form, announced to screen readers. */
export const authError = <M>(h: HtmlBuilder<M>, message: UserErrorMessage | null): Html | null =>
	message === null
		? null
		: h.p(
				[h.Class("mt-4 text-danger text-sm"), h.Role("alert")],
				[
					message.description === undefined
						? message.title
						: `${message.title}. ${message.description}`,
				],
			)

/** What a failed sign-in says; nothing when the visitor cancelled it themselves. */
export const authFailureMessage = (reason: AuthFailure): UserErrorMessage | null =>
	reason === "Cancelled"
		? null
		: failureMessage<Exclude<AuthFailure, "Cancelled">>(reason, {
				PasskeyUnsupported: {
					title: "This browser can't use passkeys",
					description: "Continue with GitHub or Google instead.",
				},
				Rejected: { title: "Hazel couldn't verify that sign-in", description: "Please try again." },
				Expired: {
					title: "That sign-in expired or was already used",
					description: "Please start again.",
				},
				Denied: { title: "This account can't sign in to Hazel" },
				AccountConflict: {
					title: "That account is already linked to another Hazel user",
					description: "Sign in with the account you used before.",
				},
				AccountCreated: { title: "Your account is ready", description: "Sign in to continue." },
			})

export const signInLink = <M>(h: HtmlBuilder<M>, label: string): Html =>
	h.a(
		[
			h.Class("text-fg text-sm underline underline-offset-2"),
			h.Href(hrefOf(AppRoute.SignIn({ redirectUrl: Option.none() }))),
		],
		[label],
	)
