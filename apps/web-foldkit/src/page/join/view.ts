import { Effect } from "effect"
import { Mount, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import type { PageViewInputs, Shared } from "../contract"
import { backgroundImage, logoContent, panelCard, panelFrame } from "../onboarding/brand-panel"
import { animateEnter, endStyleOf } from "../onboarding/motion"
import { Message } from "./message"
import type { Model, PublicOrganization } from "./model"

/** `cardVariants`: the card fades, rises and unblurs in. */
export const CardEnterAnimation = Mount.define("JoinCardEnterAnimation", {
	args: {},
	messages: [Message.CompletedEnterAnimation],
	execute: ({ element }) =>
		Effect.sync(() => {
			animateEnter(element, "Card")
			return Message.CompletedEnterAnimation()
		}),
})

const homeLink = <M>(h: HtmlBuilder<M>, className: string, children: ReadonlyArray<Html>): Html =>
	h.a([h.Class(className), h.Href("/")], [...children])

const leftPanel = (h: HtmlBuilder<Message>, nowMs: number, card: ReadonlyArray<Html>): Html =>
	panelFrame(h, [
		backgroundImage(h, nowMs, "Background"),
		homeLink(
			h,
			"relative z-20 flex items-center gap-2",
			logoContent(h, { logoClassName: "size-8 text-white" }),
		),
		...card,
	])

const mobileLogo = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("mb-8 lg:hidden")],
		[
			homeLink(
				h,
				"flex items-center gap-2",
				logoContent(h, { logoClassName: "size-8", textClassName: "text-fg" }),
			),
		],
	)

const page = (h: HtmlBuilder<Message>, left: Html, right: Html): Html =>
	h.main([h.Class("grid h-dvh grid-cols-1 lg:grid-cols-2")], [left, right])

const animatedCard = (h: HtmlBuilder<Message>, children: ReadonlyArray<Html>): Html =>
	h.div(
		[
			h.Class("m-auto flex w-full max-w-sm flex-col items-center text-center"),
			h.Attribute("style", endStyleOf("Card")),
			h.OnMount(CardEnterAnimation({})),
		],
		[...children],
	)

const loadingView = (h: HtmlBuilder<Message>, nowMs: number): Html =>
	page(
		h,
		leftPanel(h, nowMs, []),
		h.div(
			[h.Class("flex h-full flex-col items-center justify-center p-6 lg:p-12")],
			[
				h.div(
					[h.Class("flex flex-col items-center gap-4")],
					[
						loader(h, { className: "size-8" }),
						h.p([h.Class("text-muted-fg")], ["Loading workspace..."]),
					],
				),
			],
		),
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

const notFoundView = (h: HtmlBuilder<Message>, nowMs: number): Html =>
	page(
		h,
		leftPanel(h, nowMs, []),
		h.div(
			[h.Class("flex h-full flex-col p-6 lg:p-12")],
			[
				mobileLogo(h),
				animatedCard(h, [
					h.div(
						[h.Class("mb-6 flex size-20 items-center justify-center rounded-2xl bg-danger/10")],
						[warningIcon(h)],
					),
					h.h1([h.Class("mb-2 font-semibold text-2xl text-fg")], ["Workspace Not Found"]),
					h.p(
						[h.Class("mb-8 text-muted-fg")],
						["This invite link is invalid or the workspace doesn't have public invites enabled."],
					),
					// `<Link to="/"><Button/></Link>`: a button nested in the anchor.
					h.a([h.Href("/")], [button(h, { intent: "secondary" }, ["Go to Home"])]),
				]),
			],
		),
	)

const initialsOf = (name: string) => {
	const words = name.split(" ")
	return words.length >= 2
		? `${words[0]?.charAt(0)}${words[1]?.charAt(0)}`.toUpperCase()
		: name.substring(0, 2).toUpperCase()
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
							h.a([h.Class("text-fg underline underline-offset-2"), h.Href("/")], ["Go home"]),
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
							h.a([h.Class("text-fg underline underline-offset-2"), h.Href("/")], ["Go home"]),
						],
					),
				],
	)

const inviteView = (h: HtmlBuilder<Message>, model: Model, org: PublicOrganization, shared: Shared): Html =>
	page(
		h,
		leftPanel(h, shared.nowMs, [
			panelCard(h, [
				h.p(
					[h.Class("text-lg text-white")],
					[
						"You've been invited to join a workspace. Accept the invitation to start collaborating with your team.",
					],
				),
			]),
		]),
		h.div(
			[h.Class("flex h-full flex-col p-6 lg:p-12")],
			[
				mobileLogo(h),
				animatedCard(h, [
					avatar(h, {
						src: org.logoUrl,
						initials: initialsOf(org.name),
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
			],
		),
	)

/** `useAuth().isLoading`: Clerk not loaded yet, or signed in while `user.me` is pending. */
const isAuthLoading = (shared: Shared) =>
	shared.auth === "Loading" || (shared.auth === "SignedIn" && shared.currentUser === null)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	if (model.lookup._tag === "Loading" || isAuthLoading(shared)) return loadingView(h, shared.nowMs)
	const organization = model.lookup._tag === "Loaded" ? model.lookup.organization : null
	return organization ? inviteView(h, model, organization, shared) : notFoundView(h, shared.nowMs)
})
