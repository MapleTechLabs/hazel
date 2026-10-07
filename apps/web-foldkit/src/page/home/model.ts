import { UserId } from "@hazel/schema"
import { Schema } from "effect"
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

export const Model = Schema.Struct({
	/** `null` until the live query is ready (the legacy loader). */
	members: Schema.NullOr(Schema.Array(DirectoryMember)),
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
	Menu.item("message"),
	Menu.item("view-profile"),
	Menu.item("start-call"),
	Menu.item("copy-email"),
]

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
