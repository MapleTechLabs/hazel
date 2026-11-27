import { Schema } from "effect"
import * as AiPanel from "../assistant"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import type { PageHost, Shared } from "../page/contract"
import { can } from "../page/contract"
import { assistantContextOf, PageSlot } from "../page/registry"
import { orgSectionOf, orgSlugOf } from "../route"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import * as Platform from "../platform"
import { type Badge, badgeOf } from "../platform/badge"
import * as Updates from "../platform/updates"
import * as Shell from "../shell/model"
import { channelLinksOf } from "../shell/channels-sidebar/channel-links"
import type { Context as ShellUpdateContext } from "../shell/update"
import { HostContextSchema, type HostReport } from "./context"
import type { OrganizationId, UserId } from "@hazel/schema"

/**
 * The Foldkit host's Model: what the Effect UI shell tells it (`context`), and the Foldkit parts it
 * still owns (the page, the sidebar's menus and data, the modal, the palette, the AI panel).
 */
export const Model = Schema.Struct({
	context: HostContextSchema,
	page: Schema.NullOr(PageSlot),
	/** Page instances built so far: numbers the next one (`page/contract.ts`). */
	pageInstances: Schema.Int,
	shell: Shell.Model,
	modal: Modal.Model,
	commandPalette: CommandPalette.Model,
	/** The AI side panel (`assistant/`). */
	aiPanel: AiPanel.Model,
	/** The toaster: the shell raises toasts, the Foldkit kit still draws them. */
	toasts: Toasts.Model,
	/** Presence (legacy `PresenceProvider`). */
	platform: Platform.Model,
	/** The desktop app's update check and install. */
	desktopUpdate: Updates.Model,
	/** The `channel.createDm` requests in flight, by `dmRequestKey`; a repeat of one is ignored. */
	creatingDms: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type

/** The tab title's, favicon's and desktop icon's badge (`platform/badge.ts`). */
export const badgeOfModel = (model: Model): Badge =>
	badgeOf({
		unreadMentionIds: model.context.unreadMentionIds,
		optimisticReadIds: model.shell.notifications.optimisticReadIds,
		unreadChannels: model.shell.channelsSidebar.unreadChannels,
		nowMs: model.context.nowMs,
	})

export const isOverlayOpenOf = (model: Model): boolean =>
	model.modal.current !== null || model.commandPalette.isOpen || model.context.isPaletteOpen

/** What the shell's frame shows from here. */
export const reportOf = (model: Model): HostReport => ({
	isOverlayOpen: isOverlayOpenOf(model),
	isSidebarCollapsed: model.shell.isSidebarCollapsed,
	// The bell counts unread mentions, as the tab title does (`isMentionReason`); no optimistic layer.
	bellCount: model.shell.notifications.unreadMentionIds.length,
	badge: badgeOfModel(model),
	isAiPanelOpen: model.aiPanel.isOpen,
	isAiPanelResizing: model.aiPanel.drag !== null,
})

/** One DM request: the member, in an org. */
export const dmRequestKey = (organizationId: OrganizationId, userId: UserId): string =>
	`${organizationId}:${userId}`

/**
 * Per Model: the Model never changes in place, and every page Subscription reads the page host on
 * every Message (hundreds of reads of the same Model, each resolving the keymap).
 */
const sharedCache = new WeakMap<Model, Shared>()
const pageHostCache = new WeakMap<Model, PageHost>()

export const sharedOf = (model: Model): Shared => {
	const cached = sharedCache.get(model)
	if (cached !== undefined) return cached
	const shared = computeShared(model)
	sharedCache.set(model, shared)
	return shared
}

const computeShared = (model: Model): Shared => {
	const { context } = model
	return {
		auth: context.auth,
		orgSlug: orgSlugOf(context.route) ?? null,
		currentUser: context.currentUser,
		organization: context.organization,
		member: context.member,
		nowMs: context.nowMs,
		isMobile: context.isMobile,
		theme: { ...context.themePreference, resolved: context.resolvedTheme },
		soundSettings: context.soundSettings,
		keys: appKeymap.resolve(context.keybindingOverrides, context.keyboardPlatform),
		keybindingOverrides: context.keybindingOverrides,
		keyboardPlatform: context.keyboardPlatform,
		desktopUpdate: model.desktopUpdate,
		isOverlayOpen: isOverlayOpenOf(model),
		channelLinks: channelLinksOf(model.shell.channelsSidebar),
	}
}

export const pageHostOf = (model: Model): PageHost => {
	const cached = pageHostCache.get(model)
	if (cached !== undefined) return cached
	const host = { page: model.page, shared: sharedOf(model) }
	pageHostCache.set(model, host)
	return host
}

/** What the AI panel reads: the shared state, and what the page shows (else its route). */
export const aiPanelInputsOf = (model: Model): AiPanel.Inputs => {
	const shared = sharedOf(model)
	return {
		shared,
		context: assistantContextOf(model.page, shared) ?? AiPanel.routeContextOf(model.context.route),
	}
}

export const shellContextOf = (model: Model): ShellUpdateContext => ({
	orgSlug: orgSlugOf(model.context.route) ?? null,
	isChatSection: orgSectionOf(model.context.route) === "Chat",
	canCreateChannel: can(sharedOf(model), "channel.create"),
	organizationId: model.context.organization?.id ?? null,
	currentUserId: model.context.currentUser?.id ?? null,
	isMobile: model.context.isMobile,
})
