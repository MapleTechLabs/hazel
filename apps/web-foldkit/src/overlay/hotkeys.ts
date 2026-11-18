import { Schema } from "effect"
import { Dom } from "foldkit"
import { type AppKeys, appKeymap } from "~/lib/keybindings/app-keymap"
import { KeyCombo } from "~/lib/keybindings/key-combo"

/**
 * The org layout's hotkeys, on the user's keys (`Shared.keys`). Mod combos fire while typing, except
 * the inbox's, which shares Mod+I with italic in the composer.
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

/** The `appKeymap` actions the org layout binds. */
export const LayoutHotkeyActionId = Schema.Literals(LAYOUT_ACTIONS)
export type LayoutHotkeyActionId = typeof LayoutHotkeyActionId.Type

/** The layout actions' keys: a subscription dependency, so a rebinding restarts the bindings. */
export const LayoutKeys = Schema.Struct(
	Object.fromEntries(LAYOUT_ACTIONS.map((id) => [id, Schema.NullOr(KeyCombo)])) as {
		readonly [K in LayoutHotkeyActionId]: Schema.NullOr<typeof KeyCombo>
	},
)
export type LayoutKeys = typeof LayoutKeys.Type

export const layoutKeysOf = (keys: AppKeys): LayoutKeys =>
	Object.fromEntries(LAYOUT_ACTIONS.map((id) => [id, keys[id]])) as LayoutKeys

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

/**
 * Actions that act on the whole app, off while a modal or the command palette holds the keyboard:
 * behind a dialog, Shift+Escape would mark everything read and Mod+/ replace the dialog.
 */
const NOT_UNDER_OVERLAY: ReadonlySet<LayoutHotkeyActionId> = new Set([
	"organization.markRead",
	"shortcuts.open",
	"history.back",
	"history.forward",
	"sidebar.toggle",
	"inbox.open",
])

/** Formatting keys in the composer and other rich fields (Mod+I italic): only bound outside them. */
const NOT_WHILE_TYPING: ReadonlySet<LayoutHotkeyActionId> = new Set(["inbox.open"])

export const layoutHotkeys = <Message>(
	toMessage: (actionId: LayoutHotkeyActionId) => Message,
	keys: LayoutKeys,
	options: {
		/** On a chat page, with no modal or palette open. */
		readonly isChannelNavigationEnabled: boolean
		/** A modal or the command palette is open. */
		readonly isOverlayOpen: boolean
	} = { isChannelNavigationEnabled: true, isOverlayOpen: false },
) =>
	Dom.streamFromKeyBindings<Message>({
		bindings: appKeymap.bindings(keys, LAYOUT_ACTIONS, (actionId) => ({
			whileTyping: NOT_WHILE_TYPING.has(actionId) ? "Suppress" : "Allow",
			isEnabled:
				(!CHANNEL_NAVIGATION.has(actionId) || options.isChannelNavigationEnabled) &&
				(!NOT_UNDER_OVERLAY.has(actionId) || !options.isOverlayOpen),
			mapEvent: () => toMessage(actionId),
		})),
	})
