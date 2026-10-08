import { Submodel } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { getStatusDotColor } from "~/utils/status"
import { IconCircleDottedUser, IconCopy, IconDots, IconMsgs, IconPhone } from "../../icons"
import type * as Interaction from "../../ui/aria/interaction"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import type * as Menu from "../../ui/menu"
import { menuLabel, menuTriggerClassName, view as menuView } from "../../ui/menu-view"
import { searchField } from "../../ui/search-field"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"
import type { PageViewInputs } from "../contract"
import { AutoFocusSearch } from "./commands"
import { Message } from "./message"
import { type DirectoryMember, filterMembers, menuIdOf, type Model, SEARCH_ID } from "./model"

/** Port of `routes/_app/$orgSlug/index.tsx`. */

const toInteractionMessage = (message: Interaction.Message) => Message.GotInteractionMessage({ message })

const getInitials = (name: string) => {
	const [firstName, lastName] = name.split(" ")
	return `${firstName?.charAt(0)}${lastName?.charAt(0)}`
}

const toMenuMessage = (member: DirectoryMember) => (message: Menu.Message) =>
	Message.GotMemberMenuMessage({ userId: member.id, message })

const menuContent = (h: HtmlBuilder<Message>, id: string): ((key: string) => ReadonlyArray<Html>) => {
	const icon = { attributes: { "data-slot": "icon" } }
	const byKey: Record<string, () => ReadonlyArray<Html>> = {
		message: () => [IconMsgs(h, icon), menuLabel(h, id, "message", "Message")],
		"view-profile": () => [
			IconCircleDottedUser(h, icon),
			menuLabel(h, id, "view-profile", "View profile"),
		],
		"start-call": () => [IconPhone(h, icon), menuLabel(h, id, "start-call", "Start call")],
		"copy-email": () => [IconCopy(h, icon), menuLabel(h, id, "copy-email", "Copy email")],
	}
	return (key) => byKey[key]?.() ?? []
}

const memberMenuTrigger =
	(h: HtmlBuilder<Message>) =>
	(attributes: ReadonlyArray<ChildAttribute>, overlay: Html): Html =>
		h.button(
			[
				...attributes,
				h.AriaLabel("Member actions"),
				h.Class(
					menuTriggerClassName(
						cn(
							"inline-flex size-8 items-center justify-center rounded-lg border border-transparent hover:border-border hover:bg-secondary",
							"pressed:bg-secondary group-hover:border-border",
						),
					),
				),
				h.Attribute("data-react-aria-pressable", "true"),
				h.Attribute("data-slot", "menu-trigger"),
				h.Attribute("tabindex", "0"),
				h.Attribute("type", "button"),
			],
			[IconDots(h, { className: "size-5 text-muted-fg" }), overlay],
		)

const memberMenu = (h: HtmlBuilder<Message>, member: DirectoryMember, menu: Menu.Model): Html =>
	h.submodel({
		slotId: menuIdOf(member.id),
		model: menu,
		view: menuView,
		viewInputs: {
			toTrigger: memberMenuTrigger(h),
			content: menuContent(h, menu.id),
		},
		toParentMessage: toMenuMessage(member),
	})

const memberRow = (
	h: HtmlBuilder<Message>,
	member: DirectoryMember,
	menu: Menu.Model | undefined,
	currentUserId: string | undefined,
): Html => {
	const fullName = `${member.firstName} ${member.lastName}`.trim()
	const isCurrentUser = currentUserId !== undefined && currentUserId === member.id
	return h.keyed("div")(
		member.id,
		[
			h.Class(
				cn(
					"flex items-center justify-between gap-4 rounded-lg px-3 py-2",
					!isCurrentUser &&
						"group border border-transparent hover:border-border hover:bg-secondary/40",
				),
			),
		],
		[
			h.div(
				[h.Class("flex items-center gap-2 sm:gap-2.5")],
				[
					h.div(
						[h.Class("relative")],
						[
							avatar(h, {
								src: member.avatarUrl,
								initials: getInitials(fullName || "User"),
								className: "size-9",
							}),
							member.presenceStatus
								? h.span(
										[
											h.Class(
												cn(
													"absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-bg",
													getStatusDotColor(member.presenceStatus),
												),
											),
										],
										[],
									)
								: h.empty,
						],
					),
					h.div(
						[],
						[
							h.div(
								[h.Class("flex items-center font-semibold text-sm/6")],
								[
									fullName || "Unknown User",
									h.span([h.Class("mx-2 text-muted-fg")], ["·"]),
									h.span(
										[h.Class("text-muted-fg text-xs capitalize")],
										[
											member.role,
											" ",
											member.role === "admin"
												? h.span([h.Class("ml-1")], ["\u{1F451}"])
												: h.empty,
										],
									),
								],
							),
							h.p([h.Class("text-muted-fg text-xs")], [member.email]),
						],
					),
				],
			),
			isCurrentUser
				? h.empty
				: h.div(
						[h.Class("flex items-center gap-2")],
						[
							button(
								h,
								{
									intent: "secondary",
									size: "sm",
									onPress: Message.PressedMessageMember({
										userId: member.id,
										name: fullName,
									}),
									className:
										"hidden border-transparent pressed:bg-muted group-hover:border-border sm:inline-flex",
								},
								[IconMsgs(h, { attributes: { "data-slot": "icon" } })],
							),
							menu === undefined ? h.empty : memberMenu(h, member, menu),
						],
					),
		],
	)
}

const memberListContent = (
	h: HtmlBuilder<Message>,
	model: Model,
	currentUserId: string | undefined,
): ReadonlyArray<Html> => {
	if (model.members === null) {
		return [
			h.div([h.Class("flex items-center justify-center py-8")], [loader(h, { className: "size-8" })]),
		]
	}
	const filtered = filterMembers(model.members, model.searchQuery)
	if (filtered.length === 0) {
		return [
			h.div(
				[h.Class("py-8 text-center text-muted-fg")],
				[
					model.searchQuery
						? "No members found matching your search"
						: "No members in this organization",
				],
			),
		]
	}
	return filtered.map((member) => memberRow(h, member, model.menus[member.id], currentUserId))
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	h.div(
		[h.Class("flex flex-col gap-6 px-4 py-6 lg:px-8")],
		[
			sectionHeaderRoot(h, { className: "border-none pb-0" }, [
				sectionHeaderGroup(h, {}, [
					h.div(
						[h.Class("space-y-0.5")],
						[
							sectionHeaderHeading(h, { size: "xl" }, ["Members"]),
							sectionHeaderSubheading(h, {}, [
								"Explore your organization and connect with fellow members.",
							]),
						],
					),
				]),
			]),
			h.div(
				[h.Class("w-full")],
				[
					searchField(
						h,
						{
							id: SEARCH_ID,
							value: model.searchQuery,
							onInput: (value) => Message.ChangedSearch({ value }),
							onClear: Message.ClearedSearch(),
							onClearPressStart: Message.PressedClearSearch(),
							className: "w-full",
							interaction: { model: model.interaction, toParentMessage: toInteractionMessage },
						},
						(parts) => [
							parts.searchInput({
								placeholder: "Search members...",
								attributes: [h.OnMount(AutoFocusSearch())],
							}),
						],
					),
				],
			),
			h.div([h.Class("w-full space-y-2")], [...memberListContent(h, model, shared.currentUser?.id)]),
		],
	),
)
