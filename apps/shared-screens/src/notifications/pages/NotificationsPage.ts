// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/notifications` and its `unreads` and `all` tabs (`web-foldkit/src/page/notifications/inbox`,
 * now deleted), Discord's inbox: Mentions and All are the shared Activity screen, mounted here;
 * Unreads lists the channels with messages the user has not read. The notifications layout around
 * it (sidebar, scroll column) is the shell's.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { ChannelId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Match, Schema } from "effect"
import { Activity } from "../../activity/Activity"
import { formatDistanceToNow } from "../../activity/format"
import { Navigate, ShowToast } from "../../app/requests"
import { Session } from "../../app/session"
import {
	keptMarks,
	MarkedRead,
	markRead,
	UnreadChannel,
	unreadChannelDetail,
	unreadChannelsStream,
	unreadChannelTitle,
	visibleUnreadChannels,
} from "./unreads"

export const InboxTab = Schema.Literals(["mentions", "unreads", "all"])
export type InboxTab = typeof InboxTab.Type

export const NotificationsMessage = UiSchema.TaggedEnum({
	UpdatedUnreadChannels: { channels: Schema.Array(UnreadChannel) },
	PressedChannel: { channelId: ChannelId },
	PressedMarkChannelRead: { channelId: ChannelId },
	SucceededMarkChannelRead: {},
	/** `ChannelNotFound`: the channel is gone and leaves the list on its own. */
	FailedMarkChannelRead: { channelId: ChannelId, reason: Schema.Literals(["ChannelNotFound", "Other"]) },
	PressedMarkAllRead: {},
	SucceededMarkAllRead: {},
	FailedMarkAllRead: { channelIds: Schema.Array(ChannelId) },
})
export type NotificationsMessage = typeof NotificationsMessage.Type

export const NotificationsProps = Schema.Struct({
	session: Session,
	tab: InboxTab,
	nowMs: Schema.Finite,
	/** A phone: the top bar names the inbox, so the page draws no header of its own. */
	isMobile: Schema.Boolean,
})
export type NotificationsProps = typeof NotificationsProps.Type

export const NotificationsModel = Schema.Struct({
	/** Null until the Unreads query first emits. */
	unreadChannels: Schema.NullOr(Schema.Array(UnreadChannel)),
	markedRead: Schema.Array(MarkedRead),
	/** `channelMember.markAllRead` is in flight (the header's button shows pending). */
	isMarkingAllRead: Schema.Boolean,
})
export type NotificationsModel = typeof NotificationsModel.Type

/** One channel read: its read position moves to now and its notifications go, as opening it does. */
export class MarkChannelRead extends Command.Service<MarkChannelRead>()(
	"hazel/notifications/MarkChannelRead",
	{
		args: { channelId: ChannelId },
		success: NotificationsMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ channelId }) =>
				rpc("channelMember.clearNotifications", { channelId }).pipe(
					Effect.as(NotificationsMessage.SucceededMarkChannelRead()),
					Effect.catchTags({
						ChannelNotFoundError: () =>
							Effect.succeed(
								NotificationsMessage.FailedMarkChannelRead({
									channelId,
									reason: "ChannelNotFound",
								}),
							),
					}),
					// BOUNDARY: every other failure (offline, signed out, the server) reads the same here.
					Effect.tapCause((cause) => Effect.logWarning("mark channel read failed", cause)),
					Effect.catchCause(() =>
						Effect.succeed(
							NotificationsMessage.FailedMarkChannelRead({ channelId, reason: "Other" }),
						),
					),
				)
		}),
	)
}

/** Every channel of the organization read (Shift+Escape's `channelMember.markAllRead`). */
export class MarkAllChannelsRead extends Command.Service<MarkAllChannelsRead>()(
	"hazel/notifications/MarkAllChannelsRead",
	{
		args: { organizationId: OrganizationId, channelIds: Schema.Array(ChannelId) },
		success: NotificationsMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, channelIds }) =>
				rpc("channelMember.markAllRead", { organizationId }).pipe(
					Effect.as(NotificationsMessage.SucceededMarkAllRead()),
					// BOUNDARY: any failure puts the channels back and says so.
					Effect.tapCause((cause) => Effect.logWarning("mark all read failed", cause)),
					Effect.catchCause(() =>
						Effect.succeed(NotificationsMessage.FailedMarkAllRead({ channelIds })),
					),
				)
		}),
	)
}

const COPY = {
	mentions: {
		heading: "Mentions",
		subheading: "Mentions, replies and direct messages for you.",
	},
	unreads: {
		heading: "Unreads",
		subheading: "Channels with messages you haven't read.",
	},
	all: {
		heading: "All activity",
		subheading: "Stay updated on messages and activity in your channels.",
	},
} as const satisfies Record<InboxTab, { heading: string; subheading: string }>

const errorToast = (title: string) =>
	ShowToast.make({
		toast: { intent: "error", title, description: "Check your connection and try again." },
	})

const visibleOf = (model: NotificationsModel, nowMs: number) =>
	visibleUnreadChannels(model.unreadChannels ?? [], model.markedRead, nowMs)

const channelHref = (orgSlug: string, channelId: ChannelId) => `/${orgSlug}/chat/${channelId}`

const NotificationsDef = Hazel.component({
	name: "NotificationsPage",
	props: NotificationsProps,
	model: NotificationsModel,
	message: NotificationsMessage,
})

type H = Parameters<Parameters<typeof NotificationsDef.make>[0]["view"]>[0]

const markAllButton = (h: H, model: NotificationsModel) =>
	h.button
		.label("Mark all as read")
		.icon("check")
		.variant("outline")
		.size("small")
		.loading(model.isMarkingAllRead)
		.on("press", NotificationsMessage.PressedMarkAllRead())

// Today's `pageHeader` (display title, subtitle, actions at its end) composed from a stack: `screen`
// `page` is the phone's bar (`p4-screen-page-column`).
const header = (h: H, model: NotificationsModel, hasAction: boolean) =>
	h.stack
		.axis("horizontal")
		.align("start")
		.children(
			h.stack
				.density("tight")
				.children(
					h.heading.level("1").children(COPY[h.props.tab].heading),
					h.text.role("label").tone("muted").children(COPY[h.props.tab].subheading),
				),
			h.spacer,
			hasAction ? markAllButton(h, model) : null,
		)

const channelGlyph = (type: string) =>
	Match.value(type).pipe(
		Match.when("thread", () => "thread" as const),
		Match.whenOr("public", "private", () => "hashtag" as const),
		Match.orElse(() => "messages" as const),
	)

/** An Unreads row: the channel, how much there is, and when; it opens the channel. */
const unreadRow = (h: H, channel: UnreadChannel, orgSlug: string | null, nowMs: number) => {
	const title = unreadChannelTitle(channel)
	return (
		h.item
			.key(channel.channelId)
			.title(title)
			.subtitle(unreadChannelDetail(channel))
			.unread("dot")
			.emphasized(true)
			.leadingSize("large")
			.leading(h.iconTile.name(channelGlyph(channel.type)))
			.badge(channel.mentionCount)
			.href(orgSlug === null ? undefined : channelHref(orgSlug, channel.channelId))
			.trailing(
				h.text
					.role("caption")
					.tone("muted")
					.children(formatDistanceToNow(Math.min(channel.lastMessageAtMs, nowMs), nowMs)),
			)
			// Shown on hover or focus on the web, always on a phone; named after its row.
			.actions(
				h.button
					.icon("check")
					.iconOnly()
					.variant("ghost")
					.size("xsmall")
					.label(`Mark as read: ${title}`)
					.on(
						"press",
						NotificationsMessage.PressedMarkChannelRead({ channelId: channel.channelId }),
					),
			)
			.on("press", NotificationsMessage.PressedChannel({ channelId: channel.channelId }))
	)
}

const unreadList = (h: H, model: NotificationsModel) => {
	const { session, nowMs, isMobile } = h.props
	if (model.unreadChannels === null) return [h.progress.style("spinner").label("Loading...")]
	const channels = visibleOf(model, nowMs)
	if (channels.length === 0)
		return [
			h.emptyState
				.icon("bell")
				.title("No unread channels")
				.description("You're all caught up! Channels with new messages will appear here."),
		]
	const list = h.frame.surface("flush").children(
		...channels.flatMap((channel, index) => {
			const row = unreadRow(h, channel, session.orgSlug, nowMs)
			return index === 0 ? [row] : [h.divider.key(`divider:${channel.channelId}`), row]
		}),
	)
	// On a phone the header (and its action) is not drawn: the action sits over the list, at its end.
	return [
		isMobile
			? h.stack
					.density("cozy")
					.children(h.stack.axis("horizontal").children(h.spacer, markAllButton(h, model)), list)
			: list,
	]
}

export const NotificationsPage = NotificationsDef.make({
	init: () => ({ unreadChannels: null, markedRead: [], isMarkingAllRead: false }),
	update: {
		UpdatedUnreadChannels: ($, { channels }) =>
			$.evolve({
				unreadChannels: () => channels,
				markedRead: (current) => keptMarks(current, channels),
			}),
		PressedChannel: ($, { channelId }) => {
			const { orgSlug } = $.props.session
			return orgSlug === null
				? $.model
				: $.run(Navigate.make({ href: channelHref(orgSlug, channelId), replace: false }))
		},
		PressedMarkChannelRead: ($, { channelId }) =>
			$.evolve({
				markedRead: (current) => markRead(current, $.model.unreadChannels ?? [], [channelId]),
			}).run(MarkChannelRead.make({ channelId })),
		SucceededMarkChannelRead: ($) => $.model,
		FailedMarkChannelRead: ($, { channelId, reason }) =>
			reason === "ChannelNotFound"
				? $.model
				: $.evolve({
						markedRead: (current) => current.filter((entry) => entry.channelId !== channelId),
					}).run(errorToast("Couldn't mark the channel as read")),
		PressedMarkAllRead: ($) => {
			const organization = $.props.session.organization
			if (organization === null || $.model.isMarkingAllRead) return $.model
			const channelIds = visibleOf($.model, $.props.nowMs).map((channel) => channel.channelId)
			return $.evolve({
				markedRead: (current) => markRead(current, $.model.unreadChannels ?? [], channelIds),
				isMarkingAllRead: () => true,
			}).run(MarkAllChannelsRead.make({ organizationId: organization.id, channelIds }))
		},
		SucceededMarkAllRead: ($) => $.evolve({ isMarkingAllRead: () => false }),
		FailedMarkAllRead: ($, { channelIds }) =>
			$.evolve({
				markedRead: (current) => current.filter((entry) => !channelIds.includes(entry.channelId)),
				isMarkingAllRead: () => false,
			}).run(errorToast("Couldn't mark the channels as read")),
	},
	subscriptions: ({ props }) => {
		const organizationId = props.session.organization?.id ?? null
		const userId = props.session.user?.id ?? null
		return organizationId === null || userId === null
			? []
			: [
					Subscription.make("unreadChannels", [organizationId, userId], ([org, user]) =>
						unreadChannelsStream(org, user, (channels) =>
							NotificationsMessage.UpdatedUnreadChannels({ channels }),
						),
					),
				]
	},
	view: (h, model) => {
		const { session, tab, nowMs, isMobile } = h.props
		const { member, orgSlug } = session
		const hasUnreads = tab === "unreads" && visibleOf(model, nowMs).length > 0
		const body =
			tab === "unreads"
				? unreadList(h, model)
				: member === null || orgSlug === null
					? [h.progress.style("spinner").label("Loading...")]
					: [
							Activity(h, {
								key: member.id,
								props: { memberId: member.id, orgSlug, tab, nowMs, titled: false },
							}),
						]
		// The shell's content column pads the page (`px-4 lg:px-8`), as today's `pageLayout`.
		return h.stack
			.key("notifications")
			.density("relaxed")
			.children(isMobile ? null : header(h, model, hasUnreads), ...body)
	},
})
