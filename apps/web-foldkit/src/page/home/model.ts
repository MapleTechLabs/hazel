import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import * as Interaction from "../../ui/aria/interaction"
import * as Menu from "../../ui/menu"

/** One row of the org home member directory (`routes/_app/$orgSlug/index.tsx`). */
export const DirectoryMember = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	role: Schema.Literals(["owner", "admin", "member"]),
	/** The stored presence status; the directory dot shows it raw, without the staleness rule. */
	presenceStatus: Schema.NullOr(Schema.String),
})
export type DirectoryMember = typeof DirectoryMember.Type

/** One channel and member pair of the DM query (`lib/channels.ts`). */
export const DmRow = Schema.Struct({
	channel: Schema.Struct({ id: ChannelId, type: Schema.String, organizationId: OrganizationId }),
	member: Schema.Struct({ userId: UserId }),
})
export type DmRow = typeof DmRow.Type

/** Opening a DM: waiting for the DM rows to load, to reuse an existing DM before creating one. */
export const DmRequest = defineTaggedUnion({
	Idle: {},
	AwaitingChannels: { userId: UserId },
})
export type DmRequest = typeof DmRequest.Type

/** The member directory live query; `Loading` shows the legacy loader. */
export const Members = defineTaggedUnion({
	Loading: {},
	Loaded: { members: Schema.Array(DirectoryMember) },
})
export type Members = typeof Members.Type

/** The DM live query; a Message press before it loads waits in `DmRequest.AwaitingChannels`. */
export const DmChannels = defineTaggedUnion({
	Loading: {},
	Loaded: { rows: Schema.Array(DmRow) },
})
export type DmChannels = typeof DmChannels.Type

export const Model = Schema.Struct({
	members: Members,
	dmChannels: DmChannels,
	dmRequest: DmRequest,
	searchQuery: Schema.String,
	/** One "Member actions" menu per member, keyed by user id. */
	menus: Schema.Record(Schema.String, Menu.Model),
	/** React Aria focus state for the search field (`data-focused`, `data-focus-visible`). */
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const SEARCH_ID = "members-search"
export const menuIdOf = (userId: string) => `member-actions-${userId}`

export const menuEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item("message", { textValue: "Message" }),
	Menu.item("view-profile", { textValue: "View profile" }),
	Menu.item("start-call", { textValue: "Start call" }),
	Menu.item("copy-email", { textValue: "Copy email" }),
]

/** The loaded members, or none while the query loads. */
export const loadedMembers = (model: Model): ReadonlyArray<DirectoryMember> =>
	model.members._tag === "Loaded" ? model.members.members : []

/** `filteredMembers`: case-insensitive match on the full name or the email. */
export const filterMembers = (
	members: ReadonlyArray<DirectoryMember>,
	searchQuery: string,
): ReadonlyArray<DirectoryMember> => {
	if (!searchQuery) return members
	const searchLower = searchQuery.toLowerCase()
	return members.filter((member) => {
		const fullName = `${member.firstName} ${member.lastName}`.toLowerCase()
		return fullName.includes(searchLower) || member.email.toLowerCase().includes(searchLower)
	})
}
