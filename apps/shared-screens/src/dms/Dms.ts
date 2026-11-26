// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The DMs tab as a shared `hazel` screen over `@hazel/client-data` (Phase 3). Today's version is the
 * phone's `ChatDms` page (`web-foldkit/src/page/chat-index/mobile-dms.ts`): a people strip, `All` and
 * `Unreads`, rows newest first. The host provides the data, navigation (`RequestNavigation`) and compose.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { and, eq, inArray, isNull } from "@tanstack/db"
import { Clock, Effect, Layer, Schedule, Schema, Stream } from "effect"
import {
	dmTimeOf,
	fullName,
	initialsOf,
	partnerOf,
	type Person as PersonType,
	previewOf,
	titleOf,
} from "./format"

export const DmType = Schema.Literals(["direct", "single"])

export const Dm = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: DmType,
	isMuted: Schema.Boolean,
	unread: Schema.Finite,
	lastMessageAtMs: Schema.NullOr(Schema.Finite),
	lastMessageAuthorId: Schema.NullOr(UserId),
	lastMessagePreview: Schema.NullOr(Schema.String),
})
export type Dm = typeof Dm.Type

export const Person = Schema.Struct({
	userId: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

/** The avatar's presence options; the app's `dnd` draws as `busy`. */
export const Presence = Schema.Literals(["online", "away", "busy", "offline"])
export type Presence = typeof Presence.Type

export const DmFilter = Schema.Literals(["all", "unreads"])
export type DmFilter = typeof DmFilter.Type

export const DmsMessage = UiSchema.TaggedEnum({
	UpdatedDms: { dms: Schema.Array(Dm) },
	/** Every member of each DM, the current user included, by channel id. */
	UpdatedMembers: { members: Schema.Record(Schema.String, Schema.Array(Person)) },
	UpdatedPresence: { presence: Schema.Record(Schema.String, Presence) },
	Ticked: { nowMs: Schema.Finite },
	PressedFilter: { filter: DmFilter },
	PressedDm: { id: ChannelId },
	PressedCompose: {},
	CompletedRequestNavigation: {},
	CompletedRequestCompose: {},
})
export type DmsMessage = typeof DmsMessage.Type

export const DmsProps = Schema.Struct({
	organizationId: OrganizationId,
	userId: UserId,
	orgSlug: Schema.String,
	/** The clock at mount; `Ticked` moves it on, so row times stay current. */
	nowMs: Schema.Finite,
})
export type DmsProps = typeof DmsProps.Type

export const DmsModel = Schema.Struct({
	loaded: Schema.Boolean,
	dms: Schema.Array(Dm),
	members: Schema.Record(Schema.String, Schema.Array(Person)),
	presence: Schema.Record(Schema.String, Presence),
	filter: DmFilter,
	nowMs: Schema.Finite,
})
export type DmsModel = typeof DmsModel.Type

/** Asks the host to open a DM; the host owns routing. */
export class RequestNavigation extends Command.Service<RequestNavigation>()("hazel/dms/RequestNavigation", {
	args: { channelId: ChannelId },
	success: DmsMessage,
}) {
	static readonly layerWith = (navigate: (channelId: ChannelId) => void) =>
		this.toLayer(
			Effect.succeed(({ channelId }) =>
				Effect.sync(() => {
					navigate(channelId)
					return DmsMessage.CompletedRequestNavigation()
				}),
			),
		)
}

/** Asks the host to start a conversation (the web opens its Create DM modal). */
export class RequestCompose extends Command.Service<RequestCompose>()("hazel/dms/RequestCompose", {
	args: {},
	success: DmsMessage,
}) {
	static readonly layerWith = (compose: () => void) =>
		this.toLayer(
			Effect.succeed(() =>
				Effect.sync(() => {
					compose()
					return DmsMessage.CompletedRequestCompose()
				}),
			),
		)
}

interface DmRow {
	readonly channel: {
		readonly id: ChannelId
		readonly name: string
		readonly type: Dm["type"]
		readonly lastMessageAt?: Date | string | null
		readonly lastMessageAuthorId?: UserId | null
		readonly lastMessagePreview?: string | null
	}
	readonly member: { readonly isMuted: boolean; readonly notificationCount?: number | null }
}

const msOf = (value: Date | string | null | undefined) =>
	value === null || value === undefined ? null : new Date(value).getTime()

/** The user's visible DMs in the org, with their unread count and the channel's last message. */
const dmsStream = (organizationId: OrganizationId, userId: UserId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<DmRow, DmsMessage>(
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
									inArray(channel.type, ["direct", "single"]),
									isNull(channel.deletedAt),
									eq(member.userId, userId),
									eq(member.isHidden, false),
								),
							)
							.orderBy(({ channel }) => channel.createdAt, "asc"),
					(rows) =>
						DmsMessage.UpdatedDms({
							dms: rows.map(({ channel, member }) => ({
								id: channel.id,
								name: channel.name,
								type: channel.type,
								isMuted: member.isMuted,
								unread: member.notificationCount ?? 0,
								lastMessageAtMs: msOf(channel.lastMessageAt),
								lastMessageAuthorId: channel.lastMessageAuthorId ?? null,
								lastMessagePreview: channel.lastMessagePreview ?? null,
							})),
						}),
				),
		),
	)

interface MemberRow {
	readonly member: { readonly channelId: ChannelId }
	readonly user: {
		readonly id: UserId
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	}
}

const membersStream = (dmIds: ReadonlyArray<ChannelId>) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<MemberRow, DmsMessage>(
					(q) =>
						q
							.from({ member: data.collections.channelMemberCollection })
							.innerJoin({ user: data.collections.userCollection }, ({ member, user }) =>
								eq(user.id, member.userId),
							)
							.where(({ member }) => inArray(member.channelId, [...dmIds])),
					(rows) => {
						const members: Record<string, Array<PersonType>> = {}
						for (const { member, user } of rows)
							(members[member.channelId] ??= []).push({
								userId: user.id,
								firstName: user.firstName,
								lastName: user.lastName,
								avatarUrl: user.avatarUrl ?? null,
							})
						return DmsMessage.UpdatedMembers({ members })
					},
				),
		),
	)

interface PresenceRow {
	readonly userId: UserId
	readonly status?: string | null
}

/** `getEffectivePresenceStatus`: the newest row per user; unknown or missing is offline. */
export const presenceOf = (status: string | null | undefined): Presence =>
	status === "online" || status === "away" || status === "busy"
		? status
		: status === "dnd"
			? "busy"
			: "offline"

const presenceStream = (userIds: ReadonlyArray<UserId>) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<PresenceRow, DmsMessage>(
					(q) =>
						q
							.from({ presence: data.collections.userPresenceStatusCollection })
							.where(({ presence }) => inArray(presence.userId, [...userIds]))
							.orderBy(({ presence }) => presence.updatedAt, "desc"),
					(rows) => {
						const presence: Record<string, Presence> = {}
						for (const row of rows) presence[row.userId] ??= presenceOf(row.status)
						return DmsMessage.UpdatedPresence({ presence })
					},
				),
		),
	)

const ticks = Stream.fromSchedule(Schedule.spaced("30 seconds")).pipe(
	Stream.mapEffect(() => Clock.currentTimeMillis),
	Stream.map((nowMs) => DmsMessage.Ticked({ nowMs })),
)

const othersOf = (model: DmsModel, dm: Dm, userId: UserId) =>
	(model.members[dm.id] ?? []).filter((person) => person.userId !== userId)

/** Newest message first, as Slack's; DMs with no message yet after them. */
export const ordered = (dms: ReadonlyArray<Dm>) =>
	[...dms].sort((a, b) => (b.lastMessageAtMs ?? 0) - (a.lastMessageAtMs ?? 0))

/** One-to-one partners whose presence the screen shows. */
export const partnerIds = (model: DmsModel, userId: UserId): ReadonlyArray<UserId> =>
	model.dms.flatMap((dm) => {
		const partner = partnerOf(dm, othersOf(model, dm, userId))
		return partner === undefined ? [] : [partner.userId]
	})

const STRIP_LIMIT = 12

export const Dms = Hazel.component({
	name: "Dms",
	props: DmsProps,
	model: DmsModel,
	message: DmsMessage,
}).make({
	init: ({ props }) => ({
		loaded: false,
		dms: [],
		members: {},
		presence: {},
		filter: "all" as const,
		nowMs: props.nowMs,
	}),
	update: {
		UpdatedDms: ($, { dms }) => $.evolve({ dms: () => dms, loaded: () => true }),
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members }),
		UpdatedPresence: ($, { presence }) => $.evolve({ presence: () => presence }),
		Ticked: ($, { nowMs }) => $.evolve({ nowMs: () => nowMs }),
		PressedFilter: ($, { filter }) => $.evolve({ filter: () => filter }),
		PressedDm: ($, { id }) => $.run(RequestNavigation.make({ channelId: id })),
		PressedCompose: ($) => $.run(RequestCompose.make({})),
		CompletedRequestNavigation: ($) => $.model,
		CompletedRequestCompose: ($) => $.model,
	},
	subscriptions: ({ props, model }) => [
		Subscription.make("dms", [props.organizationId, props.userId], ([organizationId, userId]) =>
			dmsStream(organizationId, userId),
		),
		Subscription.make("members", [model.dms.map((dm) => dm.id).join(",")], ([ids]) =>
			ids === "" ? Stream.empty : membersStream(ids.split(",").map((id) => ChannelId.make(id))),
		),
		Subscription.make("presence", [partnerIds(model, props.userId).join(",")], ([ids]) =>
			ids === "" ? Stream.empty : presenceStream(ids.split(",").map((id) => UserId.make(id))),
		),
		Subscription.make("clock", ticks),
	],
	view: (h, model) => {
		const userId = h.props.userId
		const dms = ordered(model.dms)
		const unread = dms.filter((dm) => dm.unread > 0)
		const rest = dms.filter((dm) => dm.unread === 0)
		const press = (dm: Dm) => DmsMessage.PressedDm({ id: dm.id })
		const hrefOf = (dm: Dm) => `/${h.props.orgSlug}/chat/${dm.id}`

		const avatarOf = (person: PersonType, size: "regular" | "large") =>
			h.avatar
				.name(fullName(person))
				.initials(initialsOf(fullName(person)))
				.src(person.avatarUrl ?? undefined)
				.presence(model.presence[person.userId] ?? "offline")
				.size(size)

		const row = (dm: Dm) => {
			const members = model.members[dm.id] ?? []
			const others = othersOf(model, dm, userId)
			const partner = partnerOf(dm, others)
			const leading =
				partner !== undefined
					? avatarOf(partner, "regular")
					: // HAZEL-GAP(dm-group-avatar): today's group DM draws two small avatars offset diagonally in one avatar's box
						h.avatarStack.children(
							...others.slice(0, 2).map((person) =>
								h.avatar
									.key(person.userId)
									.name(fullName(person))
									.initials(initialsOf(fullName(person)))
									.src(person.avatarUrl ?? undefined),
							),
						)
			return (
				h.item
					.key(dm.id)
					.title(titleOf(dm, others))
					// HAZEL-GAP(item-subtitle-lines): today's preview wraps to two lines; `subtitle` is one
					.subtitle(previewOf(dm, members, others, userId))
					.leading(leading)
					.trailing(
						dm.lastMessageAtMs === null
							? undefined
							: h.text
									.role("caption")
									.tone(dm.unread > 0 ? "default" : "muted")
									.strong(dm.unread > 0)
									.numeric()
									.children(dmTimeOf(dm.lastMessageAtMs, model.nowMs)),
					)
					.badge(dm.unread)
					.emphasized(dm.unread > 0)
					.muted(dm.isMuted)
					.href(hrefOf(dm))
					.on("press", press(dm))
			)
		}

		const people = dms.flatMap((dm) => {
			const partner = partnerOf(dm, othersOf(model, dm, userId))
			return partner === undefined ? [] : [{ dm, partner }]
		})
		// HAZEL-GAP(people-strip): a snapping, edge-to-edge row of tappable avatar-over-name tiles (`a` links today)
		const strip =
			people.length === 0
				? undefined
				: // An untitled section, for the screen's inset.
					h.section.key("people").children(
						h.scroll.axis("horizontal").children(
							h.stack.axis("horizontal").children(
								...people.slice(0, STRIP_LIMIT).map(({ dm, partner }) =>
									h.stack
										.key(dm.id)
										.align("center")
										.density("compact")
										.children(
											avatarOf(partner, "large").on("press", press(dm)),
											h.text
												.role("caption")
												.tone(dm.unread > 0 ? "default" : "muted")
												.strong(dm.unread > 0)
												.truncate()
												.children(partner.firstName),
										),
								),
							),
						),
					)

		// HAZEL-GAP(filter-chip): today's `All` / `Unreads` are pressed-state toggle chips, fully round
		const chip = (filter: DmFilter, label: string) =>
			h.button
				.key(filter)
				.label(label)
				.size("small")
				.variant(model.filter === filter ? "secondary" : "ghost")
				.on("press", DmsMessage.PressedFilter({ filter }))
		const filters =
			dms.length === 0
				? undefined
				: h.section.key("filters").children(
						h.stack
							.axis("horizontal")
							.density("compact")
							.children(
								chip("all", "All"),
								chip("unreads", unread.length > 0 ? `Unreads · ${unread.length}` : "Unreads"),
							),
					)

		const section = (key: string, title: string | undefined, list: ReadonlyArray<Dm>) =>
			list.length === 0
				? undefined
				: h.section
						.key(key)
						.title(title)
						.children(...list.map(row))

		// HAZEL-GAP(icon-messages): today's empty states draw `IconMsgs`; the nearest name is `users`
		const empty = (title: string, description: string) =>
			h.emptyState.key("empty").icon("users").title(title).description(description)

		const body = !model.loaded
			? h.list.key("loading").loading()
			: dms.length === 0
				? empty("No direct messages", "Start a conversation with someone in your organization.")
				: model.filter === "unreads"
					? unread.length === 0
						? empty("You're all caught up", "No unread direct messages.")
						: section("unreads-only", undefined, unread)
					: unread.length === 0
						? section("all", undefined, rest)
						: [section("unreads", "Unreads", unread), section("rest", "Everything else", rest)]

		// HAZEL-GAP(floating-action): today's compose is a 56pt round button floating over the list's end
		const compose = h.button
			.label("New message")
			.icon("plus")
			.iconOnly()
			.circle()
			.size("large")
			.on("press", DmsMessage.PressedCompose())

		return h.screen.title("DMs").toolbar(compose).children(strip, filters, body)
	},
})

/** What a host provides: its data instance, navigation and compose. */
export const dmsLayer = (
	data: ClientData["Service"],
	navigate: (channelId: ChannelId) => void,
	compose: () => void,
) =>
	Layer.mergeAll(
		Layer.succeed(ClientData, data),
		RequestNavigation.layerWith(navigate),
		RequestCompose.layerWith(compose),
	)
