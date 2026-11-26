// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel list as a shared `hazel` screen over `@hazel/client-data` (G2). The host provides the
 * data instance (`ClientData`) and how a press navigates (`RequestNavigation`); the route comes in as
 * props at mount and as `ChangedRoute` after, since a root's props are fixed once mounted.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { ChannelId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { and, eq, inArray, isNull, not } from "@tanstack/db"
import { Effect, Layer, Schema, Stream } from "effect"

export const Section = Schema.Struct({ id: ChannelSectionId, name: Schema.String })
export type Section = typeof Section.Type

export const ChannelType = Schema.Literals(["public", "private", "direct", "single"])

export const Channel = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: ChannelType,
	sectionId: Schema.NullOr(ChannelSectionId),
	isFavorite: Schema.Boolean,
	unread: Schema.Finite,
})
export type Channel = typeof Channel.Type

export const ChannelListMessage = UiSchema.TaggedEnum({
	UpdatedSections: { sections: Schema.Array(Section) },
	UpdatedChannels: { channels: Schema.Array(Channel) },
	UpdatedDmNames: { names: Schema.Record(Schema.String, Schema.String) },
	ChangedRoute: { activeChannelId: Schema.NullOr(ChannelId) },
	PressedChannel: { id: ChannelId },
	CompletedRequestNavigation: {},
})
export type ChannelListMessage = typeof ChannelListMessage.Type

export const ChannelListProps = Schema.Struct({
	organizationId: OrganizationId,
	userId: UserId,
	orgSlug: Schema.String,
	activeChannelId: Schema.NullOr(ChannelId),
})
export type ChannelListProps = typeof ChannelListProps.Type

/** Asks the host to open a channel; the host owns routing and answers with `ChangedRoute`. */
export class RequestNavigation extends Command.Service<RequestNavigation>()("hazel/RequestNavigation", {
	args: { channelId: ChannelId },
	success: ChannelListMessage,
}) {
	static readonly layerWith = (navigate: (channelId: ChannelId) => void) =>
		this.toLayer(
			Effect.succeed(({ channelId }) =>
				Effect.sync(() => {
					navigate(channelId)
					return ChannelListMessage.CompletedRequestNavigation()
				}),
			),
		)
}

const sectionsStream = (organizationId: OrganizationId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<{ id: ChannelSectionId; name: string }, ChannelListMessage>(
					(q) =>
						q
							.from({ section: data.collections.channelSectionCollection })
							.where(({ section }) =>
								and(eq(section.organizationId, organizationId), isNull(section.deletedAt)),
							)
							.orderBy(({ section }) => section.order, "asc"),
					(rows) =>
						ChannelListMessage.UpdatedSections({
							sections: rows.map((row) => ({ id: row.id, name: row.name })),
						}),
				),
		),
	)

interface ChannelRow {
	readonly channel: {
		readonly id: ChannelId
		readonly name: string
		readonly type: Channel["type"]
		readonly sectionId: ChannelSectionId | null
	}
	readonly member: { readonly isFavorite: boolean; readonly notificationCount: number }
}

/** The user's visible channels and DMs in the org, with the member's unread count. */
const channelsStream = (organizationId: OrganizationId, userId: UserId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<ChannelRow, ChannelListMessage>(
					(q) =>
						q
							.from({ channel: data.collections.channelCollection })
							.innerJoin(
								{ member: data.collections.channelMemberCollection },
								({ channel, member }) => eq(member.channelId, channel.id),
							)
							.where(({ channel, member }) =>
								and(
									eq(channel.organizationId, organizationId),
									inArray(channel.type, ["public", "private", "direct", "single"]),
									isNull(channel.deletedAt),
									eq(member.userId, userId),
									eq(member.isHidden, false),
								),
							)
							.orderBy(({ channel }) => channel.createdAt, "asc"),
					(rows) =>
						ChannelListMessage.UpdatedChannels({
							channels: rows.map(({ channel, member }) => ({
								id: channel.id,
								name: channel.name,
								type: channel.type,
								sectionId: channel.sectionId ?? null,
								isFavorite: member.isFavorite,
								unread: member.notificationCount,
							})),
						}),
				),
		),
	)

/** Each DM's title: the other members' names, as the sidebar shows them. */
const dmNamesStream = (userId: UserId, dmIds: ReadonlyArray<ChannelId>) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<
					{ member: { channelId: ChannelId }; user: { firstName: string; lastName: string } },
					ChannelListMessage
				>(
					(q) =>
						q
							.from({ member: data.collections.channelMemberCollection })
							.innerJoin({ user: data.collections.userCollection }, ({ member, user }) =>
								eq(user.id, member.userId),
							)
							.where(({ member }) =>
								and(inArray(member.channelId, [...dmIds]), not(eq(member.userId, userId))),
							),
					(rows) => {
						const names: Record<string, Array<string>> = {}
						for (const { member, user } of rows)
							(names[member.channelId] ??= []).push(`${user.firstName} ${user.lastName}`.trim())
						return ChannelListMessage.UpdatedDmNames({
							names: Object.fromEntries(
								Object.entries(names).map(([id, list]) => [id, list.join(", ")]),
							),
						})
					},
				),
		),
	)

const isDm = (channel: Channel) => channel.type === "direct" || channel.type === "single"

const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase()

export const ChannelList = Hazel.component({
	name: "ChannelList",
	props: ChannelListProps,
	model: Schema.Struct({
		sections: Schema.Array(Section),
		channels: Schema.Array(Channel),
		dmNames: Schema.Record(Schema.String, Schema.String),
		activeChannelId: Schema.NullOr(ChannelId),
	}),
	message: ChannelListMessage,
}).make({
	init: ({ props }) => ({
		sections: [],
		channels: [],
		dmNames: {},
		activeChannelId: props.activeChannelId,
	}),
	update: {
		UpdatedSections: ($, { sections }) => $.evolve({ sections: () => sections }),
		UpdatedChannels: ($, { channels }) => $.evolve({ channels: () => channels }),
		UpdatedDmNames: ($, { names }) => $.evolve({ dmNames: () => names }),
		ChangedRoute: ($, { activeChannelId }) => $.evolve({ activeChannelId: () => activeChannelId }),
		// Selected at once; the host's route change confirms it.
		PressedChannel: ($, { id }) =>
			$.evolve({ activeChannelId: () => id }).run(RequestNavigation.make({ channelId: id })),
		CompletedRequestNavigation: ($) => $.model,
	},
	subscriptions: ({ props, model }) => [
		Subscription.make("sections", [props.organizationId], ([organizationId]) =>
			sectionsStream(organizationId),
		),
		Subscription.make("channels", [props.organizationId, props.userId], ([organizationId, userId]) =>
			channelsStream(organizationId, userId),
		),
		Subscription.make(
			"dmNames",
			[
				props.userId,
				model.channels
					.filter(isDm)
					.map((channel) => channel.id)
					.join(","),
			],
			([userId, ids]) =>
				dmNamesStream(userId, ids === "" ? [] : ids.split(",").map((id) => ChannelId.make(id))),
		),
	],
	view: (h, model) => {
		const row = (channel: Channel) => {
			const selected = model.activeChannelId === channel.id
			const title = isDm(channel) ? (model.dmNames[channel.id] ?? channel.name) : channel.name
			return h.item
				.key(channel.id)
				.title(title)
				.leading(
					isDm(channel)
						? h.avatar.initials(initialsOf(title))
						: h.icon.name(channel.type === "private" ? "lock" : "hashtag"),
				)
				.badge(channel.unread)
				.emphasized(channel.unread > 0)
				.selected(selected)
				.href(selected ? undefined : `/${h.props.orgSlug}/chat/${channel.id}`)
				.on("press", ChannelListMessage.PressedChannel({ id: channel.id }))
		}
		const group = (key: string, title: string, channels: ReadonlyArray<Channel>) =>
			channels.length === 0
				? []
				: [
						h.section
							.key(key)
							.title(title)
							.children(...channels.map(row)),
					]
		const listed = model.channels.filter((channel) => !channel.isFavorite)
		const channelsIn = (sectionId: ChannelSectionId | null) =>
			listed.filter((channel) => !isDm(channel) && channel.sectionId === sectionId)
		return h.stack.children(
			...group(
				"favorites",
				"Favorites",
				model.channels.filter((channel) => channel.isFavorite),
			),
			...group("default", "Channels", channelsIn(null)),
			...model.sections.flatMap((section) => group(section.id, section.name, channelsIn(section.id))),
			...group("dms", "Direct messages", listed.filter(isDm)),
		)
	},
})

/** What an island provides: the host's data instance and its navigation. */
export const channelListLayer = (data: ClientData["Service"], navigate: (channelId: ChannelId) => void) =>
	Layer.mergeAll(Layer.succeed(ClientData, data), RequestNavigation.layerWith(navigate))
