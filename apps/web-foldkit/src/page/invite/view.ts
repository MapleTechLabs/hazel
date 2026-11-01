import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import { commonMessage, failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { AppRoute, hrefOf } from "../../route"
import { authError, authFrame, authHeading } from "../auth/layout"
import { isSessionLoading, type PageViewInputs, type Shared } from "../contract"
import { Message } from "./message"
import { type AcceptFailure, Lookup, type Model, type Preview } from "./model"

const homeLink = (h: HtmlBuilder<Message>): Html =>
	h.a(
		[h.Class("text-fg text-sm underline underline-offset-2"), h.Href(hrefOf(AppRoute.Root()))],
		["Go to Hazel"],
	)

const unavailable = (h: HtmlBuilder<Message>, title: string, description: string): ReadonlyArray<Html> => [
	authHeading(h, title, description),
	homeLink(h),
]

const statusMessage = (status: Preview["status"]) =>
	status === "Accepted"
		? "This invitation has already been used."
		: status === "Revoked"
			? "This invitation was withdrawn. Ask for a new one."
			: "This invitation has expired. Ask for a new one."

const acceptFailureMessage = (reason: AcceptFailure): UserErrorMessage =>
	failureMessage(reason, {
		EmailMismatch: { title: "This invitation was sent to a different email address" },
		NoLongerValid: { title: "This invitation is no longer valid", description: "Ask for a new one." },
		WorkspaceGone: { title: "This workspace no longer exists" },
	})

const actions = (
	h: HtmlBuilder<Message>,
	model: Model,
	preview: Preview,
	shared: Shared,
): ReadonlyArray<Html> => {
	if (shared.currentUser === null)
		return [
			button(h, { intent: "primary", className: "w-full", onPress: Message.ClickedSignIn() }, [
				"Sign in to accept",
			]),
			h.p([h.Class("mt-3 text-muted-fg text-xs")], [`Use the account for ${preview.email}.`]),
		]
	if (shared.currentUser.email.toLowerCase() !== preview.email)
		return [
			h.p(
				[h.Class("text-muted-fg text-sm"), h.Role("alert")],
				[
					`This invitation is for ${preview.email}, but you're signed in as ${shared.currentUser.email}.`,
				],
			),
			button(h, { intent: "outline", className: "mt-4 w-full", onPress: Message.ClickedSignOut() }, [
				"Sign in with another account",
			]),
		]
	const isAccepting = model.acceptance._tag === "Accepting"
	return [
		button(
			h,
			{
				intent: "primary",
				className: "w-full",
				isDisabled: isAccepting,
				onPress: Message.ClickedAccept(),
			},
			isAccepting ? [loader(h, { className: "size-4" }), "Joining..."] : ["Accept invitation"],
		),
	]
}

const invitation = (
	h: HtmlBuilder<Message>,
	model: Model,
	preview: Preview,
	shared: Shared,
): ReadonlyArray<Html> =>
	preview.status !== "Pending"
		? unavailable(h, "Invitation unavailable", statusMessage(preview.status))
		: [
				avatar(h, {
					src: preview.organizationLogoUrl,
					seed: preview.organizationName,
					size: "xl",
					className: "mb-6",
				}),
				authHeading(
					h,
					`Join ${preview.organizationName}`,
					"You've been invited to this workspace on Hazel.",
				),
				...actions(h, model, preview, shared),
				...(model.acceptance._tag === "Failed"
					? [authError(h, acceptFailureMessage(model.acceptance.reason)) ?? h.empty]
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
					Loaded: ({ preview }) => invitation(h, model, preview, shared),
					NotFound: () =>
						unavailable(
							h,
							"Invitation not found",
							"This link doesn't match an invitation. Check that it was copied in full.",
						),
					Failed: ({ reason }) => [
						authHeading(h, "Couldn't load the invitation", commonMessage(reason).title),
						button(
							h,
							{
								intent: "outline",
								className: "w-full",
								onPress: Message.ClickedRetryPreview(),
							},
							["Try again"],
						),
					],
				}),
	),
)
