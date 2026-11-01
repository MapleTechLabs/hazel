import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { commonMessage, failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import { authError, authFrame, authHeading } from "../auth/layout"
import { isSessionLoading, type PageViewInputs, type Shared } from "../contract"
import { Message } from "./message"
import { type ApproveFailure, type BotSummary, type InstallTarget, Lookup, type Model } from "./model"

const homeLink = (h: HtmlBuilder<Message>): Html =>
	h.a(
		[h.Class("text-fg text-sm underline underline-offset-2"), h.Href(hrefOf(AppRoute.Root()))],
		["Go to Hazel"],
	)

const approveFailureMessage = (reason: ApproveFailure): UserErrorMessage =>
	failureMessage(reason, {
		NotAdmin: { title: "Only an owner or admin can install apps in this workspace" },
		Invalid: { title: "This install link is no longer valid", description: "Start again from the app." },
	})

const targetOption = (h: HtmlBuilder<Message>, target: InstallTarget, isSelected: boolean): Html =>
	h.keyed("button")(
		target.id,
		[
			h.Type("button"),
			h.Role("radio"),
			h.AriaChecked(isSelected),
			h.AriaLabel(target.name),
			h.OnClick(Message.SelectedOrganization({ organizationId: target.id })),
			h.Class(
				`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
					isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
				}`,
			),
		],
		[
			avatar(h, { src: target.logoUrl, seed: target.name, className: "size-8" }),
			h.span([h.Class("flex-1 truncate font-medium text-fg text-sm")], [target.name]),
		],
	)

const targetsView = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html> => {
	if (model.targets === null) return [loader(h, { className: "size-5" })]
	if (model.targets.length === 0)
		return [
			h.p(
				[h.Class("text-muted-fg text-sm"), h.Role("alert")],
				["You need to be an owner or admin of a workspace to install apps."],
			),
		]
	return [
		h.p([h.Class("mb-2 font-medium text-fg text-sm")], ["Install in"]),
		h.div(
			[h.Class("flex flex-col gap-2"), h.Role("radiogroup"), h.AriaLabel("Workspace")],
			model.targets.map((target) =>
				targetOption(h, target, target.id === model.selectedOrganizationId),
			),
		),
	]
}

const actions = (h: HtmlBuilder<Message>, model: Model, shared: Shared): ReadonlyArray<Html> => {
	const isLeaving = model.approval._tag === "Leaving"
	if (shared.currentUser === null)
		return [
			button(
				h,
				{
					intent: "primary",
					className: "w-full",
					isDisabled: isLeaving,
					onPress: Message.ClickedSignIn(),
				},
				["Sign in to continue"],
			),
		]
	const isApproving = model.approval._tag === "Approving"
	return [
		h.div(
			[h.Class("mt-6 flex flex-col gap-2")],
			[
				button(
					h,
					{
						intent: "primary",
						className: "w-full",
						isDisabled: isApproving || isLeaving || model.selectedOrganizationId === null,
						onPress: Message.ClickedApprove(),
					},
					isApproving ? [loader(h, { className: "size-4" }), "Installing..."] : ["Install"],
				),
				button(
					h,
					{
						intent: "plain",
						className: "w-full",
						isDisabled: isApproving || isLeaving,
						onPress: Message.ClickedCancel(),
					},
					["Cancel"],
				),
			],
		),
	]
}

const request = (
	h: HtmlBuilder<Message>,
	model: Model,
	bot: BotSummary,
	shared: Shared,
): ReadonlyArray<Html> => [
	avatar(h, { src: bot.avatarUrl, seed: bot.name, size: "xl", className: "mb-6" }),
	authHeading(
		h,
		`Install ${bot.name}`,
		bot.description ?? `${bot.name} by ${bot.creatorName} wants to join a workspace.`,
	),
	h.p(
		[h.Class("mb-6 text-muted-fg text-xs")],
		[
			`${bot.name} will join the workspace as a member: it can read and post in its public channels, and in the private channels and threads it is added to. Built by ${bot.creatorName}.`,
		],
	),
	...(shared.currentUser === null ? [] : targetsView(h, model)),
	...actions(h, model, shared),
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
					Loaded: ({ bot }) => request(h, model, bot, shared),
					Invalid: () => [
						authHeading(
							h,
							"This install link isn't valid",
							"It may be incomplete, or the app it names doesn't accept installs from here. Start again from the app.",
						),
						homeLink(h),
					],
					// Looking the app up needs a session: a signed-out visitor signs in and comes back.
					Failed: ({ reason }) =>
						reason === "SignedOut" && shared.currentUser === null
							? [
									authHeading(
										h,
										"Sign in to install this app",
										"You'll come back here afterwards.",
									),
									...actions(h, model, shared),
								]
							: [
									authHeading(h, "Couldn't load this app", commonMessage(reason).title),
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
