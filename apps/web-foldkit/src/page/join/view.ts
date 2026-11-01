import { Effect } from "effect"
import { Mount, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { type CommonReason, commonMessage } from "~/lib/error-messages"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { button, buttonClassName } from "../../ui/button"
import { loader } from "../../ui/loader"
import { authShell } from "../auth/layout"
import { isSessionLoading, type PageViewInputs, type Shared } from "../contract"
import { animateEnter, endStyleOf } from "../onboarding/motion"
import { Message } from "./message"
import { Lookup, type Model, type PublicOrganization } from "./model"

/** `cardVariants`: the card fades, rises and unblurs in. */
export const CardEnterAnimation = Mount.define("JoinCardEnterAnimation", {
	messages: [Message.CompletedEnterAnimation],
	execute: ({ element }) =>
		Effect.sync(() => {
			animateEnter(element, "Card")
			return Message.CompletedEnterAnimation()
		}),
})

const animatedCard = (h: HtmlBuilder<Message>, children: ReadonlyArray<Html>): Html =>
	h.div(
		[
			h.Class("m-auto flex w-full max-w-sm flex-col items-center text-center"),
			h.Attribute("style", endStyleOf("Card")),
			h.OnMount(CardEnterAnimation()),
		],
		[...children],
	)

const loadingView = (h: HtmlBuilder<Message>, nowMs: number): Html =>
	authShell(
		h,
		nowMs,
		h.div(
			[h.Class("m-auto flex flex-col items-center gap-4")],
			[loader(h, { className: "size-8" }), h.p([h.Class("text-muted-fg")], ["Loading workspace..."])],
		),
		{ tagline: null },
	)

const warningIcon = (h: HtmlBuilder<Message>): Html =>
	h.svg(
		[
			h.Class("size-10 text-danger"),
			h.Attribute("fill", "none"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("stroke", "currentColor"),
		],
		[
			h.path([
				h.Attribute("stroke-linecap", "round"),
				h.Attribute("stroke-linejoin", "round"),
				h.Attribute("stroke-width", "1.5"),
				h.Attribute(
					"d",
					"M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
				),
			]),
		],
	)

const problemCard = (
	h: HtmlBuilder<Message>,
	options: { readonly title: string; readonly description: string; readonly action: Html },
): Html =>
	animatedCard(h, [
		h.div(
			[h.Class("mb-6 flex size-20 items-center justify-center rounded-2xl bg-danger/10")],
			[warningIcon(h)],
		),
		h.h1([h.Class("mb-2 font-semibold text-2xl text-fg")], [options.title]),
		h.p([h.Class("mb-8 text-muted-fg")], [options.description]),
		options.action,
	])

const notFoundView = (h: HtmlBuilder<Message>, nowMs: number): Html =>
	authShell(
		h,
		nowMs,
		problemCard(h, {
			title: "Workspace Not Found",
			description: "This invite link is invalid or the workspace doesn't have public invites enabled.",
			action: h.a(
				[h.Class(buttonClassName({ intent: "secondary" })), h.Href(hrefOf(AppRoute.Root()))],
				["Go to Home"],
			),
		}),
		{ tagline: null },
	)

/** The lookup itself failed: not a verdict on the link, so it can be retried. */
const failedView = (h: HtmlBuilder<Message>, nowMs: number, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return authShell(
		h,
		nowMs,
		problemCard(h, {
			title: "Couldn't load this workspace",
			description:
				message.description === undefined
					? message.title
					: `${message.title}. ${message.description}`,
			action: button(h, { intent: "secondary", onPress: Message.ClickedRetryLookup() }, ["Try again"]),
		}),
		{ tagline: null },
	)
}

const actions = (h: HtmlBuilder<Message>, model: Model, isSignedIn: boolean): Html =>
	h.div(
		[h.Class("w-full space-y-3")],
		isSignedIn
			? [
					button(
						h,
						{
							intent: "primary",
							className: "w-full",
							isDisabled: model.isJoining,
							onPress: Message.ClickedJoin(),
						},
						model.isJoining
							? [loader(h, { className: "size-4" }), "Joining..."]
							: ["Join Workspace"],
					),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[
							"Wrong workspace? ",
							h.a(
								[
									h.Class("text-fg underline underline-offset-2"),
									h.Href(hrefOf(AppRoute.Root())),
								],
								["Go home"],
							),
						],
					),
				]
			: [
					button(h, { intent: "primary", className: "w-full", onPress: Message.ClickedSignIn() }, [
						"Sign in to Join",
					]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[
							"Already have an account? ",
							h.a(
								[
									h.Class("text-fg underline underline-offset-2"),
									h.Href(hrefOf(AppRoute.Root())),
								],
								["Go home"],
							),
						],
					),
				],
	)

const inviteView = (h: HtmlBuilder<Message>, model: Model, org: PublicOrganization, shared: Shared): Html =>
	authShell(
		h,
		shared.nowMs,
		animatedCard(h, [
			avatar(h, {
				src: org.logoUrl,
				seed: org.name,
				size: "4xl",
				className: "mb-6 shadow-lg",
			}),
			h.h1([h.Class("mb-2 font-semibold text-3xl text-fg")], [org.name]),
			h.p(
				[h.Class("mb-8 text-muted-fg")],
				[String(org.memberCount), " ", org.memberCount === 1 ? "member" : "members"],
			),
			actions(h, model, shared.currentUser !== null),
		]),
		{
			tagline:
				"You've been invited to join a workspace. Accept the invitation to start collaborating with your team.",
		},
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	isSessionLoading(shared)
		? loadingView(h, shared.nowMs)
		: Lookup.match(model.lookup, {
				Loading: () => loadingView(h, shared.nowMs),
				Found: ({ organization }) => inviteView(h, model, organization, shared),
				NotFound: () => notFoundView(h, shared.nowMs),
				Failed: ({ reason }) => failedView(h, shared.nowMs, reason),
			}),
)
