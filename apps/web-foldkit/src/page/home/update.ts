import { Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import * as Menu from "../../ui/menu"
import type { PageReturn, Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import { CopyEmail, CreateDm, FindDm, FocusSearch } from "./commands"
import { Message } from "./message"
import { type DirectoryMember, menuEntries, menuIdOf, type Model } from "./model"

export const init = (): PageReturn<Model, Message> => ({
	model: { members: null, searchQuery: "", menus: {}, interaction: Interaction.init() },
})

/** The DM flow's toasts share one id, so each replaces the previous (legacy `exitToast` loading). */
const DM_TOAST_ID = "home-create-dm"

const toast = (
	intent: "success" | "error" | "loading",
	title: string,
	description: string | null,
	id?: string,
) => PageOutMessage.RequestedToast({ toast: { intent, title, description, ...(id === undefined ? {} : { id }) } })

const navigateToChannel = (shared: Shared, channelId: string) =>
	PageOutMessage.RequestedNavigation({ href: `/${shared.orgSlug ?? ""}/chat/${channelId}`, replace: false })

/** Keeps each member's menu (and its open state) across live-query updates. */
const reconcileMenus = (model: Model, members: ReadonlyArray<DirectoryMember>): Model["menus"] =>
	Object.fromEntries(
		members.map((member) => [
			member.id,
			model.menus[member.id] ??
				Menu.init({ id: menuIdOf(member.id), entries: menuEntries, placement: "bottom end" }),
		]),
	)

const memberByUserId = (model: Model, userId: string) =>
	Option.fromNullishOr(model.members?.find((member) => member.id === userId))

const openChat = (model: Model, shared: Shared, member: DirectoryMember): PageReturn<Model, Message> => {
	const organizationId = shared.organization?.id
	const currentUserId = shared.currentUser?.id
	if (!organizationId || !currentUserId) return { model }
	const name = `${member.firstName} ${member.lastName}`.trim()
	return { model, commands: [FindDm({ currentUserId, userId: member.id, name, organizationId })] }
}

const updateMenu = (
	model: Model,
	shared: Shared,
	member: DirectoryMember,
	message: Menu.Message,
): PageReturn<Model, Message> => {
	const menu = model.menus[member.id]
	if (menu === undefined) return { model }
	const result = Menu.update(menu, message)
	const next = modifyFields(model, { menus: (menus) => ({ ...menus, [member.id]: result.model }) })
	const menuCommands = Command.mapMessages(result.commands ?? [], (child) =>
		Message.GotMemberMenuMessage({ userId: member.id, message: child }),
	)
	const selected = Option.flatMap(Option.fromNullishOr(result.outMessage), (out) =>
		out._tag === "SelectedItem" ? Option.some(out.key) : Option.none(),
	)
	const action: PageReturn<Model, Message> = Option.match(selected, {
		onNone: () => ({ model: next }),
		onSome: (key) =>
			key === "message"
				? openChat(next, shared, member)
				: key === "copy-email"
					? { model: next, commands: [CopyEmail({ email: member.email })] }
					: { model: next },
	})
	return { ...action, commands: [...menuCommands, ...(action.commands ?? [])] }
}

export const update = (model: Model, message: Message, shared: Shared): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedMembers: ({ members }) => ({
			model: modifyFields(model, {
				members: () => members,
				menus: () => reconcileMenus(model, members),
			}),
		}),
		ChangedSearch: ({ value }) => ({ model: modifyFields(model, { searchQuery: () => value }) }),
		ClearedSearch: () => ({ model: modifyFields(model, { searchQuery: () => "" }) }),
		PressedClearSearch: () => ({ model, commands: [FocusSearch()] }),
		CompletedFocusSearch: () => ({ model }),
		PressedMessageMember: ({ userId }) =>
			Option.match(memberByUserId(model, userId), {
				onNone: () => ({ model }),
				onSome: (member) => openChat(model, shared, member),
			}),
		GotInteractionMessage: ({ message: interactionMessage }) => ({
			model: modifyFields(model, {
				interaction: (interaction) => Interaction.update(interaction, interactionMessage).model,
			}),
		}),
		GotMemberMenuMessage: ({ userId, message: menuMessage }) =>
			Option.match(memberByUserId(model, userId), {
				onNone: () => ({ model }),
				onSome: (member) => updateMenu(model, shared, member, menuMessage),
			}),
		FoundExistingDm: ({ channelId }) => ({ model, outMessage: navigateToChannel(shared, channelId) }),
		FoundNoDm: ({ userId, name }) => {
			const organizationId = shared.organization?.id
			return organizationId
				? {
						model,
						commands: [CreateDm({ organizationId, userId, name })],
						outMessage: toast("loading", `Starting conversation with ${name}...`, null, DM_TOAST_ID),
					}
				: { model }
		},
		SucceededCreateDm: ({ channelId, name }) => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${shared.orgSlug ?? ""}/chat/${channelId}`,
				replace: false,
				toast: { intent: "success", title: `Started conversation with ${name}`, description: null, id: DM_TOAST_ID },
			}),
		}),
		FailedCreateDm: ({ title, description }) => ({
			model,
			outMessage: toast("error", title, description, DM_TOAST_ID),
		}),
		SucceededCopyEmail: ({ email }) => ({
			model,
			outMessage: toast("success", "Email copied", `${email} copied to clipboard`),
		}),
		FailedCopyEmail: () => ({
			model,
			outMessage: toast("error", "Failed to copy email", "Please try again"),
		}),
	})
