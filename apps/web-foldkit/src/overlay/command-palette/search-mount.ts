import { Effect, Match, Option, Queue, Schema, Stream } from "effect"
import { Command, Mount } from "foldkit"
import { Message } from "./message"
import { RecentSearch } from "./search-data"
import {
	createSearchEditor,
	deleteFilterText,
	registerSearchEditor,
	type SearchEditorEvent,
	searchEditorById,
	setPlaceholder,
	setText,
	syncOptionCount,
	unregisterSearchEditor,
} from "./search-editor"

/** The search page's editor Mount and the Commands that reach the live editor. */

export const SEARCH_EDITOR_ID = "command-palette-search"

type EditorMessage =
	| typeof Message.EditedSearch.Type
	| typeof Message.PressedSearchKey.Type
	| typeof Message.PressedAutocompleteKey.Type

const toMessage = (event: SearchEditorEvent): EditorMessage =>
	Match.value(event).pipe(
		Match.tagsExhaustive({
			ChangedText: ({ text, autocomplete }) => Message.EditedSearch({ text, autocomplete }),
			PressedKey: ({ key }) => Message.PressedSearchKey({ key }),
			PressedAutocompleteKey: ({ key }) => Message.PressedAutocompleteKey({ key }),
		}),
	)

/** Owns the ProseMirror editor while the search page shows; focuses it on mount like legacy. */
export const MountSearchEditor = Mount.defineStream("MountSearchEditor", {
	args: { placeholder: Schema.String },
	messages: [Message.EditedSearch, Message.PressedSearchKey, Message.PressedAutocompleteKey],
	execute: ({ element, placeholder }) =>
		Stream.callback<EditorMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const view = createSearchEditor(element as HTMLElement, {
						placeholder,
						emit: (event) => Queue.offerUnsafe(queue, toMessage(event)),
					})
					registerSearchEditor(SEARCH_EDITOR_ID, view)
					view.focus()
					return view
				}),
				(view) =>
					Effect.sync(() => {
						unregisterSearchEditor(SEARCH_EDITOR_ID, view)
						view.destroy()
					}),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

const withEditor = (f: (view: NonNullable<ReturnType<typeof searchEditorById>>) => void) =>
	Effect.sync(() => {
		const view = searchEditorById(SEARCH_EDITOR_ID)
		if (view) f(view)
	}).pipe(Effect.as(Message.CompletedEffect()))

export const SetSearchText = Command.define("SetSearchText", {
	args: { text: Schema.String },
	messages: [Message.CompletedEffect],
	execute: ({ text }) => withEditor((view) => setText(view, text)),
})

export const DeleteFilterText = Command.define("DeleteFilterText", {
	args: { filterStartOffset: Schema.Number },
	messages: [Message.CompletedEffect],
	execute: ({ filterStartOffset }) => withEditor((view) => deleteFilterText(view, filterStartOffset)),
})

export const SyncSuggestionCount = Command.define("SyncSuggestionCount", {
	args: { count: Schema.Number },
	messages: [Message.CompletedEffect],
	execute: ({ count }) => withEditor((view) => syncOptionCount(view, count)),
})

export const SetSearchPlaceholder = Command.define("SetSearchPlaceholder", {
	args: { placeholder: Schema.String },
	messages: [Message.CompletedEffect],
	execute: ({ placeholder }) => withEditor((view) => setPlaceholder(view, placeholder)),
})

export const FocusSearchEditor = Command.define("FocusSearchEditor", {
	args: {},
	messages: [Message.CompletedEffect],
	execute: () => withEditor((view) => view.focus()),
})

const RECENT_SEARCHES_KEY = "recentSearches"
const decodeRecent = Schema.decodeUnknownOption(Schema.Array(RecentSearch))

/** `recentSearchesAtom` (platform storage, JSON). */
export const LoadRecentSearches = Command.define("LoadRecentSearches", {
	args: {},
	messages: [Message.LoadedRecentSearches],
	execute: () =>
		Effect.try(() => JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]")).pipe(
			Effect.map((raw) => Option.getOrElse(decodeRecent(raw), () => [])),
			Effect.orElseSucceed(() => []),
			Effect.map((searches) => Message.LoadedRecentSearches({ searches })),
		),
})

export const SaveRecentSearches = Command.define("SaveRecentSearches", {
	args: { searches: Schema.Array(RecentSearch) },
	messages: [Message.CompletedEffect],
	execute: ({ searches }) =>
		Effect.try(() => localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches))).pipe(
			Effect.ignoreCause,
			Effect.as(Message.CompletedEffect()),
		),
})
