import { Schema } from "effect"
import { Dom } from "foldkit"

/**
 * Discord's channel shortcuts that this page owns. The Mod combos and the page keys work while typing
 * in the composer: the editor leaves them alone (`editor/behavior.ts`), so they reach the document.
 */

export const ChannelHotkey = Schema.Literals([
	"EmojiPicker",
	"GifPicker",
	"Upload",
	"Pins",
	"ScrollUp",
	"ScrollDown",
	"MarkRead",
])
export type ChannelHotkey = typeof ChannelHotkey.Type

interface ChannelBinding {
	readonly action: ChannelHotkey
	readonly keys: string
	/** Also from the composer and other fields (the Mod combos, the page keys). */
	readonly whileTyping: boolean
	/** Still bound while one of the page's dialogs (a picker, a menu) holds the keyboard. */
	readonly inDialogs: boolean
}

/** Each shortcut's keys, as Discord binds them. */
export const CHANNEL_HOTKEYS: ReadonlyArray<ChannelBinding> = [
	{ action: "EmojiPicker", keys: "Mod+E", whileTyping: true, inDialogs: true },
	{ action: "GifPicker", keys: "Mod+G", whileTyping: true, inDialogs: true },
	{ action: "Upload", keys: "Mod+Shift+U", whileTyping: true, inDialogs: false },
	{ action: "Pins", keys: "Mod+P", whileTyping: true, inDialogs: true },
	{ action: "ScrollUp", keys: "PageUp", whileTyping: true, inDialogs: false },
	{ action: "ScrollDown", keys: "PageDown", whileTyping: true, inDialogs: false },
	// Escape in the composer reaches the draft first; with nothing to cancel it marks read there.
	{ action: "MarkRead", keys: "Escape", whileTyping: false, inDialogs: false },
]

export const channelHotkeysStream = <Message>(
	toMessage: (action: ChannelHotkey) => Message,
	options: { readonly isDialogOpen: boolean },
) =>
	Dom.streamFromKeyBindings<Message>({
		bindings: CHANNEL_HOTKEYS.map(({ action, keys, whileTyping, inDialogs }) => ({
			keys,
			whileTyping: whileTyping ? ("Allow" as const) : ("Suppress" as const),
			isEnabled: inDialogs || !options.isDialogOpen,
			// Escape is only noticed: whatever else listens for it still gets it.
			preventDefault: action !== "MarkRead",
			mapEvent: () => toMessage(action),
		})),
	})
