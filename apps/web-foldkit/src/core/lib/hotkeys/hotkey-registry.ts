import type { Hotkey } from "@tanstack/hotkeys"

export type AppHotkeyCategory = "global" | "navigation" | "modal"

export interface AppHotkeyDefinition {
	id: string
	category: AppHotkeyCategory
	label: string
	description: string
	defaultHotkey: Hotkey
}

export const HOTKEY_DEFINITIONS = [
	{
		id: "commandPalette.open",
		category: "global",
		label: "Open Command Palette",
		description: "Open the command palette home screen.",
		defaultHotkey: "Mod+K",
	},
	{
		id: "search.open",
		category: "navigation",
		label: "Search Messages",
		description: "Open command palette directly in message search.",
		defaultHotkey: "Mod+Shift+F",
	},
	{
		id: "channel.create",
		category: "navigation",
		label: "Create Channel",
		description: "Open the create channel modal.",
		defaultHotkey: "Mod+Alt+N",
	},
	{
		id: "dm.create",
		category: "navigation",
		label: "Create DM",
		description: "Open the create direct message modal.",
		defaultHotkey: "Mod+Alt+D",
	},
	{
		id: "invite.email",
		category: "navigation",
		label: "Invite People",
		description: "Open the invite people modal.",
		defaultHotkey: "Mod+Alt+I",
	},
	{
		id: "channel.previous",
		category: "navigation",
		label: "Previous Channel",
		description: "Go to the channel above in the sidebar.",
		defaultHotkey: "Alt+ArrowUp",
	},
	{
		id: "channel.next",
		category: "navigation",
		label: "Next Channel",
		description: "Go to the channel below in the sidebar.",
		defaultHotkey: "Alt+ArrowDown",
	},
	{
		id: "channel.previousUnread",
		category: "navigation",
		label: "Previous Unread Channel",
		description: "Go to the nearest unread channel above in the sidebar.",
		defaultHotkey: "Alt+Shift+ArrowUp",
	},
	{
		id: "channel.nextUnread",
		category: "navigation",
		label: "Next Unread Channel",
		description: "Go to the nearest unread channel below in the sidebar.",
		defaultHotkey: "Alt+Shift+ArrowDown",
	},
	{
		id: "mention.previous",
		category: "navigation",
		label: "Previous Unread Mention",
		description: "Go to the nearest channel above with an unread mention.",
		defaultHotkey: "Mod+Alt+Shift+ArrowUp",
	},
	{
		id: "mention.next",
		category: "navigation",
		label: "Next Unread Mention",
		description: "Go to the nearest channel below with an unread mention.",
		defaultHotkey: "Mod+Alt+Shift+ArrowDown",
	},
	{
		id: "organization.previous",
		category: "navigation",
		label: "Previous Organization",
		description: "Switch to the organization above in the organization switcher.",
		defaultHotkey: "Mod+Alt+ArrowUp",
	},
	{
		id: "organization.next",
		category: "navigation",
		label: "Next Organization",
		description: "Switch to the organization below in the organization switcher.",
		defaultHotkey: "Mod+Alt+ArrowDown",
	},
	{
		id: "organization.markRead",
		category: "global",
		label: "Mark Organization Read",
		description: "Mark every channel in this organization as read.",
		defaultHotkey: "Shift+Escape",
	},
	{
		id: "inbox.open",
		category: "navigation",
		label: "Open Inbox",
		description: "Open your notifications.",
		defaultHotkey: "Mod+I",
	},
	{
		id: "shortcuts.open",
		category: "global",
		label: "Keyboard Shortcuts",
		description: "Show every keyboard shortcut.",
		defaultHotkey: "Mod+/",
	},
	{
		id: "sidebar.toggle",
		category: "global",
		label: "Toggle Sidebar",
		description: "Toggle the left sidebar visibility.",
		// Slack's; Mod+B is bold in the composer.
		defaultHotkey: "Mod+Shift+D",
	},
	{
		id: "history.back",
		category: "navigation",
		label: "Go Back",
		description: "Go back to the previous page.",
		defaultHotkey: "Mod+[",
	},
	{
		id: "history.forward",
		category: "navigation",
		label: "Go Forward",
		description: "Go forward to the next page.",
		defaultHotkey: "Mod+]",
	},
	{
		id: "imageViewer.close",
		category: "modal",
		label: "Close Image Viewer",
		description: "Close the image viewer modal.",
		defaultHotkey: "Escape",
	},
	{
		id: "imageViewer.prev",
		category: "modal",
		label: "Previous Image",
		description: "Show the previous image in the viewer.",
		defaultHotkey: "ArrowLeft",
	},
	{
		id: "imageViewer.next",
		category: "modal",
		label: "Next Image",
		description: "Show the next image in the viewer.",
		defaultHotkey: "ArrowRight",
	},
] as const satisfies ReadonlyArray<AppHotkeyDefinition>

export type AppHotkeyActionId = (typeof HOTKEY_DEFINITIONS)[number]["id"]

export const HOTKEY_DEFINITIONS_BY_ID = HOTKEY_DEFINITIONS.reduce(
	(accumulator, definition) => {
		accumulator[definition.id as AppHotkeyActionId] = definition
		return accumulator
	},
	{} as Record<AppHotkeyActionId, (typeof HOTKEY_DEFINITIONS)[number]>,
)

export function isAppHotkeyActionId(value: string): value is AppHotkeyActionId {
	return Object.hasOwn(HOTKEY_DEFINITIONS_BY_ID, value)
}
