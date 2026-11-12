import { Schema } from "effect"
import { Dom } from "foldkit"
import { type AppKeys, appKeymap } from "~/lib/keybindings/app-keymap"
import { KeyCombo } from "~/lib/keybindings/key-combo"

/**
 * Discord's channel shortcuts that this page owns, on the user's keys (`Shared.keys`). The Mod combos
 * and the page keys work while typing in the composer: the editor leaves them alone
 * (`editor/behavior.ts`), so they reach the document.
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
	/** Also from the composer and other fields (the Mod combos, the page keys). */
	readonly whileTyping: boolean
	/** Still bound while one of the page's dialogs (a picker, a menu) holds the keyboard. */
	readonly inDialogs: boolean
}

/** Each `appKeymap` action this page binds, and how. */
const CHANNEL_BINDINGS = {
	"channel.emojiPicker": { action: "EmojiPicker", whileTyping: true, inDialogs: true },
	"channel.gifPicker": { action: "GifPicker", whileTyping: true, inDialogs: true },
	"channel.upload": { action: "Upload", whileTyping: true, inDialogs: false },
	"channel.pins": { action: "Pins", whileTyping: true, inDialogs: true },
	"channel.scrollUp": { action: "ScrollUp", whileTyping: true, inDialogs: false },
	"channel.scrollDown": { action: "ScrollDown", whileTyping: true, inDialogs: false },
	// Escape in the composer reaches the draft first; with nothing to cancel it marks read there.
	"channel.markRead": { action: "MarkRead", whileTyping: false, inDialogs: false },
} as const satisfies Record<string, ChannelBinding>

type ChannelActionId = keyof typeof CHANNEL_BINDINGS
const CHANNEL_ACTIONS = Object.keys(CHANNEL_BINDINGS) as ReadonlyArray<ChannelActionId>

/** The page's keys: a subscription dependency, so a rebinding restarts the bindings. */
export const ChannelKeys = Schema.Struct(
	Object.fromEntries(CHANNEL_ACTIONS.map((id) => [id, Schema.NullOr(KeyCombo)])) as {
		readonly [K in ChannelActionId]: Schema.NullOr<typeof KeyCombo>
	},
)
export type ChannelKeys = typeof ChannelKeys.Type

export const channelKeysOf = (keys: AppKeys): ChannelKeys =>
	Object.fromEntries(CHANNEL_ACTIONS.map((id) => [id, keys[id]])) as ChannelKeys

export const channelHotkeysStream = <Message>(
	toMessage: (action: ChannelHotkey) => Message,
	options: { readonly isDialogOpen: boolean; readonly keys?: ChannelKeys },
) =>
	Dom.streamFromKeyBindings<Message>({
		bindings: appKeymap.bindings(
			options.keys ?? channelKeysOf(appKeymap.defaults),
			CHANNEL_ACTIONS,
			(id) => {
				const { action, whileTyping, inDialogs } = CHANNEL_BINDINGS[id]
				return {
					whileTyping: whileTyping ? "Allow" : "Suppress",
					isEnabled: inDialogs || !options.isDialogOpen,
					// Escape is only noticed: whatever else listens for it still gets it.
					preventDefault: action !== "MarkRead",
					mapEvent: () => toMessage(action),
				}
			},
		),
	})
