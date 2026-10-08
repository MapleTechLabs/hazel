import { Schema } from "effect"
import { Dom } from "foldkit"
import { HOTKEY_DEFINITIONS_BY_ID } from "~/lib/hotkeys/hotkey-registry"

/**
 * The org layout's `useAppHotkey` bindings, fed from the legacy registry's default hotkeys.
 * User overrides (`hotkey-atoms`) are not read yet. Mod combos fire while typing, as in legacy.
 */
const LAYOUT_ACTIONS = [
	"commandPalette.open",
	"search.open",
	"channel.create",
	"dm.create",
	"invite.email",
] as const

/** The `AppHotkeyActionId`s the org layout binds. */
export const LayoutHotkeyActionId = Schema.Literals(LAYOUT_ACTIONS)
export type LayoutHotkeyActionId = typeof LayoutHotkeyActionId.Type

export const layoutHotkeys = <Message>(toMessage: (actionId: LayoutHotkeyActionId) => Message) =>
	Dom.streamFromKeyBindings<Message>({
		bindings: LAYOUT_ACTIONS.map((actionId) => ({
			keys: HOTKEY_DEFINITIONS_BY_ID[actionId].defaultHotkey,
			whileTyping: "Allow" as const,
			mapEvent: () => toMessage(actionId),
		})),
	})
