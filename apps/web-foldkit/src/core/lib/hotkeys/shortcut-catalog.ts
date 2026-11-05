import { HOTKEY_DEFINITIONS_BY_ID } from "./hotkey-registry"

/**
 * Every keyboard shortcut, grouped as the Mod+/ dialog lists them: the app's rebindable hotkeys
 * (`hotkey-registry.ts`) and the fixed keys of the composer, the messages and the channel page.
 */

export interface Shortcut {
	readonly label: string
	/** One or more key combos, in `@tanstack/hotkeys` notation (`Mod+Shift+K`). */
	readonly keys: ReadonlyArray<string>
}

export interface ShortcutSection {
	readonly title: string
	readonly shortcuts: ReadonlyArray<Shortcut>
}

const fromRegistry = (id: keyof typeof HOTKEY_DEFINITIONS_BY_ID): Shortcut => ({
	label: HOTKEY_DEFINITIONS_BY_ID[id].label,
	keys: [HOTKEY_DEFINITIONS_BY_ID[id].defaultHotkey],
})

export const SHORTCUT_SECTIONS: ReadonlyArray<ShortcutSection> = [
	{
		title: "Navigation",
		shortcuts: [
			fromRegistry("commandPalette.open"),
			fromRegistry("search.open"),
			fromRegistry("channel.previous"),
			fromRegistry("channel.next"),
			fromRegistry("channel.previousUnread"),
			fromRegistry("channel.nextUnread"),
			fromRegistry("organization.previous"),
			fromRegistry("organization.next"),
			fromRegistry("inbox.open"),
			fromRegistry("sidebar.toggle"),
			fromRegistry("history.back"),
			fromRegistry("history.forward"),
		],
	},
	{
		title: "Channel",
		shortcuts: [
			{ label: "Mark Channel Read", keys: ["Escape"] },
			fromRegistry("organization.markRead"),
			{ label: "Scroll Messages", keys: ["PageUp", "PageDown"] },
			{ label: "Emoji Picker", keys: ["Mod+E"] },
			{ label: "GIF Picker", keys: ["Mod+G"] },
			{ label: "Upload a File", keys: ["Mod+Shift+U"] },
			{ label: "Pinned Messages", keys: ["Mod+P"] },
			fromRegistry("channel.create"),
			fromRegistry("dm.create"),
			fromRegistry("invite.email"),
		],
	},
	{
		title: "Composer",
		shortcuts: [
			{ label: "Send", keys: ["Enter"] },
			{ label: "New Line", keys: ["Shift+Enter"] },
			{ label: "Edit Your Last Message", keys: ["ArrowUp"] },
			{ label: "Cancel Edit or Reply", keys: ["Escape"] },
			{ label: "Bold, Italic, Underline", keys: ["Mod+B", "Mod+I", "Mod+U"] },
			{ label: "Strikethrough", keys: ["Mod+Shift+X"] },
			{ label: "Go to the Messages", keys: ["Shift+Tab"] },
		],
	},
	{
		title: "Focused Message",
		shortcuts: [
			{ label: "Previous / Next Message", keys: ["ArrowUp", "ArrowDown"] },
			{ label: "Edit", keys: ["E"] },
			{ label: "Reply", keys: ["R"] },
			{ label: "Start a Thread", keys: ["T"] },
			{ label: "Pin or Unpin", keys: ["P"] },
			{ label: "Add a Reaction", keys: ["+"] },
			{ label: "Copy Text", keys: ["Mod+C"] },
			{ label: "Delete", keys: ["Delete"] },
			{ label: "Delete Without Confirming", keys: ["Shift+Delete"] },
			{ label: "Back to the Composer", keys: ["Escape"] },
		],
	},
	{ title: "Help", shortcuts: [fromRegistry("shortcuts.open")] },
]
