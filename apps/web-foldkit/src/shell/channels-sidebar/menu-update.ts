import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import type { RpcActionName } from "@hazel/domain/scopes"
import type { ChannelId } from "@hazel/schema"
import { Array, Option } from "effect"
import { Command, type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { ModalRequest } from "../../overlay/modal"
import { PageOutMessage } from "../../page/out-message"
import type { HazelRpc } from "../../rpc"
import * as Menu from "../../ui/menu"
import { DeleteChannelSection, LeaveChannel, MoveChannelToSection, UpdateChannelMember } from "./actions"
import {
	closedMenu,
	rowMenuEntries,
	rowMenuId,
	sectionIdOfKey,
	sectionMenuEntries,
	sectionMenuId,
} from "./menus"
import { Message, type Model, type SectionAction } from "./model"
import type { ChannelEntry } from "./rows"

/** Opening, folding and acting on the row and section menus. */

export type SidebarReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>

export const canOn = (model: Model, action: RpcActionName) =>
	model.membership !== null && canPerform(RPC_SCOPE_MAP, model.membership.role, action)

/** `SectionGroup`'s actions: DMs start a conversation; channel sections create (if allowed) and join. */
export const sectionActionsOf = (
	model: Model,
	sectionKey: string,
): { readonly actions: ReadonlyArray<SectionAction>; readonly isEditable: boolean } =>
	sectionKey === "dms"
		? { actions: ["create-dm"], isEditable: false }
		: {
				actions: [
					...(canOn(model, "channel.create") ? ["create-channel" as const] : []),
					"join-channel",
				],
				isEditable: sectionKey !== "default",
			}

const sectionModals: Readonly<Record<SectionAction, ModalRequest>> = {
	"create-channel": { _tag: "NewChannel" },
	"join-channel": { _tag: "JoinChannel" },
	"create-dm": { _tag: "CreateDm" },
}

export const requestedSectionAction = (model: Model, action: SectionAction): SidebarReturn => ({
	model,
	outMessage: PageOutMessage.RequestedModal({ modal: sectionModals[action] }),
})

const entryOf = (model: Model, channelId: ChannelId): Option.Option<ChannelEntry> =>
	Array.findFirst(
		[...model.favorites, ...Object.values(model.sectionChannels).flat()],
		(entry) => entry.channel.id === channelId,
	)

/** The open menu for `target`, or a closed one built from the current data. */
export const menuFor = (model: Model, target: string, build: () => Menu.Model): Menu.Model =>
	model.openMenu !== null && model.openMenu.target === target ? model.openMenu.menu : build()

export const rowMenuOf = (model: Model, channelId: ChannelId) =>
	menuFor(model, `channel:${channelId}`, () =>
		closedMenu(
			rowMenuId(channelId),
			rowMenuEntries(model.sections, canOn(model, "channel.delete")),
			"right top",
		),
	)

export const sectionMenuOf = (model: Model, sectionKey: string) =>
	menuFor(model, `section:${sectionKey}`, () => {
		const { actions, isEditable } = sectionActionsOf(model, sectionKey)
		return closedMenu(sectionMenuId(sectionKey), sectionMenuEntries(actions, isEditable))
	})

/** Folds a Menu step; the menu is kept only while open. */
const foldMenu = (
	model: Model,
	target: string,
	orgSlug: string,
	result: Update.ReturnWithOutMessage<Menu.Model, Menu.Message, Menu.OutMessage>,
	toMessage: (message: Menu.Message) => Message,
	onSelect: (model: Model, key: string) => SidebarReturn,
): SidebarReturn => {
	const isOpen = result.model.popup._tag === "Open"
	const next = modifyFields(model, {
		openMenu: (current) =>
			isOpen
				? { target, orgSlug, menu: result.model }
				: current !== null && current.target === target
					? null
					: current,
	})
	const commands = Command.mapMessages(result.commands ?? [], toMessage)
	if (result.outMessage === undefined || result.outMessage._tag !== "SelectedItem")
		return { model: next, commands }
	const selected = onSelect(next, result.outMessage.key)
	return { ...selected, commands: [...commands, ...(selected.commands ?? [])] }
}

const selectedRowItem =
	(channelId: ChannelId, orgSlug: string) =>
	(model: Model, key: string): SidebarReturn =>
		Option.match(entryOf(model, channelId), {
			onNone: () => ({ model }),
			onSome: ({ channel, member }) => {
				if (key === "mute")
					return {
						model,
						commands: [
							UpdateChannelMember({
								memberId: member.id,
								field: "isMuted",
								value: !member.isMuted,
								successTitle: member.isMuted ? "Channel unmuted" : "Channel muted",
							}),
						],
					}
				if (key === "favorite")
					return {
						model,
						commands: [
							UpdateChannelMember({
								memberId: member.id,
								field: "isFavorite",
								value: !member.isFavorite,
								successTitle: member.isFavorite
									? "Removed from favorites"
									: "Added to favorites",
							}),
						],
					}
				if (key === "settings")
					return {
						model,
						outMessage: PageOutMessage.RequestedNavigation({
							href: `/${orgSlug}/channels/${channel.id}/settings`,
							replace: false,
						}),
					}
				if (key === "delete")
					return {
						model,
						outMessage: PageOutMessage.RequestedModal({
							modal: {
								_tag: "DeleteChannel",
								channelId: channel.id,
								channelName: channel.name,
							},
						}),
					}
				if (key === "leave") return { model, commands: [LeaveChannel({ memberId: member.id })] }
				// A submenu leaf: "Move to section"; the current section is a no-op, as in legacy.
				return Option.match(sectionIdOfKey(key, model.sections), {
					onNone: () => ({ model }),
					onSome: (sectionId) =>
						sectionId === channel.sectionId
							? { model }
							: {
									model,
									commands: [MoveChannelToSection({ channelId: channel.id, sectionId })],
								},
				})
			},
		})

const selectedSectionItem =
	(sectionKey: string) =>
	(model: Model, key: string): SidebarReturn => {
		if (key === "delete-section")
			return Option.match(
				Array.findFirst(model.sections, (section) => section.id === sectionKey),
				{
					onNone: () => ({ model }),
					onSome: (section) => ({
						model,
						commands: [DeleteChannelSection({ sectionId: section.id })],
					}),
				},
			)
		return key === "create-channel" || key === "join-channel" || key === "create-dm"
			? requestedSectionAction(model, key)
			: { model }
	}

export const updateRowMenu = (
	model: Model,
	channelId: ChannelId,
	orgSlug: string,
	message: Menu.Message,
): SidebarReturn =>
	foldMenu(
		model,
		`channel:${channelId}`,
		orgSlug,
		Menu.update(rowMenuOf(model, channelId), message),
		(child) => Message.GotRowMenuMessage({ channelId, orgSlug, message: child }),
		selectedRowItem(channelId, orgSlug),
	)

export const updateSectionMenu = (model: Model, sectionKey: string, message: Menu.Message): SidebarReturn =>
	foldMenu(
		model,
		`section:${sectionKey}`,
		"",
		Menu.update(sectionMenuOf(model, sectionKey), message),
		(child) => Message.GotSectionMenuMessage({ sectionKey, message: child }),
		selectedSectionItem(sectionKey),
	)
