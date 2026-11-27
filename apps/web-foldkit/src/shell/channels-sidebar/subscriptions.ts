import { ChannelId, ChannelSectionId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import * as Data from "./data"
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

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
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
	sidebarChannelCustomers: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: (model) => ({ organizationId: model.organizationId }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: Data.channelCustomersStream(organizationId, (customers) =>
							Message.UpdatedChannelCustomers({ customers }),
						),
		},
	),
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
	sidebarConnectMounts: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: (model) => ({ organizationId: model.organizationId }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: Stream.merge(
							Stream.merge(
								People.connectMountsStream((mounts) =>
									Message.UpdatedConnectMounts({ mounts }),
								),
								People.organizationsStream((organizations) =>
									Message.UpdatedOrganizations({ organizations }),
								),
							),
							People.syncedChannelsStream((synced) =>
								Message.UpdatedSyncedChannels({ synced }),
							),
						),
		},
	),
}))

/**
 * The organization's unread channels, on every page of it: the tab title's dot (`platform/badge.ts`)
 * reads them, so they do not wait for the chat sidebar to be shown.
 */
export const badgeSubscriptions = Subscription.make<Model, Message>()((entry) => ({
	sidebarUnreadChannels: entry(Scope, {
		modelToDependencies: scopeOf,
		dependenciesToStream: scoped((organizationId, userId) =>
			Data.unreadChannelsStream(organizationId, userId, (channels) =>
				Message.UpdatedUnreadChannels({ channels }),
			),
		),
	}),
}))
