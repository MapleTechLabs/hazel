/**
 * The command palette's data: its pages, what the live queries deliver, and what the host passes in
 * (`web-foldkit/src/overlay/command-palette/model.ts`, now deleted, had the same shapes).
 */
import {
	ChannelId,
	CustomerAccountId,
	CustomerContactId,
	MessageId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { IconName, TextField } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"
import { PalettePage, ThemePreference } from "../app/requests"

export const ChannelType = Schema.Literals(["public", "private"])
export type ChannelType = typeof ChannelType.Type

export const FilterType = Schema.Literals(["from", "in", "has", "before", "after"])
export type FilterType = typeof FilterType.Type

/** One search filter (`lib/search-filter-parser.ts`), as the recent searches store it. */
export const SearchFilter = Schema.Struct({
	type: FilterType,
	value: Schema.String,
	displayValue: Schema.String,
	id: Schema.String,
})
export type SearchFilter = typeof SearchFilter.Type

export const RecentSearch = Schema.Struct({
	query: Schema.String,
	filters: Schema.Array(SearchFilter),
	timestamp: Schema.Finite,
})
export type RecentSearch = typeof RecentSearch.Type

/** One page each; the list pages keep their query for the back stack. */
export const PageState = Schema.Union([
	Schema.TaggedStruct("Home", { query: Schema.String }),
	Schema.TaggedStruct("Search", { filters: Schema.Array(SearchFilter) }),
	Schema.TaggedStruct("Status", { query: Schema.String }),
	Schema.TaggedStruct("Appearance", { query: Schema.String }),
	Schema.TaggedStruct("CreateChannel", {
		name: TextField.State,
		channelType: ChannelType,
		error: Schema.NullOr(Schema.String),
		isSubmitting: Schema.Boolean,
	}),
	Schema.TaggedStruct("JoinChannel", { search: TextField.State }),
])
export type PageState = typeof PageState.Type

export const initialPageState = (page: PalettePage): PageState =>
	Match.value(page).pipe(
		Match.withReturnType<PageState>(),
		Match.when("home", () => ({ _tag: "Home", query: "" })),
		Match.when("search", () => ({ _tag: "Search", filters: [] })),
		Match.when("status", () => ({ _tag: "Status", query: "" })),
		Match.when("appearance", () => ({ _tag: "Appearance", query: "" })),
		Match.when("create-channel", () => ({
			_tag: "CreateChannel",
			name: TextField.empty,
			channelType: "public",
			error: null,
			isSubmitting: false,
		})),
		Match.when("join-channel", () => ({ _tag: "JoinChannel", search: TextField.empty })),
		Match.exhaustive,
	)

/** Create and join draw their own body under a title; the rest are the field over results. */
export const isFormPage = (page: PageState) => page._tag === "CreateChannel" || page._tag === "JoinChannel"

export const ChannelSummary = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.String,
	icon: Schema.NullOr(Schema.String),
})
export type ChannelSummary = typeof ChannelSummary.Type

export const DmMember = Schema.Struct({
	userId: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type DmMember = typeof DmMember.Type

export const DmChannel = Schema.Struct({
	id: ChannelId,
	type: Schema.String,
	otherMembers: Schema.Array(DmMember),
})
export type DmChannel = typeof DmChannel.Type

export const CustomerSummary = Schema.Struct({
	id: CustomerAccountId,
	name: Schema.String,
	domains: Schema.Array(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
	environment: Schema.NullOr(Schema.String),
})
export type CustomerSummary = typeof CustomerSummary.Type

export const CustomerUserSummary = Schema.Struct({
	id: CustomerContactId,
	accountId: CustomerAccountId,
	name: Schema.NullOr(Schema.String),
	email: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
})
export type CustomerUserSummary = typeof CustomerUserSummary.Type

/** One message the search page lists: a loaded row, or a server hit's snippet. */
export const SearchResult = Schema.Struct({
	messageId: MessageId,
	channelId: ChannelId,
	content: Schema.String,
	createdAtMs: Schema.Finite,
	authorName: Schema.String,
	authorAvatarUrl: Schema.NullOr(Schema.String),
	channelName: Schema.NullOr(Schema.String),
	attachmentCount: Schema.Finite,
})
export type SearchResult = typeof SearchResult.Type

/** A `from:`, `in:` or `has:` value the typed filter can become. */
export const Suggestion = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	kind: Schema.Literals(["user", "channel", "has"]),
})
export type Suggestion = typeof Suggestion.Type

/** A page of the app the palette jumps to (the host's `shell/destinations.ts`, resolved to hrefs). */
export const PaletteDestination = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	group: Schema.String,
	/** Extra words matched besides the label and the group. */
	keywords: Schema.String,
	icon: IconName,
	href: Schema.String,
	/** Shown before anything is typed; the rest only as results. */
	pinned: Schema.Boolean,
})
export type PaletteDestination = typeof PaletteDestination.Type

export const PaletteProps = Schema.Struct({
	/** The page it opens on; the host mounts a fresh palette for each open. */
	page: PalettePage,
	/** Closed, it stays mounted until the next open, so the Commands of its last pick still run. */
	open: Schema.Boolean,
	organizationId: OrganizationId,
	userId: UserId,
	orgSlug: Schema.String,
	theme: ThemePreference,
	destinations: Schema.Array(PaletteDestination),
	/** The quick actions' key hints as the platform labels them (`⇧⌘F`); none for an unbound key. */
	shortcuts: Schema.Struct({
		search: Schema.String,
		createChannel: Schema.String,
		createDm: Schema.String,
		invite: Schema.String,
		aiPanel: Schema.NullOr(Schema.String),
	}),
	nowMs: Schema.Finite,
})
export type PaletteProps = typeof PaletteProps.Type

export const PaletteModel = Schema.Struct({
	page: PageState,
	history: Schema.Array(PageState),
	/** The field's text on the list pages (and the search page's query with any typed filter). */
	query: TextField.State,
	channels: Schema.Array(ChannelSummary),
	dmChannels: Schema.Array(DmChannel),
	customers: Schema.Array(CustomerSummary),
	recentChannelIds: Schema.Array(ChannelId),
	recentChannels: Schema.Array(ChannelSummary),
	memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
	unjoinedChannels: Schema.NullOr(Schema.Array(ChannelSummary)),
	presenceStatus: Schema.String,
	recentSearches: Schema.Array(RecentSearch),
	suggestions: Schema.Array(Suggestion),
	/** The loaded channels' matches; the server's hits are the `serverResults` query. */
	localResults: Schema.Array(SearchResult),
})
export type PaletteModel = typeof PaletteModel.Type
