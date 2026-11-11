import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as CommandMenu from "../../ui/command-menu"
import { ModalRequest } from "../modal"
import { ToastRequest } from "../toasts"
import { PresenceStatus } from "../../platform/presence/model"
import { ThemePreference } from "../../theme"
import { ChannelSummary, ChannelType, DmChannel } from "./model"
import { RecentSearch, SearchAutocomplete, SearchData, Suggestion } from "./search-data"

/** What can go wrong joining a channel, beyond the shared reasons. */
export const JoinChannelFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type JoinChannelFailure = typeof JoinChannelFailure.Type

/** The search page's editor is gone (the page closed before the Command ran). */
export const SearchEditorFailure = Schema.Literals(["EditorNotMounted"])

export const Message = defineMessageUnion({
	GotMenuMessage: { message: CommandMenu.Message },
	ClickedBack: {},
	ClickedEscButton: {},
	UpdatedChannels: { channels: Schema.Array(ChannelSummary) },
	UpdatedDmChannels: { dmChannels: Schema.Array(DmChannel) },
	UpdatedRecentChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedRecentChannels: { channels: Schema.Array(ChannelSummary) },
	UpdatedMemberChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedUnjoinedChannels: { channels: Schema.Array(ChannelSummary) },
	UpdatedPresenceStatus: { status: Schema.String },
	ChangedChannelName: { value: Schema.String },
	ChangedChannelType: { value: ChannelType },
	SubmittedCreateChannel: {},
	SucceededCreateChannel: { channelId: ChannelId },
	FailedCreateChannel: { reason: CommonReason },
	ChangedJoinSearch: { value: Schema.String },
	ClickedJoinChannel: { channelId: ChannelId },
	SucceededJoinChannel: {},
	FailedJoinChannel: { reason: JoinChannelFailure },
	// Search page
	EditedSearch: { text: Schema.String, autocomplete: Schema.NullOr(SearchAutocomplete) },
	PressedSearchKey: { key: Schema.Literals(["ArrowDown", "ArrowUp", "Enter", "BackspaceAtStart"]) },
	PressedAutocompleteKey: { key: Schema.Literals(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]) },
	HoveredSuggestion: { index: Schema.Number },
	ClickedSuggestion: { index: Schema.Number },
	UpdatedSuggestions: { suggestions: Schema.Array(Suggestion) },
	ClickedRemoveFilter: { index: Schema.Number },
	ClickedClearSearch: {},
	ClickedSearchResult: { index: Schema.Number },
	ClickedRecentSearch: { index: Schema.Number },
	ClickedClearRecentSearches: {},
	UpdatedSearchData: { data: SearchData },
	LoadedRecentSearches: { searches: Schema.Array(RecentSearch) },
	CompletedFocusInput: {},
	CompletedTrackRecentChannel: {},
	SucceededSetPresenceStatus: {},
	/** Legacy ignores the exit of `setStatus`, so a failure shows nothing. */
	FailedSetPresenceStatus: { reason: CommonReason },
	// The search editor's Commands: each fails only when the editor is not mounted.
	SucceededSetSearchText: {},
	FailedSetSearchText: { reason: SearchEditorFailure },
	SucceededDeleteFilterText: {},
	FailedDeleteFilterText: { reason: SearchEditorFailure },
	SucceededSyncSuggestionCount: {},
	FailedSyncSuggestionCount: { reason: SearchEditorFailure },
	SucceededSetSearchPlaceholder: {},
	FailedSetSearchPlaceholder: { reason: SearchEditorFailure },
	SucceededFocusSearchEditor: {},
	FailedFocusSearchEditor: { reason: SearchEditorFailure },
	CompletedSaveRecentSearches: {},
})
export type Message = typeof Message.Type

/** What the palette reports to the root. It closes itself first where legacy calls `onClose()`. */
export const OutMessage = defineMessageUnion({
	Completed: { href: Schema.NullOr(Schema.String), toast: Schema.NullOr(ToastRequest) },
	RequestedModal: { modal: ModalRequest },
	RequestedToast: { toast: ToastRequest },
	/** `setTheme(mode)`: the root applies and persists it. */
	RequestedTheme: { preference: ThemePreference },
	/** `setStatus(status)`: presence keeps it ahead of the AFK-derived status. */
	RequestedPresenceStatus: { status: PresenceStatus },
})
export type OutMessage = typeof OutMessage.Type
