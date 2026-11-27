/**
 * The account menu and the org switcher as data (`web-foldkit/src/shell/menus.ts`, now deleted):
 * their entries, and what choosing one asks the app for.
 */
import type { Content } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import type { SwitcherOrg } from "./queries"

/** The pages the menus link to, as the root's hrefs for this organization and user. */
export const ChromeHrefs = Schema.Struct({
	profile: Schema.String,
	mySettings: Schema.String,
	manageMembers: Schema.String,
	serverSettings: Schema.String,
	customEmojis: Schema.String,
	integrations: Schema.String,
})
export type ChromeHrefs = typeof ChromeHrefs.Type

/** What a choice asks for: a page, one of the host's modals, signing out, or another organization. */
export type MenuChoice =
	| { readonly _tag: "Link"; readonly href: string }
	| { readonly _tag: "Modal"; readonly modal: string }
	| { readonly _tag: "SignOut" }
	| { readonly _tag: "Organization"; readonly org: SwitcherOrg }
	| { readonly _tag: "None" }

const ACCOUNT_LINKS = { profile: "profile", "my-settings": "mySettings" } as const
const SWITCHER_LINKS = {
	"manage-members": "manageMembers",
	"server-settings": "serverSettings",
	"custom-emojis": "customEmojis",
	integrations: "integrations",
} as const
const MODALS = {
	status: "SetStatus",
	feedback: "Feedback",
	"invite-people": "EmailInvite",
	"create-channel": "NewChannel",
	"create-category": "CreateSection",
	"create-server": "CreateOrganization",
} as const

export const accountEntries = (status: string | null): Content.MenuGroups => [
	{
		entries: [
			{ id: "profile", label: "Profile", icon: "profiles" },
			{ id: "status", label: status === null ? "Set status" : `Set status ${status}`, icon: "emoji" },
			{ id: "my-settings", label: "Account settings", icon: "gear" },
		],
	},
	{ entries: [{ id: "feedback", label: "Feedback", icon: "support" }] },
	{ entries: [{ id: "logout", label: "Log out", icon: "logout" }] },
]

/** Chat routes get the full menu, settings a shorter one; a phone only switches organizations. */
export const switcherEntries = (options: {
	readonly organizationId: string
	readonly orgs: ReadonlyArray<SwitcherOrg>
	readonly compact: boolean
	readonly isChat: boolean
	readonly canCreateChannel: boolean
}): Content.MenuGroups => {
	// A phone checks the shown organization; the desktop submenu marks none.
	const orgEntries = options.orgs.map((org) => ({
		id: org.id,
		label: org.name,
		checked: options.compact && org.id === options.organizationId,
	}))
	if (options.compact)
		return [
			{ entries: orgEntries },
			{ entries: [{ id: "create-server", label: "Create server", icon: "plus" }] },
		]
	const people = {
		entries: [
			{ id: "invite-people", label: "Invite people", icon: "user-plus" },
			{ id: "manage-members", label: "Manage members", icon: "users" },
			{
				id: "switch-server",
				label: "Switch server",
				icon: "servers",
				entries: [...orgEntries, { id: "create-server", label: "Create server", icon: "plus" }],
			},
		],
	} satisfies Content.MenuGroups[number]
	const settings = { id: "server-settings", label: "Workspace settings", icon: "gear" } as const
	if (!options.isChat) return [people, { entries: [settings] }]
	return [
		people,
		{
			entries: [
				...(options.canCreateChannel
					? [{ id: "create-channel", label: "Create channel", icon: "plus-circle" } as const]
					: []),
				{ id: "create-category", label: "Create section", icon: "folder-plus" },
			],
		},
		{
			entries: [
				settings,
				{ id: "custom-emojis", label: "Custom emojis", icon: "emoji" },
				{ id: "integrations", label: "Integrations", icon: "integration" },
			],
		},
	]
}

/** What a chosen entry means; an organization is chosen by its id, and the shown one does nothing. */
export const choiceOf = (
	id: string,
	context: {
		readonly hrefs: ChromeHrefs
		readonly orgs: ReadonlyArray<SwitcherOrg>
		readonly organizationId: string
	},
): MenuChoice => {
	if (id === "logout") return { _tag: "SignOut" }
	if (id in MODALS) return { _tag: "Modal", modal: MODALS[id as keyof typeof MODALS] }
	const link =
		ACCOUNT_LINKS[id as keyof typeof ACCOUNT_LINKS] ?? SWITCHER_LINKS[id as keyof typeof SWITCHER_LINKS]
	if (link !== undefined) return { _tag: "Link", href: context.hrefs[link] }
	const org = context.orgs.find((candidate) => candidate.id === id)
	return org === undefined || org.id === context.organizationId
		? { _tag: "None" }
		: { _tag: "Organization", org }
}

/** Two letters for an avatar without a picture. */
export const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.filter((part) => part !== "")
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("")
