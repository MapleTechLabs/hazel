// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A conversation on a phone (`docs/ios-native.md`, N2): the shared message list over the shared
 * composer. Slack's bar: a bubble with the channel and its member count (its menu, `ChannelMenu`,
 * drops under it), or a DM's person (their profile). `./hosted` gives it its wiring (`HostedChannelScreen`).
 */
import { Subscription, UiSchema } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { AppRoute, hrefOf } from "../app/route"
import { initialsOf } from "../channel-sidebar/model"
import { Effect, Schema, Stream } from "effect"
import { ChannelMenu } from "./ChannelMenu"
import { ChannelComposer } from "./composer/ChannelComposer"
import { MessageList } from "./MessageList"

export const ChannelScreenProps = Schema.Struct({
	/** For the routes its rows open (a thread, a profile). */
	orgSlug: Schema.String,
	channelId: ChannelId,
	organizationId: OrganizationId,
	userId: UserId,
	cdnUrl: Schema.String,
	linkPreviewUrl: Schema.String,
	nowMs: Schema.Finite,
})
export type ChannelScreenProps = typeof ChannelScreenProps.Type

/** A DM's other person, for the bar's bubble. */
const Partner = Schema.Struct({
	userId: UserId,
	name: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
type Partner = typeof Partner.Type

export const ChannelScreenMessage = UiSchema.TaggedEnum({
	UpdatedChannel: { name: Schema.String, kind: Schema.String, icon: Schema.NullOr(Schema.String) },
	UpdatedMembers: { count: Schema.Finite, partner: Schema.NullOr(Partner) },
})
export type ChannelScreenMessage = typeof ChannelScreenMessage.Type

export const ChannelScreenModel = Schema.Struct({
	/** Null until the channel's row syncs. */
	name: Schema.NullOr(Schema.String),
	kind: Schema.String,
	icon: Schema.NullOr(Schema.String),
	members: Schema.Finite,
	partner: Schema.NullOr(Partner),
})

interface ChannelRow {
	readonly name: string
	readonly type: string
	readonly icon?: string | null
}

interface MemberRow {
	readonly member: { readonly userId: UserId }
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	}
}

/** The channel's members: how many, and a DM's other person. */
const membersStream = (channelId: ChannelId, userId: UserId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<MemberRow, ChannelScreenMessage>(
					(q) =>
						q
							.from({ member: data.collections.channelMemberCollection })
							.innerJoin({ user: data.collections.userCollection }, ({ member, user }) =>
								eq(user.id, member.userId),
							)
							.where(({ member }) =>
								and(eq(member.channelId, channelId), isNull(member.deletedAt)),
							),
					(rows) => {
						const other = rows.find((row) => row.member.userId !== userId)
						const partner: Partner | null =
							other === undefined
								? null
								: {
										userId: other.member.userId,
										name: `${other.user.firstName} ${other.user.lastName}`.trim(),
										avatarUrl: other.user.avatarUrl ?? null,
									}
						return ChannelScreenMessage.UpdatedMembers({ count: rows.length, partner })
					},
				),
		),
	)

const channelStream = (channelId: ChannelId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<ChannelRow, ChannelRow | undefined>(
					(q) =>
						q
							.from({ channel: data.collections.channelCollection })
							.where(({ channel }) => eq(channel.id, channelId)),
					(rows) => rows[0],
				),
		),
	).pipe(
		Stream.filter((row): row is ChannelRow => row !== undefined),
		Stream.map((row) =>
			ChannelScreenMessage.UpdatedChannel({ name: row.name, kind: row.type, icon: row.icon ?? null }),
		),
	)

/** The bar's title: `# name` for a channel, the name alone for a DM or a thread. */
export const titleOf = (name: string | null, kind: string): string =>
	name === null ? "" : kind === "public" || kind === "private" ? `# ${name}` : name

export const ChannelScreen = Hazel.component({
	name: "ChannelScreen",
	props: ChannelScreenProps,
	model: ChannelScreenModel,
	message: ChannelScreenMessage,
}).make({
	init: () => ({ name: null, kind: "public", icon: null, members: 0, partner: null }),
	update: {
		UpdatedChannel: ($, { name, kind, icon }) => ({ ...$.model, name, kind, icon }),
		UpdatedMembers: ($, { count, partner }) => ({ ...$.model, members: count, partner }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("channel", [props.channelId], ([channelId]) => channelStream(channelId)),
		Subscription.make("members", [props.channelId, props.userId], ([channelId, userId]) =>
			membersStream(channelId, userId),
		),
	],
	view: (h, model) => {
		const { props } = h
		const isChannel = model.kind === "public" || model.kind === "private"
		const partner = model.kind === "single" ? model.partner : null
		// Slack's bubble: a channel's glyph, name and members (its menu), or the DM's person (their profile).
		const bubble =
			model.name === null
				? null
				: partner !== null
					? h.item
							.key("bar:person")
							.emphasized(true)
							.title(partner.name)
							.leading(
								h.avatar
									.name(partner.name)
									.initials(initialsOf(partner.name))
									.src(partner.avatarUrl ?? undefined)
									.size("small"),
							)
							.href(
								hrefOf(AppRoute.Profile({ orgSlug: props.orgSlug, userId: partner.userId })),
							)
					: isChannel
						? ChannelMenu(h, {
								key: props.channelId,
								props: {
									orgSlug: props.orgSlug,
									channelId: props.channelId,
									userId: props.userId,
									name: model.name,
									kind: model.kind,
									icon: model.icon,
									members: model.members,
									nowMs: props.nowMs,
								},
							})
						: h.item
								.key("bar:channel")
								.emphasized(true)
								.title(model.name)
								.subtitle(model.members === 1 ? "1 member" : `${model.members} members`)
								.leading(h.icon.name("message-user"))
		return (
			h.screen
				.key(props.channelId)
				.title(titleOf(model.name, model.kind))
				.barLeading(bubble)
				.surface("page")
				// The list over the composer, or the page, has the whole height and scrolls itself.
				.fill(true)
				.children(
					MessageList(h, {
						key: props.channelId,
						props: {
							channelId: props.channelId,
							userId: props.userId,
							cdnUrl: props.cdnUrl,
							linkPreviewUrl: props.linkPreviewUrl,
							nowMs: props.nowMs,
						},
					}),
					ChannelComposer(h, {
						key: props.channelId,
						props: {
							channelId: props.channelId,
							organizationId: props.organizationId,
							userId: props.userId,
							placeholder:
								model.name === null
									? "Message"
									: `Message ${isChannel ? "#" : ""}${model.name}`,
							ready: true,
							autoFocus: false,
						},
					}),
				)
		)
	},
})
