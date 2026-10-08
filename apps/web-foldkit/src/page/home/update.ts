import { Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import * as Menu from "../../ui/menu"
import type { PageReturn, Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import { CopyEmail, CreateDm, FocusSearch } from "./commands"
import { findExistingDmChannel } from "./dm"
import { Message } from "./message"
import { type DirectoryMember, DmRequest, type DmRow, menuEntries, menuIdOf, type Model } from "./model"

type Return = PageReturn<Model, Message>

export const init = (): Return => ({
	model: {
		members: null,
		dmRows: null,
		dmRequest: DmRequest.Idle(),
		searchQuery: "",
		menus: {},
		interaction: Interaction.init(),
	},
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

const withDmRequest = (model: Model, dmRequest: DmRequest): Model =>
	modifyFields(model, { dmRequest: () => dmRequest })

/** `handleOpenChat`: reuse an existing DM with the member, or create one. */
const openDm = (model: Model, shared: Shared, member: DirectoryMember, rows: ReadonlyArray<DmRow>): Return => {
	const organizationId = shared.organization?.id
	const currentUserId = shared.currentUser?.id
	if (!organizationId || !currentUserId) return { model: withDmRequest(model, DmRequest.Idle()) }
	const existing = findExistingDmChannel(rows, currentUserId, [member.id], organizationId)
	if (existing !== null)
		return { model: withDmRequest(model, DmRequest.Idle()), outMessage: navigateToChannel(shared, existing) }
	const name = `${member.firstName} ${member.lastName}`.trim()
	return {
		model: withDmRequest(model, DmRequest.Creating({ userId: member.id })),
		commands: [CreateDm({ organizationId, userId: member.id, name })],
		outMessage: toast("loading", `Starting conversation with ${name}...`, null, DM_TOAST_ID),
	}
}

/** A press while a DM is opening is ignored; before the DM rows load, the request waits for them. */
const requestDm = (model: Model, shared: Shared, member: DirectoryMember): Return => {
	if (model.dmRequest._tag !== "Idle" || !shared.organization || !shared.currentUser) return { model }
	const awaiting = withDmRequest(model, DmRequest.AwaitingChannels({ userId: member.id }))
	return model.dmRows === null ? { model: awaiting } : openDm(awaiting, shared, member, model.dmRows)
}

const updateMenu = (
	model: Model,
	shared: Shared,
	member: DirectoryMember,
	message: Menu.Message,
): Return => {
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
	const action: Return = Option.match(selected, {
		onNone: () => ({ model: next }),
		onSome: (key) =>
			key === "message"
				? requestDm(next, shared, member)
				: key === "copy-email"
					? { model: next, commands: [CopyEmail({ email: member.email })] }
					: { model: next },
	})
	return { ...action, commands: [...menuCommands, ...(action.commands ?? [])] }
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
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
				onSome: (member) => requestDm(model, shared, member),
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
		UpdatedDmChannels: ({ rows }) => {
			const next = modifyFields(model, { dmRows: () => rows })
			const { dmRequest } = model
			if (dmRequest._tag !== "AwaitingChannels") return { model: next }
			return Option.match(memberByUserId(model, dmRequest.userId), {
				onNone: () => ({ model: withDmRequest(next, DmRequest.Idle()) }),
				onSome: (member) => openDm(next, shared, member, rows),
			})
		},
		SucceededCreateDm: ({ channelId, name }) => ({
			model: withDmRequest(model, DmRequest.Idle()),
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${shared.orgSlug ?? ""}/chat/${channelId}`,
				replace: false,
				toast: { intent: "success", title: `Started conversation with ${name}`, description: null, id: DM_TOAST_ID },
			}),
		}),
		FailedCreateDm: ({ toast: failure }) => ({
			model: withDmRequest(model, DmRequest.Idle()),
			outMessage: PageOutMessage.RequestedToast({ toast: { ...failure, id: DM_TOAST_ID } }),
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
