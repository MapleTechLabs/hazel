import type { ChannelId } from "@hazel/schema"
import { Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { errorToast, successToast } from "../../data/actions"
import type { ToastRequest } from "../../overlay/toasts"
import * as Interaction from "../../ui/aria/interaction"
import { AppRoute } from "../../route"
import * as Menu from "../../ui/menu"
import type { PageReturn, Shared } from "../contract"
import { PageOutMessage, requestedOrgNavigation } from "../out-message"
import { CopyEmail, FocusSearch } from "./commands"
import { findExistingDmChannel } from "./dm"
import { Message } from "./message"
import {
	type DirectoryMember,
	DmChannels,
	DmRequest,
	type DmRow,
	loadedMembers,
	Members,
	menuIdOf,
	type Model,
} from "./model"

type Return = PageReturn<Model, Message>

export const init = (): Return => ({
	model: {
		members: Members.Loading(),
		dmChannels: DmChannels.Loading(),
		dmRequest: DmRequest.Idle(),
		searchQuery: "",
		menus: {},
		interaction: Interaction.init(),
	},
})

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

const navigateToChannel = (shared: Shared, channelId: ChannelId) =>
	requestedOrgNavigation(shared.orgSlug, (orgSlug) => AppRoute.ChatChannel({ orgSlug, channelId }))

/** Keeps each member's menu (and its open state) across live-query updates. */
const reconcileMenus = (model: Model, members: ReadonlyArray<DirectoryMember>): Model["menus"] =>
	Object.fromEntries(
		members.map((member) => [
			member.id,
			model.menus[member.id] ?? Menu.init({ id: menuIdOf(member.id), placement: "bottom end" }),
		]),
	)

const memberByUserId = (model: Model, userId: string) =>
	Option.fromNullishOr(loadedMembers(model).find((member) => member.id === userId))

const withDmRequest = (model: Model, dmRequest: DmRequest): Model =>
	modifyFields(model, { dmRequest: () => dmRequest })

/** `handleOpenChat`: reuse an existing DM with the member, or ask the root to create one. */
const openDm = (
	model: Model,
	shared: Shared,
	member: DirectoryMember,
	rows: ReadonlyArray<DmRow>,
): Return => {
	const idle = withDmRequest(model, DmRequest.Idle())
	const organizationId = shared.organization?.id
	const currentUserId = shared.currentUser?.id
	const { orgSlug } = shared
	if (!organizationId || !currentUserId || orgSlug === null) return { model: idle }
	const existing = findExistingDmChannel(rows, currentUserId, [member.id], organizationId)
	if (existing !== null) return { model: idle, outMessage: navigateToChannel(shared, existing) }
	return {
		model: idle,
		outMessage: PageOutMessage.RequestedDmCreation({
			organizationId,
			orgSlug,
			userId: member.id,
			name: `${member.firstName} ${member.lastName}`.trim(),
		}),
	}
}

/** Before the DM rows load, the request waits for them; a press while one waits is ignored. */
const requestDm = (model: Model, shared: Shared, member: DirectoryMember): Return => {
	if (model.dmRequest._tag !== "Idle" || !shared.organization || !shared.currentUser) return { model }
	const awaiting = withDmRequest(model, DmRequest.AwaitingChannels({ userId: member.id }))
	return DmChannels.match(model.dmChannels, {
		Loading: () => ({ model: awaiting }),
		Loaded: ({ rows }) => openDm(awaiting, shared, member, rows),
	})
}

const updateMenu = (model: Model, shared: Shared, member: DirectoryMember, message: Menu.Message): Return => {
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
				members: () => Members.Loaded({ members }),
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
			const next = modifyFields(model, { dmChannels: () => DmChannels.Loaded({ rows }) })
			const { dmRequest } = model
			if (dmRequest._tag !== "AwaitingChannels") return { model: next }
			return Option.match(memberByUserId(model, dmRequest.userId), {
				onNone: () => ({ model: withDmRequest(next, DmRequest.Idle()) }),
				onSome: (member) => openDm(next, shared, member, rows),
			})
		},
		SucceededCopyEmail: ({ email }) => ({
			model,
			outMessage: toast(successToast("Email copied", `${email} copied to clipboard`)),
		}),
		FailedCopyEmail: () => ({
			model,
			outMessage: toast(errorToast("Failed to copy email", "Please try again")),
		}),
	})
