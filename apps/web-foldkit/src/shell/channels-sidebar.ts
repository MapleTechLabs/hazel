import type { OrganizationId, UserId } from "@hazel/schema"
import { modifyFields } from "foldkit/struct"
import { emptyData, Message, type Model } from "./channels-sidebar/model"

/**
 * The organization's channel data the host still reads (`channels-sidebar/model.ts`): the list
 * itself is the shell's (`shared-screens/src/channel-sidebar/`, docked by `root/sections.ts`).
 */

export { Message, Model } from "./channels-sidebar/model"

export const init = (): Model => ({ organizationId: null, currentUserId: null, ...emptyData })

export const update = (model: Model, message: Message): Model =>
	Message.match<Model>(message, {
		UpdatedMembership: ({ membership }) => modifyFields(model, { membership: () => membership }),
		UpdatedSections: ({ sections }) =>
			modifyFields(model, {
				sections: () => sections,
				loaded: () => modifyFields(model.loaded, { sections: () => true }),
			}),
		UpdatedSectionChannels: ({ sectionKey, channels }) =>
			modifyFields(model, { sectionChannels: (previous) => ({ ...previous, [sectionKey]: channels }) }),
		UpdatedFavorites: ({ channels }) =>
			modifyFields(model, {
				favorites: () => channels,
				loaded: () => modifyFields(model.loaded, { favorites: () => true }),
			}),
		UpdatedChannelCustomers: ({ customers }) =>
			modifyFields(model, {
				channelCustomers: () => customers,
				loaded: () => modifyFields(model.loaded, { channelCustomers: () => true }),
			}),
		UpdatedDmChannelIds: ({ channelIds }) =>
			modifyFields(model, {
				dmChannelIds: () => channelIds,
				loaded: () => modifyFields(model.loaded, { dmChannelIds: () => true }),
			}),
		UpdatedDmChannel: ({ channelId, channel }) =>
			modifyFields(model, { dmChannels: (previous) => ({ ...previous, [channelId]: channel }) }),
		UpdatedUnreadCounts: ({ counts }) => modifyFields(model, { unreadCounts: () => counts }),
		UpdatedUnreadChannels: ({ channels }) => modifyFields(model, { unreadChannels: () => channels }),
		UpdatedConnectMounts: ({ mounts }) => modifyFields(model, { connectMounts: () => mounts }),
		UpdatedOrganizations: ({ organizations }) =>
			modifyFields(model, { organizations: () => organizations }),
		UpdatedSyncedChannels: ({ synced }) => modifyFields(model, { syncedChannels: () => synced }),
	})

/** The data belongs to one organization and user; another pair starts it empty. */
export const setContext = (
	model: Model,
	context: { readonly organizationId: OrganizationId | null; readonly currentUserId: UserId | null },
): Model =>
	model.organizationId === context.organizationId && model.currentUserId === context.currentUserId
		? model
		: { ...model, ...emptyData, ...context }

export { badgeSubscriptions, subscriptions } from "./channels-sidebar/subscriptions"
