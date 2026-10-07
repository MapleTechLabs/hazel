import { ChannelId, ChannelSectionId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import * as Data from "./data"
import { dmPartners } from "./items"
import { Message, type Model } from "./model"
import * as People from "./people-data"

// SUBSCRIPTION

const Scope = { organizationId: Schema.NullOr(OrganizationId), currentUserId: Schema.NullOr(UserId) }
const scopeOf = (model: Model) => ({
	organizationId: model.organizationId,
	currentUserId: model.currentUserId,
})

/** Runs `stream` once both the organization and the signed-in user are known. */
const scoped =
	<A>(stream: (organizationId: OrganizationId, userId: UserId) => Stream.Stream<A>) =>
	(dependencies: { organizationId: OrganizationId | null; currentUserId: UserId | null }) =>
		dependencies.organizationId === null || dependencies.currentUserId === null
			? Stream.empty
			: stream(dependencies.organizationId, dependencies.currentUserId)

/** DM rows render favorites' DMs too, so both lists need `useChannelWithCurrentUser`. */
const dmDetailIds = (model: Model): Array<ChannelId> => [
	...model.dmChannelIds,
	...model.favorites
		.filter((entry) => entry.channel.type === "direct" || entry.channel.type === "single")
		.map((entry) => entry.channel.id),
]

const partnerUserIds = (model: Model): Array<UserId> =>
	[
		...new Set(
			Object.values(model.dmChannels).flatMap((channel) =>
				channel ? dmPartners(channel, model.currentUserId).map((member) => member.userId) : [],
			),
		),
	].sort()

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	sidebarPresenceClock: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () =>
				Stream.concat(Stream.succeed(undefined), Stream.tick("5 seconds")).pipe(
					Stream.map(() => Message.TickedPresenceClock({ nowMs: Date.now() })),
				),
		},
	),
	sidebarMembership: entry(Scope, {
		modelToDependencies: scopeOf,
		dependenciesToStream: scoped((organizationId, userId) =>
			People.membershipStream(organizationId, userId, (membership) =>
				Message.UpdatedMembership({ membership }),
			),
		),
	}),
	sidebarUnreadCounts: entry(
		{ memberId: Schema.NullOr(OrganizationMemberId) },
		{
			modelToDependencies: (model) => ({ memberId: model.membership?.id ?? null }),
			dependenciesToStream: ({ memberId }) =>
				memberId === null
					? Stream.empty
					: People.unreadCountsStream(memberId, (counts) =>
							Message.UpdatedUnreadCounts({ counts }),
						),
		},
	),
	sidebarSections: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: (model) => ({ organizationId: model.organizationId }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: Data.sectionsStream(organizationId, (sections) =>
							Message.UpdatedSections({ sections }),
						),
		},
	),
	sidebarSectionChannels: entry(
		{ ...Scope, sectionIds: Schema.Array(ChannelSectionId) },
		{
			modelToDependencies: (model) => ({
				...scopeOf(model),
				sectionIds: model.sections.map((section) => section.id),
			}),
			dependenciesToStream: ({ sectionIds, ...scope }) =>
				scoped((organizationId, userId) =>
					Stream.mergeAll(
						[null, ...sectionIds].map((sectionId) =>
							Data.sectionChannelsStream(organizationId, userId, sectionId, (channels) =>
								Message.UpdatedSectionChannels({
									sectionKey: sectionId ?? "default",
									channels,
								}),
							),
						),
						{ concurrency: "unbounded" },
					),
				)(scope),
		},
	),
	sidebarFavorites: entry(Scope, {
		modelToDependencies: scopeOf,
		dependenciesToStream: scoped((organizationId, userId) =>
			Data.favoritesStream(organizationId, userId, (channels) =>
				Message.UpdatedFavorites({ channels }),
			),
		),
	}),
	sidebarDmChannelIds: entry(Scope, {
		modelToDependencies: scopeOf,
		dependenciesToStream: scoped((organizationId, userId) =>
			Data.dmChannelIdsStream(organizationId, userId, (channelIds) =>
				Message.UpdatedDmChannelIds({ channelIds }),
			),
		),
	}),
	sidebarDmChannels: entry(
		{ currentUserId: Schema.NullOr(UserId), channelIds: Schema.Array(ChannelId) },
		{
			modelToDependencies: (model) => ({
				currentUserId: model.currentUserId,
				channelIds: dmDetailIds(model),
			}),
			dependenciesToStream: ({ currentUserId, channelIds }) =>
				currentUserId === null
					? Stream.empty
					: People.dmChannelsStream(channelIds, currentUserId, (channelId, channel) =>
							Message.UpdatedDmChannel({ channelId, channel }),
						),
		},
	),
	sidebarPresence: entry(
		{ userIds: Schema.Array(UserId) },
		{
			modelToDependencies: (model) => ({ userIds: partnerUserIds(model) }),
			dependenciesToStream: ({ userIds }) =>
				userIds.length === 0
					? Stream.empty
					: People.presenceStream(userIds, (presence) => Message.UpdatedPresence({ presence })),
		},
	),
	sidebarConnectMounts: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: (model) => ({ organizationId: model.organizationId }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: Stream.merge(
							People.connectMountsStream((mounts) => Message.UpdatedConnectMounts({ mounts })),
							People.organizationsStream((organizations) =>
								Message.UpdatedOrganizations({ organizations }),
							),
						),
		},
	),
	sidebarMemberChannelIds: entry(Scope, {
		modelToDependencies: scopeOf,
		dependenciesToStream: scoped((organizationId, userId) =>
			Data.memberChannelIdsStream(organizationId, userId, (channelIds) =>
				Message.UpdatedMemberChannelIds({ channelIds }),
			),
		),
	}),
	// The list is hidden at three or more memberships, so the query only runs below that.
	sidebarDiscoverableChannels: entry(
		{
			organizationId: Schema.NullOr(OrganizationId),
			memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
		},
		{
			modelToDependencies: (model) => ({
				organizationId: model.organizationId,
				memberChannelIds:
					model.memberChannelIds !== null && model.memberChannelIds.length < 3
						? model.memberChannelIds
						: null,
			}),
			dependenciesToStream: ({ organizationId, memberChannelIds }) =>
				organizationId === null || memberChannelIds === null
					? Stream.empty
					: Data.discoverableChannelsStream(organizationId, memberChannelIds, (channels) =>
							Message.UpdatedDiscoverableChannels({ channels }),
						),
		},
	),
}))
