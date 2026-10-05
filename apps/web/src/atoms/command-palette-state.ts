import { Atom } from "effect/reactivity"
import type { FilterType, SearchFilter } from "~/lib/search-filter-parser"

/**
 * Page types available in the command palette
 */
export type CommandPalettePageType =
	| "home"
	| "search"
	| "status"
	| "appearance"
	| "create-channel"
	| "join-channel"

/**
 * Page-specific state for each page type
 * Uses discriminated union for type-safe state management
 */
export type PageState =
	| HomePageState
	| SearchPageState
	| StatusPageState
	| AppearancePageState
	| CreateChannelPageState
	| JoinChannelPageState

export interface HomePageState {
	type: "home"
	inputValue: string
}

export interface SearchPageState {
	type: "search"
	/** Text query (excludes filter syntax) */
	query: string
	/** Full raw input including filter syntax */
	rawInput: string
	/** Resolved filters with IDs */
	filters: SearchFilter[]
	/** Filter type currently being typed (for autocomplete) */
	activeFilterType: FilterType | null
	/** Partial value being typed for active filter */
	activeFilterPartial: string
	/** Selected result index for keyboard navigation */
	selectedIndex: number
}

export interface StatusPageState {
	type: "status"
	inputValue: string
}

export interface AppearancePageState {
	type: "appearance"
	inputValue: string
}

export interface CreateChannelPageState {
	type: "create-channel"
	name: string
	channelType: "public" | "private"
	error: string | null
	isSubmitting: boolean
}

export interface JoinChannelPageState {
	type: "join-channel"
	searchQuery: string
}

/**
 * History entry that preserves page state for back navigation
 */
export interface HistoryEntry {
	pageState: PageState
}

/**
 * Full command palette state
 */
export interface CommandPaletteState {
	isOpen: boolean
	currentPage: PageState
	pageHistory: HistoryEntry[]
}

/**
 * Initial state for each page type
 */
export const initialPageStates: Record<CommandPalettePageType, PageState> = {
	home: { type: "home", inputValue: "" },
	search: {
		type: "search",
		query: "",
		rawInput: "",
		filters: [],
		activeFilterType: null,
		activeFilterPartial: "",
		selectedIndex: 0,
	},
	status: { type: "status", inputValue: "" },
	appearance: { type: "appearance", inputValue: "" },
	"create-channel": {
		type: "create-channel",
		name: "",
		channelType: "public",
		error: null,
		isSubmitting: false,
	},
	"join-channel": {
		type: "join-channel",
		searchQuery: "",
	},
}

/**
 * Initial command palette state
 */
export const initialCommandPaletteState: CommandPaletteState = {
	isOpen: false,
	currentPage: initialPageStates.home,
	pageHistory: [],
}

/**
 * Check if a page is a form page (vs a list page)
 * Form pages don't use the Autocomplete search input and render outside CommandMenuList
 * Note: "search" page has its own custom search input, so it's also treated as a form page
 */
export const isFormPage = (pageType: CommandPalettePageType): boolean => {
	return pageType === "create-channel" || pageType === "join-channel" || pageType === "search"
}

/**
 * Get the page type from a page state
 */
export const getPageType = (pageState: PageState): CommandPalettePageType => {
	return pageState.type
}

/**
 * Main command palette state atom
 */
export const commandPaletteStateAtom = Atom.make<CommandPaletteState>(initialCommandPaletteState).pipe(
	Atom.keepAlive,
)

/**
 * Derived atom for checking if we can go back in navigation
 */
export const canGoBackAtom = Atom.make((get) => {
	const state = get(commandPaletteStateAtom)
	return state.pageHistory.length > 0
}).pipe(Atom.keepAlive)

/**
 * Derived atom for current page type
 */
export const currentPageTypeAtom = Atom.make((get) => {
	const state = get(commandPaletteStateAtom)
	return getPageType(state.currentPage)
}).pipe(Atom.keepAlive)

/**
 * Derived atom for checking if current page is a form page
 */
export const isCurrentPageFormAtom = Atom.make((get) => {
	const pageType = get(currentPageTypeAtom)
	return isFormPage(pageType)
}).pipe(Atom.keepAlive)
