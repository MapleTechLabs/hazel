import { Effect } from "effect"
import { Mount, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { type CommonReason, commonMessage } from "~/lib/error-messages"
import { IconWarning } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { button, buttonClassName } from "../../ui/button"
import { iconTile } from "../../ui/icon-tile"
import { link } from "../../ui/link"
import { loader, loadingState } from "../../ui/loader"
import { authShell } from "../auth/layout"
import { isSessionLoading, type PageViewInputs, type Shared } from "../contract"
import { animateEnter, endStyleOf } from "../onboarding/motion"
import { Message } from "./message"
import { Lookup, type Model, type PublicOrganization } from "./model"
import { heading } from "../../ui/heading"

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
		loadingState(h, { label: "Loading workspace...", className: "m-auto flex-col gap-4 py-0" }),
		{ tagline: null },
	)

const problemCard = (
	h: HtmlBuilder<Message>,
	options: { readonly title: string; readonly description: string; readonly action: Html },
): Html =>
	animatedCard(h, [
		iconTile(h, { intent: "danger", className: "mb-6 size-20 rounded-2xl *:size-10" }, IconWarning(h)),
		heading(h, { variant: "display", className: "mb-2" }, [options.title]),
		h.p([h.Class("mb-8 text-muted-fg")], [options.description]),
		options.action,
	])

const notFoundView = (h: HtmlBuilder<Message>, nowMs: number): Html =>
	authShell(
		h,
		nowMs,
		problemCard(h, {
			title: "Workspace not found",
			description: "This invite link is invalid or the workspace doesn't have public invites enabled.",
			action: h.a(
				[h.Class(buttonClassName({ intent: "secondary" })), h.Href(hrefOf(AppRoute.Root()))],
				["Go to Hazel"],
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

/** Not the workspace they meant: a way out, signed in or not. */
const wrongWorkspace = (h: HtmlBuilder<Message>): Html =>
	h.p(
		[h.Class("text-muted-fg text-sm")],
		[
			"Wrong workspace? ",
			link(h, { href: hrefOf(AppRoute.Root()), className: "text-fg underline underline-offset-2" }, [
				"Go to Hazel",
			]),
		],
	)

const actions = (h: HtmlBuilder<Message>, model: Model, isSignedIn: boolean): Html =>
	h.div(
		[h.Class("w-full space-y-3")],
		[
			isSignedIn
				? button(
						h,
						{
							intent: "primary",
							className: "w-full",
							isDisabled: model.isJoining,
							onPress: Message.ClickedJoin(),
						},
						model.isJoining
							? [loader(h, { className: "size-4" }), "Joining..."]
							: ["Join workspace"],
					)
				: button(h, { intent: "primary", className: "w-full", onPress: Message.ClickedSignIn() }, [
						"Sign in to join",
					]),
			wrongWorkspace(h),
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
			heading(h, { variant: "display", className: "mb-2" }, [org.name]),
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
