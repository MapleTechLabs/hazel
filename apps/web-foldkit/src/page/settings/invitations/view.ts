import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { type CommonReason, commonMessage, isRetryableReason } from "~/lib/error-messages"
import { IconClose, IconDots, IconPlus, IconUsersPlus, IconWarning } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader, cardHeaderGroup } from "../../../ui/card"
import { emptyState } from "../../../ui/empty-state"
import { loader } from "../../../ui/loader"
import * as Menu from "../../../ui/menu"
import { menuLabel, view as menuView } from "../../../ui/menu-view"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import type { Invitation, Model, RowMenu } from "./model"
import { invitationsOf, rowMenuEntries } from "./update"

/** Port of `routes/_app/$orgSlug/settings/invitations.tsx`. */

const formatSent = (createdAtMs: number) =>
	new Date(createdAtMs).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

const roleLabel = (role: string) =>
	role === "org:admin" || role === "admin"
		? "Admin"
		: role === "org:member" || role === "member"
			? "Member"
			: role

const headerCell = (h: HtmlBuilder<Message>, label: string, align: "left" | "right") =>
	h.th([h.Class(`px-4 py-3 text-${align} font-medium text-muted-fg text-xs`)], [label])

const plusIcon = (h: HtmlBuilder<Message>) => IconPlus(h, { attributes: { "data-slot": "icon" } })

const rowActions = (h: HtmlBuilder<Message>, row: RowMenu, isRevoking: boolean): Html =>
	h.submodel({
		slotId: row.menu.id,
		model: row.menu,
		view: menuView,
		viewInputs: {
			entries: rowMenuEntries(isRevoking),
			toTrigger: (attributes, overlay) =>
				button(
					h,
					{
						intent: "plain",
						size: "sq-xs",
						isPending: isRevoking,
						isDisabled: isRevoking,
						attributes: [h.AriaLabel("Invitation actions"), ...attributes],
					},
					[IconDots(h), overlay],
				),
			content: (key) => [
				IconClose(h, { attributes: { "data-slot": "icon" } }),
				menuLabel(h, row.menu.id, key, isRevoking ? "Revoking..." : "Revoke Invitation"),
			],
		},
		toParentMessage: (message: Menu.Message) =>
			Message.GotRowMenuMessage({ invitationId: row.invitationId, message }),
	})

const invitationRow = (h: HtmlBuilder<Message>, model: Model, invitation: Invitation): Html => {
	const row = model.menus.find((candidate) => candidate.invitationId === invitation.id)
	return h.keyed("tr")(
		invitation.id,
		[h.Class("hover:bg-secondary/50")],
		[
			h.td(
				[h.Class("px-4 py-4")],
				[h.p([h.Class("font-medium text-fg text-sm")], [invitation.emailAddress])],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[h.p([h.Class("text-muted-fg text-sm")], [roleLabel(invitation.role)])],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[
					badge(h, { intent: "warning" }, [
						h.span([h.Class("size-1.5 rounded-full bg-current")]),
						"Pending",
					]),
				],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[h.p([h.Class("text-muted-fg text-sm")], [formatSent(invitation.createdAtMs)])],
			),
			h.td(
				[h.Class("px-4 py-4 text-right")],
				row === undefined ? [] : [rowActions(h, row, model.revokingId === invitation.id)],
			),
		],
	)
}

const invitationsTable = (
	h: HtmlBuilder<Message>,
	model: Model,
	invitations: ReadonlyArray<Invitation>,
): Html =>
	h.div(
		[h.Class("overflow-x-auto")],
		[
			h.table(
				[h.Class("w-full min-w-full")],
				[
					h.thead(
						[h.Class("border-border border-b bg-bg")],
						[
							h.tr(
								[],
								[
									headerCell(h, "Email", "left"),
									headerCell(h, "Role", "left"),
									headerCell(h, "Status", "left"),
									headerCell(h, "Sent", "left"),
									headerCell(h, "Actions", "right"),
								],
							),
						],
					),
					h.tbody(
						[h.Class("divide-y divide-border")],
						invitations.map((invitation) => invitationRow(h, model, invitation)),
					),
				],
			),
		],
	)

const retryButton = (h: HtmlBuilder<Message>, reason: CommonReason): ReadonlyArray<Html> =>
	isRetryableReason(reason)
		? [
				button(
					h,
					{ intent: "secondary", size: "sm", onPress: Message.ClickedRetryFetchInvitations() },
					["Try again"],
				),
			]
		: []

const loadingState = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex h-64 items-center justify-center gap-3 text-muted-fg")],
		[loader(h, { className: "size-6" }), h.span([h.Class("text-sm")], ["Loading invitations..."])],
	)

/** The first load failed: nothing to show but the reason. */
const failedState = (h: HtmlBuilder<Message>, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return emptyState(h, {
		icon: (className) => IconWarning(h, { className }),
		title: "Couldn't load invitations",
		description: message.description ?? message.title,
		action: retryButton(h, reason),
		className: "h-64",
	})
}

/** A refetch failed: the last loaded rows stay, with the reason above them. */
const staleNotice = (h: HtmlBuilder<Message>, reason: CommonReason): Html =>
	h.div(
		[
			h.Class("flex items-center justify-between gap-3 border-border border-b px-4 py-3"),
			h.Role("alert"),
		],
		[
			h.p([h.Class("text-danger text-sm")], [`Couldn't refresh: ${commonMessage(reason).title}`]),
			...retryButton(h, reason),
		],
	)

const loadedBody = (h: HtmlBuilder<Message>, model: Model, invitations: ReadonlyArray<Invitation>): Html =>
	invitations.length === 0
		? emptyState(h, {
				icon: (className) => IconUsersPlus(h, { className }),
				title: "No pending invitations",
				description: "Invite team members to join your organization.",
				action: button(h, { intent: "secondary", size: "sm", onPress: Message.ClickedInviteUser() }, [
					plusIcon(h),
					"Invite a team member",
				]),
				className: "h-64",
			})
		: invitationsTable(h, model, invitations)

const body = (h: HtmlBuilder<Message>, model: Model): Html =>
	AsyncData.match(model.invitations, {
		onIdle: () => loadingState(h),
		onLoading: () => loadingState(h),
		onFailure: (reason) => failedState(h, reason),
		onRefreshing: (invitations) => loadedBody(h, model, invitations),
		onStale: ({ error, data }) => h.div([], [staleNotice(h, error), loadedBody(h, model, data)]),
		onSuccess: (invitations) => loadedBody(h, model, invitations),
	})

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const count = invitationsOf(model).length
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			card(h, {}, [
				cardHeader(h, [
					cardHeaderGroup(h, [
						h.div(
							[h.Class("flex flex-1 flex-col gap-0.5")],
							[
								h.div(
									[h.Class("flex items-center gap-2")],
									[
										h.h2(
											[h.Class("font-semibold text-fg text-lg")],
											["Pending invitations"],
										),
										...(count > 0
											? [badge(h, { intent: "secondary" }, [`${count}`, " pending"])]
											: []),
									],
								),
								h.p(
									[h.Class("text-muted-fg text-sm")],
									[
										"Pending invitations to this workspace. Each link expires 7 days after it was sent.",
									],
								),
							],
						),
						h.div(
							[h.Class("flex gap-3")],
							[
								button(
									h,
									{ intent: "secondary", size: "md", onPress: Message.ClickedInviteUser() },
									[plusIcon(h), "Invite user"],
								),
							],
						),
					]),
				]),
				body(h, model),
			]),
		],
	)
})
