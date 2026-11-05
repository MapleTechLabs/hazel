import { Schema } from "effect"
import { Dom } from "foldkit"
import { HOTKEY_DEFINITIONS_BY_ID } from "~/lib/hotkeys/hotkey-registry"

/**
 * The org layout's `useAppHotkey` bindings, fed from the legacy registry's default hotkeys.
 * User overrides (`hotkey-atoms`) are not read yet. Mod combos fire while typing, as in legacy,
 * except Mod+I, which is also italic in the composer.
 */
const LAYOUT_ACTIONS = [
	"commandPalette.open",
	"search.open",
	"channel.create",
	"dm.create",
	"invite.email",
	"channel.previous",
	"channel.next",
	"channel.previousUnread",
	"channel.nextUnread",
	"mention.previous",
	"mention.next",
	"organization.previous",
	"organization.next",
	"organization.markRead",
	"inbox.open",
	"shortcuts.open",
	"sidebar.toggle",
	"history.back",
	"history.forward",
] as const

/** The `AppHotkeyActionId`s the org layout binds. */
export const LayoutHotkeyActionId = Schema.Literals(LAYOUT_ACTIONS)
export type LayoutHotkeyActionId = typeof LayoutHotkeyActionId.Type

/**
 * Discord's Alt+ArrowUp/Down (Shift: unread, Mod+Shift: mentions): on chat pages, where the only text
 * field is the composer, so caret moves in other forms keep their keys.
 */
const CHANNEL_NAVIGATION: ReadonlySet<LayoutHotkeyActionId> = new Set([
	"channel.previous",
	"channel.next",
	"channel.previousUnread",
	"channel.nextUnread",
	"mention.previous",
	"mention.next",
])

/** Formatting keys in the composer and other rich fields (Mod+I italic): only bound outside them. */
const NOT_WHILE_TYPING: ReadonlySet<LayoutHotkeyActionId> = new Set(["inbox.open"])

export const layoutHotkeys = <Message>(
	toMessage: (actionId: LayoutHotkeyActionId) => Message,
	options: { readonly isChannelNavigationEnabled: boolean } = { isChannelNavigationEnabled: true },
) =>
	Dom.streamFromKeyBindings<Message>({
		bindings: LAYOUT_ACTIONS.map((actionId) => ({
			keys: HOTKEY_DEFINITIONS_BY_ID[actionId].defaultHotkey,
			whileTyping: NOT_WHILE_TYPING.has(actionId) ? ("Suppress" as const) : ("Allow" as const),
			isEnabled: !CHANNEL_NAVIGATION.has(actionId) || options.isChannelNavigationEnabled,
			mapEvent: () => toMessage(actionId),
		})),
	})
