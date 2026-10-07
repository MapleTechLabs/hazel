import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as CommandMenu from "../../ui/command-menu"
import { RecentSearch, SearchAutocomplete, SearchData, SearchFilter, Suggestion } from "./search-data"

export { FilterType, SearchFilter } from "./search-data"

/** Legacy `atoms/command-palette-state.ts`: open state, the current page and the back stack. */

export const Page = Schema.Literals(["home", "search", "join-channel", "create-channel", "status", "appearance"])
export type Page = typeof Page.Type

export const ChannelType = Schema.Literals(["public", "private"])
export type ChannelType = typeof ChannelType.Type

/** One variant per page; list pages keep their input value for the back stack. */
export const PageState = Schema.Union([
	Schema.TaggedStruct("Home", { inputValue: Schema.String }),
	Schema.TaggedStruct("Search", {
		query: Schema.String,
		rawInput: Schema.String,
		filters: Schema.Array(SearchFilter),
		selectedIndex: Schema.Number,
	}),
	Schema.TaggedStruct("Status", { inputValue: Schema.String }),
	Schema.TaggedStruct("Appearance", { inputValue: Schema.String }),
	Schema.TaggedStruct("CreateChannel", {
		name: Schema.String,
		channelType: ChannelType,
		error: Schema.NullOr(Schema.String),
		isSubmitting: Schema.Boolean,
	}),
	Schema.TaggedStruct("JoinChannel", { searchQuery: Schema.String }),
])
export type PageState = typeof PageState.Type

const initialPageStates: Readonly<Record<Page, PageState>> = {
	home: { _tag: "Home", inputValue: "" },
	search: { _tag: "Search", query: "", rawInput: "", filters: [], selectedIndex: 0 },
	status: { _tag: "Status", inputValue: "" },
	appearance: { _tag: "Appearance", inputValue: "" },
	"create-channel": { _tag: "CreateChannel", name: "", channelType: "public", error: null, isSubmitting: false },
	"join-channel": { _tag: "JoinChannel", searchQuery: "" },
}

/** `initialPageStates[page]`: a fresh page, as `navigateTo` and `open` create it. */
export const initialPageState = (page: Page): PageState => initialPageStates[page]

/** `isFormPage`: these render their own header and body instead of the search field and list. */
export const isFormPage = (page: PageState) =>
	page._tag === "CreateChannel" || page._tag === "JoinChannel" || page._tag === "Search"

// DATA (live query results the open pages read)

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

export const Theme = Schema.Literals(["system", "light", "dark"])
export type Theme = typeof Theme.Type

export const Model = Schema.Struct({
	isOpen: Schema.Boolean,
	page: PageState,
	history: Schema.Array(PageState),
	/** The list pages' Autocomplete + Menu (search value, focused and hovered item). */
	menu: CommandMenu.Model,
	channels: Schema.Array(ChannelSummary),
	dmChannels: Schema.Array(DmChannel),
	recentChannelIds: Schema.Array(Schema.String),
	recentChannels: Schema.Array(ChannelSummary),
	/** `userChannels` (every channel the user is a member of), the join page's first query. */
	memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
	unjoinedChannels: Schema.NullOr(Schema.Array(ChannelSummary)),
	presenceStatus: Schema.String,
	theme: Theme,
	search: SearchData,
	/** `recentSearchesAtom` (platform storage), loaded when the search page opens. */
	recentSearches: Schema.Array(RecentSearch),
	searchAutocomplete: Schema.NullOr(SearchAutocomplete),
	suggestionIndex: Schema.Number,
	suggestions: Schema.Array(Suggestion),
})
export type Model = typeof Model.Type
