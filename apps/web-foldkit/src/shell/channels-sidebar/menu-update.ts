import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import type { RpcActionName } from "@hazel/domain/scopes"
import type { ChannelId } from "@hazel/schema"
import { Array, Match, Option } from "effect"
import { Command, type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { ModalRequest } from "../../overlay/modal"
import { PageOutMessage } from "../../page/out-message"
import { AppRoute } from "../../route"
import type { HazelRpc } from "../../rpc"
import * as Menu from "../../ui/menu"
import { DeleteChannelSection, LeaveChannel, MoveChannelToSection, UpdateChannelMember } from "./actions"
import {
	closedMenu,
	closedRowMenu,
	decodeDmMenuKey,
	decodeRowMenuKey,
	decodeSectionMenuKey,
	type DmMenuKey,
	type RowMenuKey,
	sectionIdOfKey,
	sectionMenuId,
} from "./menus"
import { Message, type Model, OpenMenu, type SectionAction } from "./model"
import type { ChannelEntry, DmChannel } from "./rows"

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

/** Whether `openMenu` is the row menu of `channelId`. */
const isRowMenuOf = (channelId: ChannelId) => (openMenu: OpenMenu) =>
	openMenu._tag === "Row" && openMenu.channelId === channelId

/** Whether `openMenu` is the "+" menu of the section `sectionKey`. */
const isSectionMenuOf = (sectionKey: string) => (openMenu: OpenMenu) =>
	openMenu._tag === "Section" && openMenu.sectionKey === sectionKey

/** The open row menu of `channelId`, or `null` while it is closed. */
export const openRowMenu = (openMenu: Model["openMenu"], channelId: ChannelId): Menu.Model | null =>
	openMenu !== null && isRowMenuOf(channelId)(openMenu) ? openMenu.menu : null

export const rowMenuOf = (model: Model, channelId: ChannelId): Menu.Model =>
	openRowMenu(model.openMenu, channelId) ?? closedRowMenu(channelId)

export const sectionMenuOf = (model: Model, sectionKey: string): Menu.Model =>
	model.openMenu !== null && isSectionMenuOf(sectionKey)(model.openMenu)
		? model.openMenu.menu
		: closedMenu(sectionMenuId(sectionKey))

/** Folds a Menu step; the menu is kept only while open. */
const foldMenu = (
	model: Model,
	target: Readonly<{ is: (openMenu: OpenMenu) => boolean; opened: (menu: Menu.Model) => OpenMenu }>,
	result: Update.ReturnWithOutMessage<Menu.Model, Menu.Message, Menu.OutMessage>,
	toMessage: (message: Menu.Message) => Message,
	onSelect: (model: Model, key: string) => SidebarReturn,
): SidebarReturn => {
	const isOpen = result.model.popup._tag === "Open"
	const next = modifyFields(model, {
		openMenu: (current) =>
			isOpen ? target.opened(result.model) : current !== null && target.is(current) ? null : current,
	})
	const commands = Command.mapMessages(result.commands ?? [], toMessage)
	if (result.outMessage === undefined || result.outMessage._tag !== "SelectedItem")
		return { model: next, commands }
	const selected = onSelect(next, result.outMessage.key)
	return { ...selected, commands: [...commands, ...(selected.commands ?? [])] }
}

const selectedRowKey = (
	model: Model,
	{ channel, member }: ChannelEntry,
	orgSlug: string,
	key: RowMenuKey,
): SidebarReturn =>
	Match.value(key).pipe(
		Match.when("mute", () => ({
			model,
			commands: [
				UpdateChannelMember({ memberId: member.id, field: "isMuted", value: !member.isMuted }),
			],
		})),
		Match.when("favorite", () => ({
			model,
			commands: [
				UpdateChannelMember({ memberId: member.id, field: "isFavorite", value: !member.isFavorite }),
			],
		})),
		Match.when("settings", () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				route: AppRoute.ChannelSettings({ orgSlug, channelId: channel.id }),
				replace: false,
			}),
		})),
		Match.when("delete", () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({
				modal: { _tag: "DeleteChannel", channelId: channel.id, channelName: channel.name },
			}),
		})),
		Match.when("leave", () => ({ model, commands: [LeaveChannel({ memberId: member.id })] })),
		Match.exhaustive,
	)

/** A submenu leaf: "Move to section"; the current section is a no-op, as in legacy. */
const selectedMoveTarget = (model: Model, { channel }: ChannelEntry, key: string): SidebarReturn =>
	Option.match(sectionIdOfKey(key, model.sections), {
		onNone: () => ({ model }),
		onSome: (sectionId) =>
			sectionId === channel.sectionId
				? { model }
				: { model, commands: [MoveChannelToSection({ channelId: channel.id, sectionId })] },
	})

/** A DM row's item: the same member toggles, plus hiding the conversation. */
const selectedDmKey = (model: Model, { currentUser: member }: DmChannel, key: DmMenuKey): SidebarReturn =>
	Match.value(key).pipe(
		Match.when("mute", () => ({
			model,
			commands: [
				UpdateChannelMember({ memberId: member.id, field: "isMuted", value: !member.isMuted }),
			],
		})),
		Match.when("favorite", () => ({
			model,
			commands: [
				UpdateChannelMember({ memberId: member.id, field: "isFavorite", value: !member.isFavorite }),
			],
		})),
		Match.when("hide", () => ({
			model,
			commands: [UpdateChannelMember({ memberId: member.id, field: "isHidden", value: true })],
		})),
		Match.exhaustive,
	)

/** A DM row (favorited or not) opens the DM menu; its keys never reach the channel row's. */
const selectedRowItem =
	(channelId: ChannelId, orgSlug: string) =>
	(model: Model, key: string): SidebarReturn => {
		const dm = model.dmChannels[channelId]
		return dm
			? Option.match(decodeDmMenuKey(key), {
					onNone: () => ({ model }),
					onSome: (dmKey) => selectedDmKey(model, dm, dmKey),
				})
			: selectedChannelItem(channelId, orgSlug)(model, key)
	}

const selectedChannelItem =
	(channelId: ChannelId, orgSlug: string) =>
	(model: Model, key: string): SidebarReturn =>
		Option.match(entryOf(model, channelId), {
			onNone: () => ({ model }),
			onSome: (entry) =>
				Option.match(decodeRowMenuKey(key), {
					onNone: () => selectedMoveTarget(model, entry, key),
					onSome: (rowKey) => selectedRowKey(model, entry, orgSlug, rowKey),
				}),
		})

const deletedSection = (model: Model, sectionKey: string): SidebarReturn =>
	Option.match(
		Array.findFirst(model.sections, (section) => section.id === sectionKey),
		{
			onNone: () => ({ model }),
			onSome: (section) => ({ model, commands: [DeleteChannelSection({ sectionId: section.id })] }),
		},
	)

const selectedSectionItem =
	(sectionKey: string) =>
	(model: Model, key: string): SidebarReturn =>
		Option.match(decodeSectionMenuKey(key), {
			onNone: () => ({ model }),
			onSome: (sectionMenuKey) =>
				Match.value(sectionMenuKey).pipe(
					Match.when("delete-section", () => deletedSection(model, sectionKey)),
					Match.orElse((action) => requestedSectionAction(model, action)),
				),
		})

export const updateRowMenu = (
	model: Model,
	channelId: ChannelId,
	orgSlug: string,
	message: Menu.Message,
): SidebarReturn =>
	foldMenu(
		model,
		{ is: isRowMenuOf(channelId), opened: (menu) => OpenMenu.Row({ channelId, orgSlug, menu }) },
		Menu.update(rowMenuOf(model, channelId), message),
		(child) => Message.GotRowMenuMessage({ channelId, orgSlug, message: child }),
		selectedRowItem(channelId, orgSlug),
	)

export const updateSectionMenu = (model: Model, sectionKey: string, message: Menu.Message): SidebarReturn =>
	foldMenu(
		model,
		{ is: isSectionMenuOf(sectionKey), opened: (menu) => OpenMenu.Section({ sectionKey, menu }) },
		Menu.update(sectionMenuOf(model, sectionKey), message),
		(child) => Message.GotSectionMenuMessage({ sectionId: sectionKey, message: child }),
		selectedSectionItem(sectionKey),
	)
