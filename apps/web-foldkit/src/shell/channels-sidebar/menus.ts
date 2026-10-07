import type { ChannelSectionId } from "@hazel/schema"
import { Array, Option } from "effect"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import {
	IconCirclePlus,
	IconDots,
	IconFolderPlus,
	IconGear,
	IconHashtag,
	IconLeave,
	IconPlus,
	IconStar,
	IconTrash,
	IconVolume,
	IconVolumeMute,
} from "../../icons"
import { button } from "../../ui/button"
import * as Menu from "../../ui/menu"
import { menuLabel, view as menuView } from "../../ui/menu-view"
import type { SectionAction } from "./model"
import type { ChannelEntry, Section } from "./rows"

/** The channel row "dots" menu (`ChannelItem`) and the section "+" menu (`SectionGroup`). */

export const rowMenuId = (channelId: string) => `channel-menu-${channelId}`
export const sectionMenuId = (sectionKey: string) => `section-menu-${sectionKey}`

const DEFAULT_SECTION_KEY = "section:default"
const sectionKeyOf = (sectionId: string | null) =>
	sectionId === null ? DEFAULT_SECTION_KEY : `section:${sectionId}`

// ENTRIES

export const rowMenuEntries = (
	sections: ReadonlyArray<Section>,
	canDelete: boolean,
): ReadonlyArray<Menu.Entry> => [
	Menu.item("mute"),
	Menu.item("favorite"),
	...(sections.length > 0
		? [
				Menu.item("move", {
					submenu: [
						Menu.leaf(DEFAULT_SECTION_KEY, { textValue: "Channels (Default)" }),
						...sections.map((section) =>
							Menu.leaf(sectionKeyOf(section.id), { textValue: section.name }),
						),
					],
				}),
			]
		: []),
	Menu.separator,
	Menu.item("settings"),
	...(canDelete ? [Menu.item("delete", { intent: "Danger" })] : []),
	Menu.separator,
	Menu.item("leave", { intent: "Danger" }),
]

/** The move target a submenu key names: `null` for the default section. */
export const sectionIdOfKey = (
	key: string,
	sections: ReadonlyArray<Section>,
): Option.Option<ChannelSectionId | null> =>
	key === DEFAULT_SECTION_KEY
		? Option.some(null)
		: Option.map(
				Array.findFirst(sections, (section) => sectionKeyOf(section.id) === key),
				(section) => section.id,
			)

/** `menuActions` plus "Delete section" for editable sections. */
export const sectionMenuEntries = (
	actions: ReadonlyArray<SectionAction>,
	isEditable: boolean,
): ReadonlyArray<Menu.Entry> => [
	...actions.map((action) => Menu.item(action)),
	...(isEditable ? [Menu.separator, Menu.item("delete-section", { intent: "Danger" })] : []),
]

export const closedMenu = (id: string, entries: ReadonlyArray<Menu.Entry>, placement?: "right top") =>
	Menu.init({ id, entries, ...(placement ? { placement } : {}) })

// VIEW

const rowMenuContent =
	<M>(h: HtmlBuilder<M>, entry: ChannelEntry, sections: ReadonlyArray<Section>) =>
	(key: string): ReadonlyArray<Html | string> => {
		const id = rowMenuId(entry.channel.id)
		const text = (value: string, className?: string) => menuLabel(h, id, key, value, className)
		const { member } = entry
		if (key === "mute")
			return [
				member.isMuted
					? IconVolume(h, { className: "size-4" })
					: IconVolumeMute(h, { className: "size-4" }),
				text(member.isMuted ? "Unmute" : "Mute"),
			]
		if (key === "favorite")
			return [
				IconStar(h, {
					className: member.isFavorite ? "size-4 text-favorite" : "size-4 text-muted-fg",
				}),
				text(member.isFavorite ? "Unfavorite" : "Favorite"),
			]
		if (key === "move") return [IconFolderPlus(h, { className: "size-4" }), text("Move to section")]
		if (key === "settings") return [IconGear(h), text("Settings")]
		if (key === "delete") return [IconTrash(h), text("Delete")]
		if (key === "leave") return [IconLeave(h), text("Leave", "text-destructive")]
		if (key === DEFAULT_SECTION_KEY) return [text("Channels (Default)")]
		const section = sections.find((candidate) => sectionKeyOf(candidate.id) === key)
		return section ? [text(section.name)] : []
	}

/** `ChannelItem`'s `<Menu>`: the dots trigger and `MenuContent placement="right top" className="w-42"`. */
export const rowMenuView = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		menu: Menu.Model
		entry: ChannelEntry
		sections: ReadonlyArray<Section>
		toMessage: (message: Menu.Message) => M
	}>,
): Html =>
	h.submodel({
		slotId: options.menu.id,
		model: options.menu,
		view: menuView,
		viewInputs: {
			toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
				button(
					h,
					{
						intent: "plain",
						size: "sq-xs",
						className: "size-5 text-muted-fg",
						attributes: [h.Attribute("data-slot", "menu-trigger"), ...attributes],
					},
					[IconDots(h, { className: "size-4" }), overlay],
				),
			content: rowMenuContent(h, options.entry, options.sections),
			className: "w-42",
			itemClassName: (key) =>
				key === sectionKeyOf(options.entry.channel.sectionId) ? "bg-accent" : undefined,
		},
		toParentMessage: options.toMessage,
	})

const sectionMenuContent =
	<M>(h: HtmlBuilder<M>, id: string) =>
	(key: string): ReadonlyArray<Html | string> => {
		const text = (value: string) => menuLabel(h, id, key, value)
		if (key === "create-channel") return [IconCirclePlus(h), text("Create new channel")]
		if (key === "join-channel") return [IconHashtag(h), text("Join existing channel")]
		if (key === "create-dm") return [IconPlus(h), text("Start a conversation")]
		if (key === "delete-section") return [IconTrash(h), text("Delete section")]
		return []
	}

/** `SectionGroup`'s "+" `<Menu>` (several actions or a deletable section). */
export const sectionMenuView = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ menu: Menu.Model; toMessage: (message: Menu.Message) => M }>,
): Html =>
	h.submodel({
		slotId: options.menu.id,
		model: options.menu,
		view: menuView,
		viewInputs: {
			toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
				button(h, { intent: "plain", isCircle: true, size: "sq-xs", attributes: [...attributes] }, [
					IconPlus(h),
					overlay,
				]),
			content: sectionMenuContent(h, options.menu.id),
		},
		toParentMessage: options.toMessage,
	})
