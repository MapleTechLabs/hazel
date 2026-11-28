// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A channel's menu on a phone (Slack's): the bar's bubble opens a card under it, not a page. The
 * card names the channel and its members, offers Mute and Search, the conversation's tabs
 * (Messages, Files & Links), its notifications (a page inside the card, as Slack's), and "Settings
 * & Details" (the pushed details list, `channel-settings/ChannelDetails`).
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ChannelMember } from "@hazel/domain/models"
import { ChannelId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Option, Schema } from "effect"
import { Navigate, OpenCommandPalette, ShowToast } from "../app/requests"
import { AppRoute, hrefOf } from "../app/route"
import { levelKeyOf, levelLabels, muteDurations } from "../channel-sidebar/model"
import { WriteNotificationChoice } from "./header/ChannelHeader"
import { currentMemberOf, HeaderMember, isMemberMutedNow, type NotificationLevel } from "./header/model"
import { choiceOfKey, choiceToast, NotificationChoice } from "./header/notifications"
import { inheritedLevelStream, membersStream } from "./header/queries"

export const ChannelMenuProps = Schema.Struct({
	orgSlug: Schema.String,
	channelId: ChannelId,
	userId: UserId,
	name: Schema.String,
	/** `public` or `private`. */
	kind: Schema.String,
	icon: Schema.NullOr(Schema.String),
	members: Schema.Finite,
	/** The shell's clock, so a timed mute ends on time. */
	nowMs: Schema.Finite,
})
export type ChannelMenuProps = typeof ChannelMenuProps.Type

export const ChannelMenuMessage = UiSchema.TaggedEnum({
	UpdatedMembers: { members: Schema.Array(HeaderMember) },
	UpdatedInheritedLevel: { level: ChannelMember.NotificationLevel },
	PressedBubble: {},
	Dismissed: {},
	PressedFiles: {},
	PressedSettings: {},
	PressedSearch: {},
	PressedMute: {},
	PressedNotifications: {},
	PressedBack: {},
	SelectedNotification: { id: Schema.String },
	SucceededChoice: { choice: NotificationChoice },
	FailedChoice: {},
	CompletedRequest: {},
})
export type ChannelMenuMessage = typeof ChannelMenuMessage.Type

export const ChannelMenuModel = Schema.Struct({
	open: Schema.Boolean,
	/** The card's page: its main list, or the notification choices. */
	page: Schema.Literals(["main", "notifications"]),
	members: Schema.Array(HeaderMember),
	inheritedLevel: Schema.NullOr(ChannelMember.NotificationLevel),
})

const membersLabel = (count: number) => (count === 1 ? "1 member" : `${count} members`)

/** Slack's short level names, for the row's value (the menu keeps the long ones). */
const shortLevelLabels = {
	all: "All",
	mentions: "Mentions",
	nothing: "Nothing",
} as const satisfies { readonly [L in NotificationLevel]: string }

/** The notifications row's value: the mute while it holds, else the chosen (or inherited) level. */
export const notificationValueOf = (
	member: HeaderMember | undefined,
	inherited: NotificationLevel,
	nowMs: number,
): string =>
	member !== undefined && isMemberMutedNow(member, nowMs)
		? "Muted"
		: shortLevelLabels[member?.notificationLevel ?? inherited]

export const ChannelMenu = Hazel.component({
	name: "ChannelMenu",
	props: ChannelMenuProps,
	model: ChannelMenuModel,
	message: ChannelMenuMessage,
}).make({
	init: () => ({ open: false, page: "main" as const, members: [], inheritedLevel: null }),
	update: {
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members }),
		UpdatedInheritedLevel: ($, { level }) => $.evolve({ inheritedLevel: () => level }),
		PressedBubble: ($) => $.evolve({ open: (open) => !open, page: () => "main" as const }),
		Dismissed: ($) => $.evolve({ open: () => false }),
		PressedNotifications: ($) => $.evolve({ page: () => "notifications" as const }),
		PressedBack: ($) => $.evolve({ page: () => "main" as const }),
		PressedFiles: ($) =>
			$.evolve({ open: () => false }).run(
				Navigate.make({
					href: hrefOf(
						AppRoute.ChatFiles({ orgSlug: $.props.orgSlug, channelId: $.props.channelId }),
					),
					replace: false,
				}),
			),
		PressedSettings: ($) =>
			$.evolve({ open: () => false }).run(
				Navigate.make({
					href: hrefOf(
						AppRoute.ChannelSettings({ orgSlug: $.props.orgSlug, channelId: $.props.channelId }),
					),
					replace: false,
				}),
			),
		PressedSearch: ($) =>
			$.evolve({ open: () => false }).run(
				OpenCommandPalette.make({ page: "search" }).pipe(
					Command.map(() => ChannelMenuMessage.CompletedRequest()),
				),
			),
		// Slack's quick mute: until turned back on, or off again.
		PressedMute: ($) => {
			const member = currentMemberOf($.model.members, $.props.userId)
			if (member === undefined) return $.model
			const choice: NotificationChoice = isMemberMutedNow(member, $.props.nowMs)
				? { _tag: "Unmute" }
				: { _tag: "Mute", minutes: null }
			return $.run(write(member, choice))
		},
		SelectedNotification: ($, { id }) => {
			const member = currentMemberOf($.model.members, $.props.userId)
			if (member === undefined) return $.model
			return Option.match(choiceOfKey(id, member.isMuted || member.mutedUntilMs !== null), {
				onNone: () => $.model,
				onSome: (choice) => $.evolve({ page: () => "main" as const }).run(write(member, choice)),
			})
		},
		SucceededChoice: ($, { choice }) =>
			$.run(
				ShowToast.make({
					toast: { intent: "success", title: choiceToast(choice), description: null },
				}),
			),
		FailedChoice: ($) =>
			$.run(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Couldn't update notifications",
						description: "Please try again.",
					},
				}),
			),
		CompletedRequest: ($) => $.model,
	},
	subscriptions: ({ props }) => [
		Subscription.make("members", [props.channelId], ([channelId]) =>
			membersStream(channelId, (members) => ChannelMenuMessage.UpdatedMembers({ members })),
		),
		Subscription.make("inherited", [props.channelId], ([channelId]) =>
			inheritedLevelStream(channelId, (level) => ChannelMenuMessage.UpdatedInheritedLevel({ level })),
		),
	],
	view: (h, model) => {
		const { props } = h
		const isPrivate = props.kind === "private"
		const member = currentMemberOf(model.members, props.userId)
		const inherited = model.inheritedLevel ?? "mentions"
		const muted = member !== undefined && isMemberMutedNow(member, props.nowMs)
		const glyph = h.channelIcon.private(isPrivate).emoji(props.icon ?? undefined)

		const bubble = h.item
			.key("bar:channel")
			.emphasized(true)
			.title(props.name)
			.subtitle(membersLabel(props.members))
			.leading(glyph)
			.on("press", ChannelMenuMessage.PressedBubble())

		const header = h.stack
			.key("header")
			.axis("horizontal")
			.density("cozy")
			.align("center")
			.children(
				h.button
					.key("close")
					.label("Close")
					.icon("close")
					.iconOnly()
					.variant("ghost")
					.on("press", ChannelMenuMessage.Dismissed()),
				h.stack
					.density("none")
					.children(
						h.heading.level("2").children(`${isPrivate ? "" : "#"}${props.name}`),
						h.text.role("caption").tone("muted").children(membersLabel(props.members)),
					),
			)

		const actions = h.stack
			.key("actions")
			.axis("horizontal")
			.density("tight")
			.children(
				...(member === undefined
					? []
					: [
							h.button
								.key("mute")
								.label(muted ? "Unmute" : "Mute")
								.icon(muted ? "volume" : "volume-mute")
								.variant("outline")
								.on("press", ChannelMenuMessage.PressedMute()),
						]),
				h.button
					.key("search")
					.label("Search")
					.icon("search")
					.variant("outline")
					.on("press", ChannelMenuMessage.PressedSearch()),
			)

		const chevron = h.icon.name("chevron-right")
		const tabs = h.section
			.key("tabs")
			.style("list")
			.children(
				h.item
					.key("messages")
					.title("Messages")
					.selected(true)
					.leading(h.icon.name("messages"))
					.on("press", ChannelMenuMessage.Dismissed()),
				h.item
					.key("files")
					.title("Files & Links")
					.leading(h.icon.name("paperclip"))
					.on("press", ChannelMenuMessage.PressedFiles()),
			)

		const notifications =
			member === undefined
				? null
				: h.item
						.key("notifications")
						.title("Notifications")
						.leading(h.icon.name(muted ? "bell-off" : "bell"))
						.trailing(
							h.text
								.role("label")
								.tone("muted")
								.children(notificationValueOf(member, inherited, props.nowMs)),
							chevron,
						)
						.on("press", ChannelMenuMessage.PressedNotifications())

		const more = h.section
			.key("more")
			.style("list")
			.children(
				notifications,
				h.item
					.key("settings")
					.title("Settings & Details")
					.leading(h.icon.name("gear"))
					.trailing(chevron)
					.on("press", ChannelMenuMessage.PressedSettings()),
			)

		const check = h.icon.name("check")
		const notificationsPage =
			member === undefined
				? null
				: h.stack
						.key("notifications-page")
						.density("cozy")
						.children(
							h.stack
								.key("header")
								.axis("horizontal")
								.density("cozy")
								.align("center")
								.children(
									h.button
										.key("back")
										.label("Back")
										.icon("chevron-left")
										.iconOnly()
										.variant("ghost")
										.on("press", ChannelMenuMessage.PressedBack()),
									h.heading.level("2").children("Notifications"),
								),
							h.section
								.key("levels")
								.style("list")
								.children(
									...LEVELS.map((level) =>
										h.item
											.key(levelKeyOf(level))
											.title(
												level === null
													? `Default (${levelLabels[inherited]})`
													: levelLabels[level],
											)
											.trailing(level === member.notificationLevel ? check : null)
											.on(
												"press",
												ChannelMenuMessage.SelectedNotification({
													id: levelKeyOf(level),
												}),
											),
									),
								),
							h.divider,
							h.section
								.key("mute")
								.style("list")
								.children(
									...(muted
										? [
												h.item
													.key("unmute")
													.title("Unmute")
													.leading(h.icon.name("volume"))
													.on(
														"press",
														ChannelMenuMessage.SelectedNotification({
															id: "mute",
														}),
													),
											]
										: muteDurations.map(({ key, label }) =>
												h.item
													.key(key)
													.title(
														`Mute ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
													)
													.leading(h.icon.name("volume-mute"))
													.on(
														"press",
														ChannelMenuMessage.SelectedNotification({ id: key }),
													),
											)),
								),
						)

		return h.popover
			.open(model.open)
			.anchor(bubble)
			.on("dismiss", ChannelMenuMessage.Dismissed())
			.children(
				model.page === "notifications" && notificationsPage !== null
					? notificationsPage
					: h.stack.key("card").density("cozy").children(header, actions, tabs, more),
			)
	},
})

const LEVELS: ReadonlyArray<NotificationLevel | null> = [null, "all", "mentions", "nothing"]

const write = (member: HeaderMember, choice: NotificationChoice) =>
	WriteNotificationChoice.make({ memberId: member.id, choice }).pipe(
		// The write answers with the header's Succeeded or Failed message only.
		Command.map((message) =>
			message._tag === "SucceededNotificationChoice"
				? ChannelMenuMessage.SucceededChoice({ choice: message.choice })
				: ChannelMenuMessage.FailedChoice(),
		),
	)
