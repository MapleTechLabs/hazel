// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The command palette as one of the shell's children (`shared-screens/src/palette`): the app's pages
 * it jumps to, where its recents live on the web, and its Layers. The shell opens it (keys, the tab
 * bar, native pages, and the Foldkit host's requests) and stops drawing it when it asks to close.
 */
import { Component } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { CommandPalette, PaletteStorage } from "@hazel/shared-screens/palette/CommandPalette"
import { type PaletteDestination, RecentSearch } from "@hazel/shared-screens/palette/model"
import { ChannelId } from "@hazel/schema"
import type { IconName } from "@hazel/ui/vocabulary/index"
import { Clock, Effect, Layer, Option, Schema } from "effect"
import { clientData } from "~/db/client"
import type { Platform } from "~/lib/keybindings/key-combo"
import { readStored, writeStored } from "../data/storage"
import { comboLabel as hotkeyLabel } from "~/lib/keybindings/key-combo"
import {
	availableDestinations,
	DESTINATION_GROUPS,
	type DestinationId,
	destinationHref,
} from "../shell/destinations"

/** Each page's icon in the hazel set (the same glyphs as `destinations.ts`'s Foldkit icons). */
const ICONS = {
	home: "dashboard",
	chat: "messages",
	customers: "office",
	notifications: "bell",
	settings: "gear",
	notificationsUnreads: "chat",
	notificationsAll: "envelope",
	customersOverview: "presentation",
	customersAttention: "warning",
	customersInbox: "support",
	customersSupportReport: "chart",
	customersList: "office",
	customersSignals: "lightbulb",
	customersSla: "clock",
	customersPlans: "cube",
	customersFeatureFlags: "rocket",
	customersSources: "servers",
	settingsGeneral: "gear",
	settingsTeam: "users",
	settingsGroups: "profiles",
	settingsInvitations: "user-plus",
	settingsCustomEmojis: "emoji-add",
	settingsIntegrations: "integration",
	settingsMarketplace: "shop",
	settingsInstalledApps: "apps",
	settingsYourApps: "code",
	settingsConnectInvites: "refresh",
	settingsChatSync: "refresh",
	settingsDebug: "servers",
	myAppearance: "paintbrush",
	myProfile: "user",
	myLinkedAccounts: "refresh",
	myAgents: "sparkles",
	myNotifications: "bell",
	myKeybinds: "keyboard",
	myDesktop: "cube",
} as const satisfies { readonly [Id in DestinationId]: IconName }

/** The pages of this build in `orgSlug`, by palette group; the pinned group shows before typing. */
export const paletteDestinations = (orgSlug: string): ReadonlyArray<PaletteDestination> =>
	DESTINATION_GROUPS.flatMap((group) =>
		availableDestinations(group.ids).map((page) => ({
			id: page.id,
			label: page.label,
			group: group.title,
			keywords: [page.sidebarLabel ?? "", page.keywords ?? ""].join(" ").trim(),
			icon: ICONS[page.id],
			href: destinationHref(page.id, orgSlug),
			pinned: group.isPinned === true,
		})),
	)

/** Today's key hints: the actions' default keys, and the AI panel's as the user bound it. */
export const paletteShortcuts = (aiPanelKey: string | null, platform: Platform) => ({
	search: hotkeyLabel("Mod+Shift+F", platform),
	createChannel: hotkeyLabel("Mod+Alt+N", platform),
	createDm: hotkeyLabel("Mod+Alt+D", platform),
	invite: hotkeyLabel("Mod+Alt+I", platform),
	aiPanel: aiPanelKey === null ? null : hotkeyLabel(aiPanelKey, platform),
})

// RECENTS (the keys and encodings today's palette used, so saved recents still load)

const RECENT_CHANNELS_KEY = "recentChannels"
const MAX_RECENT_CHANNELS = 8
const RecentChannels = Schema.Array(Schema.Struct({ channelId: Schema.String, visitedAt: Schema.Finite }))
const decodeRecentChannels = Schema.decodeUnknownOption(Schema.fromJsonString(RecentChannels))
const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

/** The stored `recentChannels`, empty when missing or unreadable. */
const readRecentChannels = Effect.try(() => localStorage.getItem(RECENT_CHANNELS_KEY)).pipe(
	Effect.map((raw) => (raw === null ? [] : Option.getOrElse(decodeRecentChannels(raw), () => []))),
	Effect.orElseSucceed(() => []),
)

const RECENT_SEARCHES_KEY = "recentSearches"
const RecentSearches = Schema.Array(RecentSearch)

const paletteStorage = Layer.succeed(PaletteStorage, {
	recentChannelIds: readRecentChannels.pipe(
		Effect.map((channels) =>
			channels.flatMap((entry) =>
				Option.match(decodeChannelId(entry.channelId), { onNone: () => [], onSome: (id) => [id] }),
			),
		),
	),
	// Newest first, at most eight. Best effort: a full or blocked store only loses the list.
	trackChannel: (channelId) =>
		Effect.zipWith(readRecentChannels, Clock.currentTimeMillis, (channels, visitedAt) =>
			[{ channelId, visitedAt }, ...channels.filter((entry) => entry.channelId !== channelId)].slice(
				0,
				MAX_RECENT_CHANNELS,
			),
		).pipe(
			Effect.flatMap((channels) =>
				Effect.try(() => localStorage.setItem(RECENT_CHANNELS_KEY, JSON.stringify(channels))),
			),
			Effect.ignore,
		),
	recentSearches: readStored(RECENT_SEARCHES_KEY, RecentSearches).pipe(
		Effect.map((stored) => Option.getOrElse(stored, () => [])),
	),
	// Best effort: an unsaved recent search is only missing next time.
	saveRecentSearches: (searches) =>
		writeStored(RECENT_SEARCHES_KEY, RecentSearches, searches).pipe(
			Effect.catchTag("StorageWriteError", () => Effect.void),
		),
})

/** The palette on the app's data instance and the web's storage; RPC and requests come from the shell. */
export const ShellCommandPalette = Component.provide(
	CommandPalette,
	Layer.mergeAll(Layer.succeed(ClientData, clientData), paletteStorage),
)
