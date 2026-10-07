import { Option } from "effect"
import { Command, type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { Shared } from "../../page/contract"
import type { HazelRpc } from "../../rpc"
import * as CommandMenu from "../../ui/command-menu"
import { successToast } from "../out-message"
import type { ToastRequest } from "../toasts"
import {
	CreateChannel,
	FocusInput,
	JoinChannel,
	LoadTheme,
	SaveTheme,
	SetPresenceStatus,
	TrackRecentChannel,
} from "./commands"
import { Message, OutMessage } from "./message"
import { initialPageState, isFormPage, type Model, type Page, type PageState } from "./model"
import { emptySearchData } from "./search-data"
import { menuSectionsOf, NAVIGATION, parseKey, SETTINGS, STATUS_OPTIONS, THEME_OPTIONS } from "./menu"
import { LoadRecentSearches } from "./search-mount"
import { updateSearch } from "./search-update"

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, HazelRpc>

export const MENU_ID = "command-palette"
export const CREATE_CHANNEL_INPUT_ID = "command-palette-create-channel-name"
export const JOIN_CHANNEL_INPUT_ID = "command-palette-join-channel-search"

// INIT

export const init = (): Model => ({
	isOpen: false,
	page: initialPageState("home"),
	history: [],
	menu: CommandMenu.init({ id: MENU_ID, sections: [] }),
	channels: [],
	dmChannels: [],
	recentChannelIds: [],
	recentChannels: [],
	memberChannelIds: null,
	unjoinedChannels: null,
	presenceStatus: "online",
	theme: "system",
	search: emptySearchData,
	recentSearches: [],
	searchAutocomplete: null,
	suggestionIndex: 0,
	suggestions: [],
})

// PAGES

const inputValueOf = (page: PageState) => ("inputValue" in page ? page.inputValue : "")

/** The menu follows the page: its sections, and the page's own search value. */
const withMenu = (model: Model, shared: Shared, inputValue: string): Model =>
	modifyFields(model, {
		menu: (menu) => ({
			...CommandMenu.open(menu).model,
			inputValue,
			sections: menuSectionsOf(model, shared),
		}),
	})

/** The new page's `autoFocus` input (the search editor focuses itself on mount). */
const focusCommandsOf = (page: PageState) =>
	page._tag === "CreateChannel"
		? [FocusInput({ selector: `#${CREATE_CHANNEL_INPUT_ID}` })]
		: page._tag === "JoinChannel"
			? [FocusInput({ selector: `#${JOIN_CHANNEL_INPUT_ID}` })]
			: page._tag === "Search"
				? [LoadRecentSearches({})]
				: [FocusInput({ selector: `#${CommandMenu.searchId(MENU_ID)}` })]

const showPage = (model: Model, page: PageState, history: ReadonlyArray<PageState>, shared: Shared): Return => ({
	model: withMenu(modifyFields(model, { page: () => page, history: () => history }), shared, inputValueOf(page)),
	commands: focusCommandsOf(page),
})

/** `useCommandPalette().open(page)`: a fresh page and no history. */
export const open = (model: Model, page: Page, shared: Shared): Return => {
	const shown = showPage(modifyFields(model, { isOpen: () => true }), initialPageState(page), [], shared)
	return { ...shown, commands: [...(shown.commands ?? []), LoadTheme({})] }
}

/** `close()`: back to the initial state (home, no history). */
export const close = (model: Model): Model =>
	modifyFields(model, {
		isOpen: () => false,
		page: () => initialPageState("home"),
		history: () => [],
		menu: (menu) => CommandMenu.close(menu).model,
	})

const remember = (model: Model): PageState =>
	"inputValue" in model.page ? { ...model.page, inputValue: model.menu.inputValue } : model.page

/** `navigateTo(page)`: push the current page (with its search value) and show a fresh one. */
export const navigateTo = (model: Model, page: Page, shared: Shared): Return =>
	showPage(model, initialPageState(page), [...model.history, remember(model)], shared)

/** Escape: `goBack()` when there is history, otherwise close. */
const goBackOrClose = (model: Model, shared: Shared): Return => {
	const previous = model.history[model.history.length - 1]
	return previous === undefined
		? { model: close(model) }
		: showPage(model, previous, model.history.slice(0, -1), shared)
}

// UPDATE

/** Legacy `onClose()` after a successful action: close, then follow `href` and show `toast`. */
export const closedWith = (model: Model, href: string | null, toast: ToastRequest | null): Return => ({
	model: close(model),
	outMessage: OutMessage.Completed({ href, toast }),
})

const PAGE_ACTIONS: Readonly<Record<string, Page>> = {
	"action:search": "search",
	"action:create-channel": "create-channel",
	"action:join-channel": "join-channel",
	"pref:status": "status",
	"pref:appearance": "appearance",
}

const chatHref = (shared: Shared, channelId: string) => `/${shared.orgSlug ?? ""}/chat/${channelId}`

/** A menu item's `onAction`, as each legacy `CommandMenuItem` defines it. */
const selectedItem = (model: Model, key: string, shared: Shared): Return => {
	const page = PAGE_ACTIONS[key]
	if (page !== undefined) return navigateTo(model, page, shared)
	if (key === "action:start-dm")
		return { model: close(model), outMessage: OutMessage.RequestedModal({ modal: { _tag: "CreateDm" } }) }
	if (key === "action:invite")
		return { model: close(model), outMessage: OutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } }) }
	const { kind, value } = parseKey(key)
	if (kind === "recent") return closedWith(model, chatHref(shared, value), null)
	if (kind === "channel" || kind === "dm")
		return { ...closedWith(model, chatHref(shared, value), null), commands: [TrackRecentChannel({ channelId: value })] }
	const link = [...NAVIGATION, ...SETTINGS].find((entry) => entry.key === key)
	if (link !== undefined) return closedWith(model, `/${shared.orgSlug ?? ""}${link.path}`, null)
	const status = STATUS_OPTIONS.find((option) => `status:${option.value}` === key)
	if (status !== undefined) return { model: close(model), commands: [SetPresenceStatus({ status: status.value })] }
	const theme = THEME_OPTIONS.find((option) => `theme:${option.value}` === key)
	if (theme !== undefined)
		return {
			model: close(modifyFields(model, { theme: () => theme.value })),
			commands: [SaveTheme({ theme: theme.value })],
		}
	return { model }
}

const isPlainEscape = (model: Model, message: CommandMenu.Message) =>
	isFormPage(model.page)
		? message._tag === "ClickedEscapeButton"
		: message._tag === "PressedSearchKey" && message.key === "Escape" && model.menu.inputValue === ""

const gotMenuMessage = (model: Model, message: CommandMenu.Message, shared: Shared): Return => {
	if (isPlainEscape(model, message)) return goBackOrClose(model, shared)
	const result = CommandMenu.update(model.menu, message)
	const next = modifyFields(model, { menu: () => result.model })
	const commands = Command.mapMessages(result.commands, (child) => Message.GotMenuMessage({ message: child }))
	return Option.match(Option.fromNullishOr(result.outMessage), {
		onNone: () => ({ model: next, commands }),
		onSome: CommandMenu.OutMessage.match<Return>({
			Closed: () => ({ model: close(next), commands }),
			SelectedItem: ({ key }) => {
				const selected = selectedItem(next, key, shared)
				return { ...selected, commands: [...commands, ...(selected.commands ?? [])] }
			},
		}),
	})
}

const refreshMenu = (result: Return, shared: Shared): Return =>
	result.model.isOpen && !isFormPage(result.model.page)
		? { ...result, model: modifyFields(result.model, { menu: (menu) => ({ ...menu, sections: menuSectionsOf(result.model, shared) }) }) }
		: result

const withPage = (model: Model, page: PageState): Model => modifyFields(model, { page: () => page })

export const update = (model: Model, message: Message, shared: Shared): Return =>
	refreshMenu(
		Message.match<Return>(message, {
			GotMenuMessage: ({ message }) => gotMenuMessage(model, message, shared),
			ClickedBack: () => goBackOrClose(model, shared),
			ClickedEscButton: () => ({ model: close(model) }),
			UpdatedChannels: ({ channels }) => ({ model: modifyFields(model, { channels: () => channels }) }),
			UpdatedDmChannels: ({ dmChannels }) => ({ model: modifyFields(model, { dmChannels: () => dmChannels }) }),
			UpdatedRecentChannelIds: ({ channelIds }) => ({
				model: modifyFields(model, { recentChannelIds: () => channelIds }),
			}),
			UpdatedRecentChannels: ({ channels }) => ({ model: modifyFields(model, { recentChannels: () => channels }) }),
			UpdatedMemberChannelIds: ({ channelIds }) => ({
				model: modifyFields(model, { memberChannelIds: () => channelIds }),
			}),
			UpdatedUnjoinedChannels: ({ channels }) => ({
				model: modifyFields(model, { unjoinedChannels: () => channels }),
			}),
			UpdatedPresenceStatus: ({ status }) => ({ model: modifyFields(model, { presenceStatus: () => status }) }),
			LoadedTheme: ({ theme }) => ({ model: modifyFields(model, { theme: () => theme }) }),
			ChangedChannelName: ({ value }) =>
				model.page._tag === "CreateChannel"
					? { model: withPage(model, { ...model.page, name: value, error: null }) }
					: { model },
			ChangedChannelType: ({ value }) =>
				model.page._tag === "CreateChannel"
					? { model: withPage(model, { ...model.page, channelType: value }) }
					: { model },
			SubmittedCreateChannel: () => submittedCreateChannel(model, shared),
			SucceededCreateChannel: ({ channelId }) =>
				closedWith(model, `/${shared.orgSlug ?? ""}/chat/${channelId}`, successToast("Channel created successfully")),
			FailedCreateChannel: ({ toast }) => ({
				model:
					model.page._tag === "CreateChannel" ? withPage(model, { ...model.page, isSubmitting: false }) : model,
				outMessage: OutMessage.RequestedToast({ toast }),
			}),
			ChangedJoinSearch: ({ value }) =>
				model.page._tag === "JoinChannel" ? { model: withPage(model, { ...model.page, searchQuery: value }) } : { model },
			ClickedJoinChannel: ({ channelId }) =>
				shared.currentUser === null
					? { model }
					: { model, commands: [JoinChannel({ channelId, userId: shared.currentUser.id })] },
			SucceededJoinChannel: () => closedWith(model, null, successToast("Successfully joined channel")),
			FailedJoinChannel: ({ toast }) => ({ model, outMessage: OutMessage.RequestedToast({ toast }) }),
			EditedSearch: (found) => updateSearch(model, found, shared),
			PressedSearchKey: (found) => updateSearch(model, found, shared),
			PressedAutocompleteKey: (found) => updateSearch(model, found, shared),
			HoveredSuggestion: (found) => updateSearch(model, found, shared),
			ClickedSuggestion: (found) => updateSearch(model, found, shared),
			UpdatedSuggestions: (found) => updateSearch(model, found, shared),
			ClickedRemoveFilter: (found) => updateSearch(model, found, shared),
			ClickedClearSearch: (found) => updateSearch(model, found, shared),
			ClickedSearchResult: (found) => updateSearch(model, found, shared),
			ClickedRecentSearch: (found) => updateSearch(model, found, shared),
			ClickedClearRecentSearches: (found) => updateSearch(model, found, shared),
			UpdatedSearchData: ({ data }) => ({ model: modifyFields(model, { search: () => data }) }),
			LoadedRecentSearches: ({ searches }) => ({ model: modifyFields(model, { recentSearches: () => searches }) }),
			CompletedEffect: () => ({ model }),
		}),
		shared,
	)

/** `CreateChannelView.handleSubmit`: arktype `name: "string > 2"`, then the optimistic action. */
const submittedCreateChannel = (model: Model, shared: Shared): Return => {
	const page = model.page
	if (page._tag !== "CreateChannel" || page.isSubmitting) return { model }
	if (page.name.length <= 2)
		return { model: withPage(model, { ...page, error: "Channel name must be at least 3 characters" }) }
	if (shared.currentUser === null || shared.organization === null || shared.orgSlug === null) return { model }
	return {
		model: withPage(model, { ...page, isSubmitting: true, error: null }),
		commands: [
			CreateChannel({
				name: page.name,
				type: page.channelType,
				organizationId: shared.organization.id,
				currentUserId: shared.currentUser.id,
			}),
		],
	}
}
