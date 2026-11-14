/**
 * What a message's push says (`../user/push.ts`), worked out by the channel's `OrgObject`, which
 * knows the channel names, the org slug and the members' names (its `users` projection):
 *
 * - title: `Ada Lovelace · #general`; a 1:1 DM just `Ada Lovelace`; a group DM
 *   `Ada Lovelace · <its name>`; a thread `Ada Lovelace · thread in #general`.
 * - body: the message as plain text (mentions as `@Name`), at most `PUSH_BODY_MAX` characters;
 *   `Sent an attachment` for a message with only attachments.
 * - path: `/<orgSlug>/chat/<channelId>` (a thread is a channel with its own route).
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import type { PushContent } from "../user/push"

export const PUSH_BODY_MAX = 180

/** Mentioned users whose names are looked up (Durable Object SQLite binds at most 100 parameters). */
const MAX_NAMED_USERS = 50

type ChannelType = schema.Channel["type"]

interface ChannelInfo {
	readonly type: ChannelType
	readonly name: string
}

export const displayNameOf = (user: { readonly firstName: string; readonly lastName: string } | undefined) =>
	user === undefined ? "Someone" : `${user.firstName} ${user.lastName}`.trim() || "Someone"

const isConversation = (type: ChannelType) => type === "public" || type === "private"

export const pushTitle = (author: string, channel: ChannelInfo, parent: ChannelInfo | undefined): string => {
	switch (channel.type) {
		case "single":
			return author
		case "direct":
			return channel.name.trim() === "" ? author : `${author} · ${channel.name}`
		case "thread":
			return parent !== undefined && isConversation(parent.type)
				? `${author} · thread in #${parent.name}`
				: `${author} · thread`
		case "public":
		case "private":
			return `${author} · #${channel.name}`
	}
}

/** Message markup as plain text: mentions named, markdown markers and line breaks dropped. */
export const plainTextOf = (content: string, names: ReadonlyMap<string, string>): string =>
	content
		.replace(/@\[userId:([^\]]+)\]/g, (_, id: string) => `@${names.get(id) ?? "someone"}`)
		.replace(/@\[directive:([^\]]+)\]/g, "@$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/```[a-z0-9-]*/gi, "")
		.replace(/`/g, "")
		.replace(/\*\*|__|~~|\|\|/g, "")
		.replace(/^\s*(>|#{1,6})\s?/gm, "")
		.replace(/\s+/g, " ")
		.trim()

/** At most `max` code points, so an emoji or a surrogate pair is never cut in half. */
const truncate = (text: string, max: number) => {
	const points = Array.from(text)
	return points.length <= max
		? text
		: `${points
				.slice(0, max - 1)
				.join("")
				.trimEnd()}…`
}

export const pushBody = (content: string, attachmentCount: number, names: ReadonlyMap<string, string>) => {
	const text = plainTextOf(content, names)
	if (text !== "") return truncate(text, PUSH_BODY_MAX)
	return attachmentCount > 0 ? "Sent an attachment" : "Sent a message"
}

export const pushPath = (orgSlug: string | null, channelId: ChannelId) =>
	orgSlug === null || orgSlug === "" ? undefined : `/${orgSlug}/chat/${channelId}`

/** The push for a message in `channelId` (a channel of this org), from what the org holds. */
export const loadPushContent = Effect.fn("OrgObject.pushContent")(function* (input: {
	readonly organizationId: OrganizationId
	readonly channelId: ChannelId
	readonly authorId: UserId
	readonly mentionedUserIds: ReadonlyArray<UserId>
	readonly content: string
	readonly attachmentCount: number
}) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("type", "name", "parentChannelId")
			.where(($) => [$.id.eq(input.channelId)])
			.limit(1),
	)
	if (Option.isNone(channel)) return undefined
	const parent =
		channel.value.parentChannelId === null
			? Option.none()
			: yield* db.first(
					SQLite.from(schema.channelsTable)
						.select("type", "name")
						.where(($) => [$.id.eq(channel.value.parentChannelId!)])
						.limit(1),
				)
	const organization = yield* db.first(
		SQLite.from(schema.organizationsTable)
			.select("slug")
			.where(($) => [$.id.eq(input.organizationId)])
			.limit(1),
	)
	const userIds = [...new Set([input.authorId, ...input.mentionedUserIds])].slice(0, MAX_NAMED_USERS)
	const users = yield* db.run(
		SQLite.from(schema.usersTable)
			.select("id", "firstName", "lastName")
			.where(($) => [$.id.in_(...userIds)]),
	)
	const byId = new Map(users.map((user) => [user.id as string, user]))
	const names = new Map(users.map((user) => [user.id as string, displayNameOf(user)]))
	return {
		title: pushTitle(
			displayNameOf(byId.get(input.authorId)),
			channel.value,
			Option.getOrUndefined(parent),
		),
		body: pushBody(input.content, input.attachmentCount, names),
		...Option.match(
			Option.flatMap(organization, (row) => Option.fromNullishOr(pushPath(row.slug, input.channelId))),
			{ onNone: () => ({}), onSome: (path) => ({ path }) },
		),
	} satisfies PushContent
})
