import type { ApiScope } from "@hazel/domain/scopes"

/** The permissions a bot can ask for, as the create and edit bot modals list them. */
export const BOT_SCOPES: ReadonlyArray<{
	readonly id: ApiScope
	readonly label: string
	readonly shortLabel: string
	readonly description: string
}> = [
	{
		id: "messages:read",
		label: "Read Messages",
		shortLabel: "Read",
		description: "Read messages in channels",
	},
	{
		id: "messages:write",
		label: "Send Messages",
		shortLabel: "Write",
		description: "Send and edit messages",
	},
	{
		id: "channels:read",
		label: "Read Channels",
		shortLabel: "Read",
		description: "View channel information",
	},
	{
		id: "channels:write",
		label: "Manage Channels",
		shortLabel: "Manage",
		description: "Create and modify channels",
	},
	{ id: "users:read", label: "Read Users", shortLabel: "Read", description: "View user profiles" },
	{
		id: "message-reactions:write",
		label: "Add Reactions",
		shortLabel: "React",
		description: "React to messages",
	},
]
