import { Effect, Match, Option, Queue, Schema, Stream } from "effect"
import { Command, Mount, Render } from "foldkit"
import { readStored, writeStored } from "../../data/storage"
import { type EditorNotMounted, editorRegistry, withEditor } from "../../editor/registry"
import { Message } from "./message"
import { RecentSearch } from "./search-data"
import {
	createSearchEditor,
	deleteFilterText,
	type SearchEditorEvent,
	setPlaceholder,
	setText,
	syncOptionCount,
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

/**
 * Owns the ProseMirror editor while the search page shows, registered in the `EditorRegistry` for the
 * Commands below. Focus is `FocusSearchEditor`'s job, sent when the page opens.
 */
export const MountSearchEditor = Mount.defineStream("MountSearchEditor", {
	args: { placeholder: Schema.String },
	messages: [Message.EditedSearch, Message.PressedSearchKey, Message.PressedAutocompleteKey],
	execute: ({ element, placeholder, viewStateChanges }) =>
		// The keyed host is always a div; anything else has no editor to mount.
		!(element instanceof HTMLElement)
			? Stream.empty
			: Stream.callback<EditorMessage>((queue) =>
					Effect.gen(function* () {
						const view = yield* Effect.acquireRelease(
							Effect.sync(() =>
								createSearchEditor(element, {
									placeholder,
									emit: (event) => Queue.offerUnsafe(queue, toMessage(event)),
								}),
							),
							(editor) => Effect.sync(() => editor.destroy()),
						)
						yield* editorRegistry.register(SEARCH_EDITOR_ID, view)
						// Read-only while DevTools shows a historical view.
						yield* viewStateChanges.pipe(
							Stream.runForEach((viewState) =>
								Effect.sync(() => view.setProps({ editable: () => viewState === "Live" })),
							),
							Effect.forkScoped,
						)
						return yield* Effect.never
					}),
				),
})

/** Every editor Command fails the same way: the search page (and so its editor) is gone. */
const editorFailed =
	<M>(toFailure: (failure: { reason: "EditorNotMounted" }) => M) =>
	<A, R>(effect: Effect.Effect<A, EditorNotMounted, R>): Effect.Effect<A | M, never, R> =>
		effect.pipe(
			Effect.catchTags({
				EditorNotMounted: () => Effect.succeed(toFailure({ reason: "EditorNotMounted" })),
			}),
		)

export const SetSearchText = Command.define("SetSearchText", {
	args: { text: Schema.String },
	messages: [Message.SucceededSetSearchText, Message.FailedSetSearchText],
	execute: ({ text }) =>
		withEditor(SEARCH_EDITOR_ID, (view) => setText(view, text)).pipe(
			Effect.as(Message.SucceededSetSearchText()),
			editorFailed(Message.FailedSetSearchText),
		),
})

export const DeleteFilterText = Command.define("DeleteFilterText", {
	args: { filterStartOffset: Schema.Number },
	messages: [Message.SucceededDeleteFilterText, Message.FailedDeleteFilterText],
	execute: ({ filterStartOffset }) =>
		withEditor(SEARCH_EDITOR_ID, (view) => deleteFilterText(view, filterStartOffset)).pipe(
			Effect.as(Message.SucceededDeleteFilterText()),
			editorFailed(Message.FailedDeleteFilterText),
		),
})

export const SyncSuggestionCount = Command.define("SyncSuggestionCount", {
	args: { count: Schema.Number },
	messages: [Message.SucceededSyncSuggestionCount, Message.FailedSyncSuggestionCount],
	execute: ({ count }) =>
		withEditor(SEARCH_EDITOR_ID, (view) => syncOptionCount(view, count)).pipe(
			Effect.as(Message.SucceededSyncSuggestionCount()),
			editorFailed(Message.FailedSyncSuggestionCount),
		),
})

export const SetSearchPlaceholder = Command.define("SetSearchPlaceholder", {
	args: { placeholder: Schema.String },
	messages: [Message.SucceededSetSearchPlaceholder, Message.FailedSetSearchPlaceholder],
	execute: ({ placeholder }) =>
		withEditor(SEARCH_EDITOR_ID, (view) => setPlaceholder(view, placeholder)).pipe(
			Effect.as(Message.SucceededSetSearchPlaceholder()),
			editorFailed(Message.FailedSetSearchPlaceholder),
		),
})

/** Legacy `autoFocus`: once the render that shows the search page (and mounts its editor) commits. */
export const FocusSearchEditor = Command.define("FocusSearchEditor", {
	messages: [Message.SucceededFocusSearchEditor, Message.FailedFocusSearchEditor],
	execute: Render.afterCommit.pipe(
		Effect.andThen(withEditor(SEARCH_EDITOR_ID, (view) => view.focus())),
		Effect.as(Message.SucceededFocusSearchEditor()),
		editorFailed(Message.FailedFocusSearchEditor),
	),
})

/** `recentSearchesAtom` (platform storage, JSON). */
const RECENT_SEARCHES_KEY = "recentSearches"
const RecentSearches = Schema.Array(RecentSearch)

/** Missing or unreadable storage is no recent searches. */
export const LoadRecentSearches = Command.define("LoadRecentSearches", {
	messages: [Message.LoadedRecentSearches],
	execute: readStored(RECENT_SEARCHES_KEY, RecentSearches).pipe(
		Effect.map((stored) =>
			Message.LoadedRecentSearches({ searches: Option.getOrElse(stored, () => []) }),
		),
	),
})

/** Best effort, like the legacy atom: a full or blocked store only loses the history. */
export const SaveRecentSearches = Command.define("SaveRecentSearches", {
	args: { searches: RecentSearches },
	messages: [Message.CompletedSaveRecentSearches],
	execute: ({ searches }) =>
		writeStored(RECENT_SEARCHES_KEY, RecentSearches, searches).pipe(
			// Best effort: an unsaved recent search only means it is missing next time.
			Effect.catchTag("StorageWriteError", () => Effect.void),
			Effect.as(Message.CompletedSaveRecentSearches()),
		),
})
