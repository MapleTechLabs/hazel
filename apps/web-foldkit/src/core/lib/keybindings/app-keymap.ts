import { defineKeymap } from "./keymap"

/**
 * Every keyboard shortcut in the app. The org layout (`overlay/hotkeys.ts`) and the channel page
 * (`page/chat/channel/hotkeys.ts`) bind the rebindable ones from the user's keys; the composer's and
 * the focused message's keys are fixed (the editor and the message list handle them) and are listed
 * here so the shortcut dialog shows them and a rebinding can warn when it shadows one.
 */
export const KEYMAP_CATEGORIES = ["Navigation", "Actions", "Channel", "Composer", "Message", "Help"] as const
export type KeymapCategory = (typeof KEYMAP_CATEGORIES)[number]

const navigation = "Navigation" satisfies KeymapCategory
const actions = "Actions" satisfies KeymapCategory
const channel = "Channel" satisfies KeymapCategory
const composer = "Composer" satisfies KeymapCategory
const message = "Message" satisfies KeymapCategory
const help = "Help" satisfies KeymapCategory

export const appKeymap = defineKeymap({
	// Navigation
	"commandPalette.open": {
		label: "Open Command Palette",
		description: "Jump to a channel, person or command.",
		category: navigation,
		defaultKey: "Mod+K",
	},
	"search.open": {
		label: "Search Messages",
		description: "Open the command palette in message search.",
		category: navigation,
		defaultKey: "Mod+Shift+F",
	},
	"channel.previous": {
		label: "Previous Channel",
		description: "Go to the channel above in the sidebar.",
		category: navigation,
		defaultKey: "Alt+ArrowUp",
	},
	"channel.next": {
		label: "Next Channel",
		description: "Go to the channel below in the sidebar.",
		category: navigation,
		defaultKey: "Alt+ArrowDown",
	},
	"channel.previousUnread": {
		label: "Previous Unread Channel",
		description: "Go to the nearest unread channel above.",
		category: navigation,
		defaultKey: "Alt+Shift+ArrowUp",
	},
	"channel.nextUnread": {
		label: "Next Unread Channel",
		description: "Go to the nearest unread channel below.",
		category: navigation,
		defaultKey: "Alt+Shift+ArrowDown",
	},
	"mention.previous": {
		label: "Previous Unread Mention",
		description: "Go to the nearest channel above with an unread mention.",
		category: navigation,
		defaultKey: "Mod+Alt+Shift+ArrowUp",
	},
	"mention.next": {
		label: "Next Unread Mention",
		description: "Go to the nearest channel below with an unread mention.",
		category: navigation,
		defaultKey: "Mod+Alt+Shift+ArrowDown",
	},
	"organization.previous": {
		label: "Previous Organization",
		description: "Switch to the organization above.",
		category: navigation,
		defaultKey: "Mod+Alt+ArrowUp",
	},
	"organization.next": {
		label: "Next Organization",
		description: "Switch to the organization below.",
		category: navigation,
		defaultKey: "Mod+Alt+ArrowDown",
	},
	"inbox.open": {
		label: "Open Inbox",
		description: "Open your notifications.",
		category: navigation,
		defaultKey: "Mod+I",
	},
	"sidebar.toggle": {
		label: "Toggle Sidebar",
		description: "Show or hide the left sidebar.",
		category: navigation,
		// Slack's; Mod+B is bold in the composer.
		defaultKey: "Mod+Shift+D",
	},
	"history.back": {
		label: "Go Back",
		description: "Go back to the previous page.",
		category: navigation,
		defaultKey: "Mod+[",
	},
	"history.forward": {
		label: "Go Forward",
		description: "Go forward to the next page.",
		category: navigation,
		defaultKey: "Mod+]",
	},

	// Actions
	"channel.create": {
		label: "Create Channel",
		description: "Open the create channel dialog.",
		category: actions,
		defaultKey: "Mod+Alt+N",
	},
	"dm.create": {
		label: "Create DM",
		description: "Start a direct message.",
		category: actions,
		defaultKey: "Mod+Alt+D",
	},
	"invite.email": {
		label: "Invite People",
		description: "Invite people to this organization.",
		category: actions,
		defaultKey: "Mod+Alt+I",
	},
	"organization.markRead": {
		label: "Mark Organization Read",
		description: "Mark every channel in this organization as read.",
		category: actions,
		defaultKey: "Shift+Escape",
	},

	// Channel
	"channel.markRead": {
		label: "Mark Channel Read",
		description: "Mark the open channel as read.",
		category: channel,
		defaultKey: "Escape",
	},
	"channel.emojiPicker": {
		label: "Emoji Picker",
		description: "Open the emoji picker in the composer.",
		category: channel,
		defaultKey: "Mod+E",
	},
	"channel.gifPicker": {
		label: "GIF Picker",
		description: "Open the GIF picker in the composer.",
		category: channel,
		defaultKey: "Mod+G",
	},
	"channel.upload": {
		label: "Upload a File",
		description: "Choose files to attach.",
		category: channel,
		defaultKey: "Mod+Shift+U",
	},
	"channel.pins": {
		label: "Pinned Messages",
		description: "Show the channel's pinned messages.",
		category: channel,
		defaultKey: "Mod+P",
	},
	"channel.scrollUp": {
		label: "Scroll Up",
		description: "Scroll the messages up a page.",
		category: channel,
		defaultKey: "PageUp",
	},
	"channel.scrollDown": {
		label: "Scroll Down",
		description: "Scroll the messages down a page.",
		category: channel,
		defaultKey: "PageDown",
	},

	// Composer (fixed: the editor's own keys)
	"composer.send": {
		label: "Send",
		description: "Send the message.",
		category: composer,
		defaultKey: "Enter",
		rebindable: false,
	},
	"composer.newLine": {
		label: "New Line",
		description: "Start a new line.",
		category: composer,
		defaultKey: "Shift+Enter",
		rebindable: false,
	},
	"composer.editLast": {
		label: "Edit Your Last Message",
		description: "From an empty composer.",
		category: composer,
		defaultKey: "ArrowUp",
		rebindable: false,
	},
	"composer.cancel": {
		label: "Cancel Edit or Reply",
		description: "Leave the edit or reply.",
		category: composer,
		defaultKey: "Escape",
		rebindable: false,
	},
	"composer.bold": {
		label: "Bold",
		description: "Bold the selection.",
		category: composer,
		defaultKey: "Mod+B",
		rebindable: false,
	},
	"composer.italic": {
		label: "Italic",
		description: "Italicize the selection.",
		category: composer,
		defaultKey: "Mod+I",
		rebindable: false,
	},
	"composer.underline": {
		label: "Underline",
		description: "Underline the selection.",
		category: composer,
		defaultKey: "Mod+U",
		rebindable: false,
	},
	"composer.strikethrough": {
		label: "Strikethrough",
		description: "Strike through the selection.",
		category: composer,
		defaultKey: "Mod+Shift+X",
		rebindable: false,
	},
	"composer.toMessages": {
		label: "Go to the Messages",
		description: "Move focus to the last message.",
		category: composer,
		defaultKey: "Shift+Tab",
		rebindable: false,
	},

	// Focused message (fixed: the message list's keys)
	"message.move": {
		label: "Previous / Next Message",
		description: "Move between messages.",
		category: message,
		defaultKey: "ArrowUp",
		alsoKeys: ["ArrowDown"],
		rebindable: false,
	},
	"message.edit": {
		label: "Edit",
		description: "Edit your message.",
		category: message,
		defaultKey: "E",
		rebindable: false,
	},
	"message.reply": {
		label: "Reply",
		description: "Reply to the message.",
		category: message,
		defaultKey: "R",
		rebindable: false,
	},
	"message.thread": {
		label: "Start a Thread",
		description: "Open a thread on the message.",
		category: message,
		defaultKey: "T",
		rebindable: false,
	},
	"message.pin": {
		label: "Pin or Unpin",
		description: "Pin the message to the channel.",
		category: message,
		defaultKey: "P",
		rebindable: false,
	},
	"message.react": {
		label: "Add a Reaction",
		description: "React to the message.",
		category: message,
		defaultKey: "Plus",
		rebindable: false,
	},
	"message.copy": {
		label: "Copy Text",
		description: "Copy the message's text.",
		category: message,
		defaultKey: "Mod+C",
		rebindable: false,
	},
	"message.delete": {
		label: "Delete",
		description: "Delete the message.",
		category: message,
		defaultKey: "Delete",
		rebindable: false,
	},
	"message.deleteNow": {
		label: "Delete Without Confirming",
		description: "Delete the message right away.",
		category: message,
		defaultKey: "Shift+Delete",
		rebindable: false,
	},
	"message.toComposer": {
		label: "Back to the Composer",
		description: "Return focus to the composer.",
		category: message,
		defaultKey: "Escape",
		rebindable: false,
	},

	// Help
	"shortcuts.open": {
		label: "Keyboard Shortcuts",
		description: "Show every keyboard shortcut.",
		category: help,
		defaultKey: "Mod+/",
	},
})

export type AppActionId = typeof appKeymap.ActionId.Type
export type AppKeys = ReturnType<typeof appKeymap.resolve>
