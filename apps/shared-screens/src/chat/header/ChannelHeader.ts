// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel header (today's `page/chat/header.ts`, `ChatHeader`): the channel's name, a thread's
 * parent, a DM's people and the partner's presence; the bell (`notifications.ts`), the pins
 * (`../pins/PinnedMessages.ts`), the linked customer's chip and card (`CustomerCard.ts`), "Unhide
 * conversation" on a hidden DM and "Follow thread" on a thread the user does not follow.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { ChannelId, ChannelMemberId, type MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Clock, Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { Navigate, ShowToast } from "../../app/requests"
import { isDmType } from "../../channel-sidebar/model"
import { PinnedMessages, pinnedMessagesLayer } from "../pins/PinnedMessages"
import { CustomerCard, CustomerGlance } from "./CustomerCard"
import {
	bellLabelOf,
	currentMemberOf,
	dmTitleOf,
	HeaderChannel,
	HeaderMember,
	isMemberMutedNow,
	othersOf,
	partnerOf,
	Presence,
	SyncProvider,
} from "./model"
import { bellEntries, choiceOfKey, choiceToast, NotificationChoice } from "./notifications"
import {
	channelStream,
	customerStream,
	inheritedLevelStream,
	membersStream,
	ownerNameStream,
	presenceStream,
	syncStream,
} from "./queries"
import { ChannelMember } from "@hazel/domain/models"

/** Why a write the header makes failed: the membership is gone, or anything else. */
export const HeaderFailure = Schema.Literals(["MemberNotFound", "Other"])
export type HeaderFailure = typeof HeaderFailure.Type

export const ChannelHeaderMessage = UiSchema.TaggedEnum({
	UpdatedChannel: { channel: Schema.NullOr(HeaderChannel) },
	UpdatedParent: { channel: Schema.NullOr(HeaderChannel) },
	UpdatedMembers: { members: Schema.Array(HeaderMember) },
	UpdatedInheritedLevel: { level: ChannelMember.NotificationLevel },
	UpdatedPresence: { presence: Presence },
	UpdatedCustomer: { customer: Schema.NullOr(CustomerGlance) },
	UpdatedOwnerName: { name: Schema.NullOr(Schema.String) },
	UpdatedSync: { provider: SyncProvider },
	PressedBack: {},
	PressedParentCrumb: {},
	SelectedBellEntry: { id: Schema.String },
	SucceededNotificationChoice: { choice: NotificationChoice },
	FailedNotificationChoice: { reason: HeaderFailure },
	PressedUnhide: {},
	SucceededUnhide: {},
	FailedUnhide: { reason: HeaderFailure },
	PressedFollowThread: {},
	SucceededFollowThread: {},
	FailedFollowThread: {},
})
export type ChannelHeaderMessage = typeof ChannelHeaderMessage.Type

export const ChannelHeaderProps = Schema.Struct({
	channelId: ChannelId,
	organizationId: OrganizationId,
	userId: UserId,
	orgSlug: Schema.String,
	/** The shell's `(max-width: 767px)`: a back button, the card in a sheet, no thread parent. */
	isMobile: Schema.Boolean,
	/** The shell's clock, so a timed mute ends on time. */
	nowMs: Schema.Finite,
})
export type ChannelHeaderProps = typeof ChannelHeaderProps.Type

export const ChannelHeaderModel = Schema.Struct({
	channel: Schema.NullOr(HeaderChannel),
	parent: Schema.NullOr(HeaderChannel),
	/** Null until the members query answers. */
	members: Schema.NullOr(Schema.Array(HeaderMember)),
	inheritedLevel: Schema.NullOr(ChannelMember.NotificationLevel),
	presence: Presence,
	customer: Schema.NullOr(CustomerGlance),
	ownerName: Schema.NullOr(Schema.String),
	sync: SyncProvider,
})
export type ChannelHeaderModel = typeof ChannelHeaderModel.Type

const failureOf = (error: { readonly _tag: string }): HeaderFailure =>
	error._tag === "ChannelMemberNotFoundError" ? "MemberNotFound" : "Other"

/** A mute, unmute, level or unfollow (`writeChoice`): optimistic, so the bell changes at once. */
export class WriteNotificationChoice extends Command.Service<WriteNotificationChoice>()(
	"hazel/chat/header/WriteNotificationChoice",
	{ args: { memberId: ChannelMemberId, choice: NotificationChoice }, success: ChannelHeaderMessage },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const update = data.actions.updateChannelMemberAction
			return ({ memberId, choice }) =>
				Match.valueTags(choice, {
					Mute: ({ minutes }) =>
						Effect.flatMap(Clock.currentTimeMillis, (nowMs) =>
							update(
								minutes === null
									? { memberId, isMuted: true, mutedUntil: null }
									: {
											memberId,
											isMuted: false,
											mutedUntil: new Date(nowMs + minutes * 60_000),
										},
							),
						),
					Unmute: () => update({ memberId, isMuted: false, mutedUntil: null }),
					SetLevel: ({ level }) => update({ memberId, notificationLevel: level }),
					Unfollow: () =>
						rpc("channelMember.delete", {
							id: memberId,
							organizationId: data.hints.orgOfChannelMember(memberId),
						}),
				}).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.as(ChannelHeaderMessage.SucceededNotificationChoice({ choice })),
					// BOUNDARY: every failure reads as one of two here (the optimistic row rolls back).
					Effect.tapError((error) => Effect.logWarning("notification choice failed", error)),
					Effect.catch((error) =>
						Effect.succeed(
							ChannelHeaderMessage.FailedNotificationChoice({ reason: failureOf(error) }),
						),
					),
				)
		}),
	)
}

/** "Unhide conversation": the signed-in user's hidden DM membership comes back. */
export class UnhideConversation extends Command.Service<UnhideConversation>()(
	"hazel/chat/header/UnhideConversation",
	{ args: { memberId: ChannelMemberId }, success: ChannelHeaderMessage },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return ({ memberId }) =>
				data.actions.updateChannelMemberAction({ memberId, isHidden: false }).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.as(ChannelHeaderMessage.SucceededUnhide()),
					Effect.tapError((error) => Effect.logWarning("unhide failed", error)),
					Effect.catch((error) =>
						Effect.succeed(ChannelHeaderMessage.FailedUnhide({ reason: failureOf(error) })),
					),
				)
		}),
	)
}

/** "Follow thread" on a thread the user does not follow (its access is its parent's). */
export class FollowThread extends Command.Service<FollowThread>()("hazel/chat/header/FollowThread", {
	args: { channelId: ChannelId },
	success: ChannelHeaderMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ channelId }) =>
				rpc("channelMember.create", { channelId }).pipe(
					Effect.as(ChannelHeaderMessage.SucceededFollowThread()),
					Effect.tapError((error) => Effect.logWarning("follow thread failed", error)),
					Effect.orElseSucceed(() => ChannelHeaderMessage.FailedFollowThread()),
				)
		}),
	)
}

const toast = (intent: "success" | "error", title: string, description: string | null = null) =>
	ShowToast.make({ toast: { intent, title, description } })

const SOMETHING_WRONG = "Please try again."

/** Where the phone's back button leads: a thread's channel, the DMs tab, or the chat list. */
export const backHrefOf = (orgSlug: string, channel: HeaderChannel | null): string =>
	channel?.type === "thread" && channel.parentChannelId !== null
		? `/${orgSlug}/chat/${channel.parentChannelId}`
		: channel !== null && isDmType(channel.type)
			? `/${orgSlug}/chat/dms`
			: `/${orgSlug}/chat`

export const ChannelHeader = Hazel.component({
	name: "ChannelHeader",
	props: ChannelHeaderProps,
	model: ChannelHeaderModel,
	message: ChannelHeaderMessage,
}).make({
	init: () => ({
		channel: null,
		parent: null,
		members: null,
		inheritedLevel: null,
		presence: "offline" as const,
		customer: null,
		ownerName: null,
		sync: "none" as const,
	}),
	update: {
		UpdatedChannel: ($, { channel }) => $.evolve({ channel: () => channel }),
		UpdatedParent: ($, { channel }) => $.evolve({ parent: () => channel }),
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members }),
		UpdatedInheritedLevel: ($, { level }) => $.evolve({ inheritedLevel: () => level }),
		UpdatedPresence: ($, { presence }) => $.evolve({ presence: () => presence }),
		UpdatedCustomer: ($, { customer }) => $.evolve({ customer: () => customer }),
		UpdatedOwnerName: ($, { name }) => $.evolve({ ownerName: () => name }),
		UpdatedSync: ($, { provider }) => $.evolve({ sync: () => provider }),
		PressedBack: ($) =>
			$.run(Navigate.make({ href: backHrefOf($.props.orgSlug, $.model.channel), replace: false })),
		PressedParentCrumb: ($) =>
			$.model.channel?.parentChannelId == null
				? $.model
				: $.run(
						Navigate.make({
							href: `/${$.props.orgSlug}/chat/${$.model.channel.parentChannelId}`,
							replace: false,
						}),
					),
		SelectedBellEntry: ($, { id }) => {
			const member = currentMemberOf($.model.members ?? [], $.props.userId)
			if (member === undefined) return $.model
			const wasMuted = member.isMuted || member.mutedUntilMs !== null
			return Option.match(choiceOfKey(id, wasMuted), {
				onNone: () => $.model,
				onSome: (choice) => $.run(WriteNotificationChoice.make({ memberId: member.id, choice })),
			})
		},
		SucceededNotificationChoice: ($, { choice }) => $.run(toast("success", choiceToast(choice))),
		FailedNotificationChoice: ($, { reason }) =>
			$.run(
				reason === "MemberNotFound"
					? toast("error", "Couldn't update notifications", "You are no longer in this channel.")
					: toast("error", "Something went wrong", SOMETHING_WRONG),
			),
		PressedUnhide: ($) => {
			const member = currentMemberOf($.model.members ?? [], $.props.userId)
			return member === undefined || !member.isHidden
				? $.model
				: $.run(UnhideConversation.make({ memberId: member.id }))
		},
		SucceededUnhide: ($) => $.run(toast("success", "Conversation unhidden")),
		FailedUnhide: ($, { reason }) =>
			$.run(
				reason === "MemberNotFound"
					? toast(
							"error",
							"Couldn't unhide the conversation",
							"You may no longer be in this conversation.",
						)
					: toast("error", "Something went wrong", SOMETHING_WRONG),
			),
		PressedFollowThread: ($) =>
			$.model.channel?.type === "thread"
				? $.run(FollowThread.make({ channelId: $.props.channelId }))
				: $.model,
		SucceededFollowThread: ($) => $.run(toast("success", "Following thread")),
		FailedFollowThread: ($) => $.run(toast("error", "Couldn't follow the thread")),
	},
	subscriptions: ({ props, model }) => {
		const partner =
			model.channel === null
				? undefined
				: partnerOf(model.channel, othersOf(model.members ?? [], props.userId))
		const parentId = model.channel?.type === "thread" ? model.channel.parentChannelId : null
		const ownerId = model.customer?.ownerUserId ?? null
		return [
			Subscription.make("channel", [props.channelId], ([channelId]) =>
				channelStream(channelId, (channel) => ChannelHeaderMessage.UpdatedChannel({ channel })),
			),
			Subscription.make("parent", [parentId ?? ""], ([id]) =>
				id === ""
					? Stream.empty
					: channelStream(ChannelId.make(id), (channel) =>
							ChannelHeaderMessage.UpdatedParent({ channel }),
						),
			),
			Subscription.make("members", [props.channelId], ([channelId]) =>
				membersStream(channelId, (members) => ChannelHeaderMessage.UpdatedMembers({ members })),
			),
			Subscription.make("inherited", [props.channelId], ([channelId]) =>
				inheritedLevelStream(channelId, (level) =>
					ChannelHeaderMessage.UpdatedInheritedLevel({ level }),
				),
			),
			Subscription.make("presence", [partner?.userId ?? ""], ([userId]) =>
				userId === ""
					? Stream.empty
					: presenceStream(UserId.make(userId), (presence) =>
							ChannelHeaderMessage.UpdatedPresence({ presence }),
						),
			),
			Subscription.make("customer", [props.channelId], ([channelId]) =>
				customerStream(channelId, (customer) => ChannelHeaderMessage.UpdatedCustomer({ customer })),
			),
			Subscription.make("owner", [ownerId ?? ""], ([userId]) =>
				userId === ""
					? Stream.empty
					: ownerNameStream(UserId.make(userId), (name) =>
							ChannelHeaderMessage.UpdatedOwnerName({ name }),
						),
			),
			Subscription.make("sync", [props.channelId], ([channelId]) =>
				syncStream(channelId, (provider) => ChannelHeaderMessage.UpdatedSync({ provider })),
			),
		]
	},
	view: (h, model) => {
		const props = h.props
		const { channel } = model
		const members = model.members ?? []
		const current = currentMemberOf(members, props.userId)
		const isMember = current !== undefined
		const isThread = channel?.type === "thread"
		const isDm = channel !== null && isDmType(channel.type)
		const others = othersOf(members, props.userId)

		const title = channel === null ? "" : isDm ? dmTitleOf(others) : channel.name
		// HAZEL-GAP(p4-screen-leading, p4-screen-chat-header): today's title leads with the channel icon (with its customer
		// and sync marks), a DM partner's avatar and presence, or a thread mark.
		const crumbs =
			isThread && !props.isMobile && model.parent !== null && channel?.parentChannelId != null
				? [{ label: model.parent.name, href: `/${props.orgSlug}/chat/${channel.parentChannelId}` }]
				: undefined

		const bell = (member: HeaderMember, type: string) =>
			h.menu
				.key("bell")
				.label(bellLabelOf(member, type, props.nowMs))
				.entries(
					bellEntries({
						isMuted: isMemberMutedNow(member, props.nowMs),
						level: member.notificationLevel,
						inheritedLevel:
							model.inheritedLevel ??
							(isDmType(type) || type === "thread" ? "all" : "mentions"),
						channelType: type,
					}),
				)
				.trigger(
					h.button
						.label(bellLabelOf(member, type, props.nowMs))
						.icon(isMemberMutedNow(member, props.nowMs) ? "bell-off" : "bell")
						.iconOnly()
						.variant("ghost")
						.size("small"),
				)
				.on("select", ({ id }) => ChannelHeaderMessage.SelectedBellEntry({ id }))

		const unhide =
			isDm && current?.isHidden === true
				? h.button
						.key("unhide")
						.label("Unhide conversation")
						.icon("eye")
						.iconOnly()
						.variant("ghost")
						.size("small")
						.on("press", ChannelHeaderMessage.PressedUnhide())
				: undefined
		const follow =
			channel !== null && !isMember && isThread && model.members !== null
				? h.button
						.key("follow")
						.label("Follow thread")
						.variant("outline")
						.size("small")
						.on("press", ChannelHeaderMessage.PressedFollowThread())
				: undefined
		const toolbar =
			channel === null
				? []
				: !isMember
					? [follow]
					: [
							unhide,
							bell(current, channel.type),
							PinnedMessages(h, { key: channel.id, props: { channelId: channel.id } }),
						]

		const customer = model.customer
		const chip =
			customer === null || channel === null || !isMember || isDm || isThread
				? undefined
				: CustomerCard(h, {
						key: customer.accountId,
						props: {
							customer,
							ownerName: model.ownerName,
							customerHref: `/${props.orgSlug}/customers/${customer.accountId}`,
							queueHref: `/${props.orgSlug}/customers/attention`,
							nowMs: props.nowMs,
							isMobile: props.isMobile,
						},
					})

		return h.screen
			.title(title)
			.surface("page")
			.back(props.isMobile)
			.crumbs(crumbs)
			.toolbar(...toolbar)
			.meta(chip)
			.on("back", ChannelHeaderMessage.PressedBack())
			.on("crumb", () => ChannelHeaderMessage.PressedParentCrumb())
	},
})

/** What a host provides: its data instance, the RPC client, and the channel page's own requests. */
export const channelHeaderLayer = (
	data: ClientData["Service"],
	rpc: HazelRpc["Service"],
	page: {
		readonly jumpToMessage: (messageId: MessageId) => void
		readonly pinsHotkey: Stream.Stream<void>
	},
) =>
	Layer.mergeAll(
		WriteNotificationChoice.layer,
		UnhideConversation.layer,
		FollowThread.layer,
		pinnedMessagesLayer(page.jumpToMessage, page.pinsHotkey),
	).pipe(Layer.provideMerge(Layer.mergeAll(Layer.succeed(ClientData, data), Layer.succeed(HazelRpc, rpc))))
