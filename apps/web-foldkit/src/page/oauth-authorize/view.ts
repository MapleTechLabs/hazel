import type { AgentScope } from "@hazel/domain/http"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { commonMessage, failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { IconCheck } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import { authError, authFrame, authHeading } from "../auth/layout"
import { isSessionLoading, type PageViewInputs, type Shared } from "../contract"
import { Message } from "./message"
import { type ApproveFailure, type ClientSummary, Lookup, type Model } from "./model"

/** What each scope lets the agent do, in the user's words. */
const SCOPE_ABILITIES = {
	"messages:read": ["Read your channels, direct messages and threads", "See messages that mention you"],
	"messages:write": [
		"Send messages and replies as you",
		"Share files in your channels",
		"React to messages",
		"Edit and delete your messages",
		"Set your status",
	],
} satisfies Readonly<Record<AgentScope, ReadonlyArray<string>>>

const homeLink = (h: HtmlBuilder<Message>): Html =>
	h.a(
		[h.Class("text-fg text-sm underline underline-offset-2"), h.Href(hrefOf(AppRoute.Root()))],
		["Go to Hazel"],
	)

const approveFailureMessage = (reason: ApproveFailure): UserErrorMessage =>
	failureMessage(reason, {
		Invalid: { title: "This link is no longer valid", description: "Start again from your agent." },
	})

const abilities = (h: HtmlBuilder<Message>, scopes: ReadonlyArray<AgentScope>): Html =>
	h.ul(
		[h.Class("mb-4 flex flex-col gap-2 rounded-lg border border-border p-3")],
		scopes
			.flatMap((scope) => SCOPE_ABILITIES[scope])
			.map((ability) =>
				h.li(
					[h.Class("flex items-start gap-2 text-fg text-sm")],
					[IconCheck(h, { className: "mt-0.5 size-4 shrink-0 text-muted-fg" }), ability],
				),
			),
	)

const actions = (h: HtmlBuilder<Message>, model: Model, shared: Shared): Html => {
	const isLeaving = model.approval._tag === "Leaving"
	if (shared.currentUser === null)
		return button(
			h,
			{
				intent: "primary",
				className: "w-full",
				isDisabled: isLeaving,
				onPress: Message.ClickedSignIn(),
			},
			["Sign in to continue"],
		)
	const isApproving = model.approval._tag === "Approving"
	const isDenying = model.approval._tag === "Denying"
	const isBusy = isApproving || isDenying || isLeaving
	return h.div(
		[h.Class("mt-6 flex flex-col gap-2")],
		[
			button(
				h,
				{
					intent: "primary",
					className: "w-full",
					isDisabled: isBusy,
					onPress: Message.ClickedApprove(),
				},
				isApproving ? [loader(h, { className: "size-4" }), "Allowing..."] : ["Allow"],
			),
			button(
				h,
				{ intent: "plain", className: "w-full", isDisabled: isBusy, onPress: Message.ClickedDeny() },
				["Deny"],
			),
		],
	)
}

const request = (
	h: HtmlBuilder<Message>,
	model: Model,
	client: ClientSummary,
	shared: Shared,
): ReadonlyArray<Html> => [
	avatar(h, { src: client.logoUri, seed: client.name, size: "xl", className: "mb-6" }),
	authHeading(
		h,
		`Connect ${client.name}`,
		`${client.name} wants to act for you in Hazel. It will be able to:`,
	),
	abilities(h, model.request?.scopes ?? []),
	h.p(
		[h.Class("mb-2 text-muted-fg text-xs")],
		[
			`Messages it sends are shown as written by an agent ("via ${client.name}") to people in your organization.`,
		],
	),
	h.p(
		[h.Class("text-muted-fg text-xs")],
		[
			"You'll return to ",
			h.span([h.Class("font-medium text-fg")], [client.redirectHost]),
			". You can disconnect it any time in My Settings → Agents.",
		],
	),
	actions(h, model, shared),
	...(model.approval._tag === "Failed"
		? [authError(h, approveFailureMessage(model.approval.reason)) ?? h.empty]
		: []),
]

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	authFrame(
		h,
		shared.nowMs,
		isSessionLoading(shared)
			? [loader(h, { className: "size-6" })]
			: Lookup.match(model.lookup, {
					Loading: () => [loader(h, { className: "size-6" })],
					Loaded: ({ client }) => request(h, model, client, shared),
					Invalid: () => [
						authHeading(
							h,
							"This link is invalid",
							"It may be incomplete, or the agent that sent you here isn't registered with Hazel. Start again from your agent.",
						),
						homeLink(h),
					],
					// Looking the client up needs a session: a signed-out visitor signs in and comes back.
					Failed: ({ reason }) =>
						reason === "SignedOut" && shared.currentUser === null
							? [
									authHeading(
										h,
										"Sign in to connect your agent",
										"You'll come back here afterwards.",
									),
									actions(h, model, shared),
								]
							: [
									authHeading(h, "Couldn't load this request", commonMessage(reason).title),
									button(
										h,
										{
											intent: "outline",
											className: "w-full",
											onPress: Message.ClickedRetryRequest(),
										},
										["Try again"],
									),
								],
				}),
	),
)
