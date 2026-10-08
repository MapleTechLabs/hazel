import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCheck, IconEnvelope, IconMsgs } from "../../icons"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { input, inputGroup } from "../../ui/input"
import { fallbackAvatar } from "../avatar"
import type { ModalViewInputs } from "./contract"
import type { OrgUser } from "./create-dm-data"
import { Message, type Model, SEARCH_ID } from "./create-dm-model"
import { frameView, modalDescription, modalTitle } from "./frame"

/** The create DM modal's view (`CreateDmModal` JSX). */

const initialsOf = (user: OrgUser) => `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`

/** `filteredUsers`: everyone but the signed-in user, matched on first, last or full name. */
const filteredUsers = (model: Model, currentUserId: string | undefined) => {
	const others = model.organizationUsers.filter((user) => user.id !== currentUserId)
	const query = model.searchQuery.trim().toLowerCase()
	if (query === "") return others
	return others.filter((user) =>
		[user.firstName, user.lastName, `${user.firstName} ${user.lastName}`.trim()].some((name) =>
			name.toLowerCase().includes(query),
		),
	)
}

const userRow = (h: HtmlBuilder<Message>, user: OrgUser, isSelected: boolean): Html =>
	h.keyed("button")(
		user.id,
		[
			h.Type("button"),
			h.Class(
				`flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-secondary ${
					isSelected ? "bg-secondary ring-2 ring-primary ring-inset" : ""
				}`,
			),
			h.OnClick(Message.ClickedUser({ userId: user.id })),
		],
		[
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					fallbackAvatar(h, { size: "sm", src: user.avatarUrl, initials: initialsOf(user) }),
					h.div(
						[h.Class("flex flex-col")],
						[
							h.p([h.Class("font-medium text-sm")], [user.firstName, " ", user.lastName]),
							...(user.presenceStatus === "online"
								? [h.span([h.Class("text-success text-xs")], ["Active now"])]
								: []),
							...(user.customMessage
								? [h.span([h.Class("truncate text-muted-fg text-xs")], [user.customMessage])]
								: []),
						],
					),
				],
			),
			...(isSelected ? [IconCheck(h, { className: "size-5 text-primary" })] : []),
		],
	)

const selectedSummary = (h: HtmlBuilder<Message>, selected: ReadonlyArray<OrgUser>): Html[] =>
	selected.length === 0
		? []
		: [
				h.div(
					[h.Class("flex items-center gap-2")],
					[
						h.span([h.Class("text-muted-fg text-sm")], [`${selected.length} selected`]),
						h.div(
							[h.Class("flex -space-x-2")],
							[
								...selected
									.slice(0, 3)
									.map((user) => fallbackAvatar(h, { size: "xs", src: user.avatarUrl, initials: initialsOf(user) })),
								...(selected.length > 3
									? [
											h.div(
												[h.Class("flex size-6 items-center justify-center rounded-full bg-secondary font-medium text-xs")],
												[`+${selected.length - 3}`],
											),
										]
									: []),
							],
						),
					],
				),
			]

export const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, inputs, h) => {
	const users = filteredUsers(model, inputs.shared.currentUser?.id)
	const selected = model.organizationUsers.filter((user) => model.selectedUserIds.includes(user.id))
	return frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				h.div(
					[h.Class("flex items-center gap-3")],
					[
						h.div(
							[h.Class("flex size-10 items-center justify-center rounded-lg bg-primary-subtle")],
							[IconMsgs(h, { className: "size-5 text-primary" })],
						),
						h.div(
							[h.Class("flex flex-col")],
							[
								modalTitle(h, model.frame, "Start a conversation"),
								modalDescription(h, "Select one or more team members to start a conversation"),
							],
						),
					],
				),
			]),
			dialogBody(
				h,
				[
					h.div(
						[h.Class("flex flex-col gap-2")],
						[
							inputGroup(
								h,
								{ attributes: model.isSearchFocused ? [h.Attribute("data-focus-within", "true")] : [] },
								[
									IconEnvelope(h, { className: "text-muted-fg" }),
									input(h, {
										placeholder: "Search team members...",
										attributes: [
											h.Id(SEARCH_ID),
											...(model.isSearchFocused ? [h.Attribute("data-focused", "true")] : []),
											h.Value(model.searchQuery),
											h.OnInput((value) => Message.ChangedSearch({ value })),
											h.OnFocus(Message.FocusedSearch()),
											h.OnBlur(Message.BlurredSearch()),
										],
									}),
								],
							),
							...selectedSummary(h, selected),
						],
					),
					h.div(
						[h.Class("max-h-96 overflow-y-auto")],
						[
							users.length === 0
								? h.p(
										[h.Class("py-8 text-center text-muted-fg text-sm")],
										[model.searchQuery ? "No users found" : "No team members available"],
									)
								: h.div(
										[h.Class("flex flex-col gap-1")],
										users.map((user) => userRow(h, user, model.selectedUserIds.includes(user.id))),
									),
						],
					),
				],
				"flex flex-col gap-4",
			),
			dialogFooter(h, [
				button(h, { intent: "outline", isDisabled: model.isSubmitting, onPress: Message.ClickedCancel() }, ["Cancel"]),
				button(
					h,
					{
						intent: "primary",
						isDisabled: model.isSubmitting || selected.length === 0,
						onPress: Message.ClickedStartConversation(),
					},
					[
						model.isSubmitting
							? "Creating..."
							: selected.length > 1
								? `Start group conversation (${selected.length})`
								: "Start conversation",
					],
				),
			]),
		],
		(message) => Message.GotFrameMessage({ message }),
	)
})
