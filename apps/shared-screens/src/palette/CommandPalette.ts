// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
// Query results are `AsyncResult`s (effect/reactivity), as Effect UI's guide reads them.
// @effect-diagnostics unstableApiUsage:off
/**
 * The command palette (`web-foldkit/src/overlay/command-palette`, now deleted): home with recent
 * channels, actions, channels, people, customers and pages; message search with filters, local and
 * server results and recent searches; status, appearance, create and join channel. The host mounts
 * one per open (keyed) and sets `open` false on `RequestedClose`.
 */
import { Command, Component, Query, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { ChannelId, CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Context, Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { AsyncResult } from "effect/reactivity"
import { type AppToast, Navigate, OpenModal, SetTheme, ShowToast } from "../app/requests"
import {
	channelsStream,
	channelSuggestionsStream,
	customersStream,
	dmChannelsStream,
	hitLookupOf,
	localResultsStream,
	memberChannelIdsStream,
	presenceStream,
	recentChannelsStream,
	unjoinedChannelsStream,
	userSuggestionsStream,
} from "./data"
import {
	appearanceGroups,
	homeGroups,
	searchGroups,
	STATUS_OPTIONS,
	statusGroups,
	THEME_OPTIONS,
} from "./groups"
import { channelHref, customerHref, messageHref } from "./hrefs"
import {
	ChannelSummary,
	ChannelType,
	CustomerSummary,
	CustomerUserSummary,
	DmChannel,
	initialPageState,
	isFormPage,
	type PageState,
	PaletteModel,
	PaletteProps,
	RecentSearch,
	SearchFilter,
	SearchResult,
	Suggestion,
} from "./model"
import {
	autocompleteOf,
	hasQuery,
	hasSuggestions,
	mergeSearchResults,
	pickSuggestion,
	rememberSearch,
	resultOfHit,
	textQueryOf,
	toSearchRequest,
} from "./search"

// STORAGE

/** Where the recents live (the web: `recentChannels` in localStorage, `recentSearches` in platform storage). */
export class PaletteStorage extends Context.Service<
	PaletteStorage,
	{
		readonly recentChannelIds: Effect.Effect<ReadonlyArray<ChannelId>>
		readonly trackChannel: (channelId: ChannelId) => Effect.Effect<void>
		readonly recentSearches: Effect.Effect<ReadonlyArray<RecentSearch>>
		readonly saveRecentSearches: (searches: ReadonlyArray<RecentSearch>) => Effect.Effect<void>
	}
>()("hazel/palette/PaletteStorage") {}

// MESSAGES

export const PresenceStatus = Schema.Literals(["online", "away", "busy", "dnd"])
export type PresenceStatus = typeof PresenceStatus.Type

export const PaletteMessage = UiSchema.TaggedEnum({
	ChangedQuery: { payload: TextField.ChangePayload },
	SelectedItem: { id: Schema.String },
	PressedBack: {},
	DismissedPalette: {},
	UpdatedChannels: { channels: Schema.Array(ChannelSummary) },
	UpdatedDmChannels: { dmChannels: Schema.Array(DmChannel) },
	UpdatedCustomers: { customers: Schema.Array(CustomerSummary) },
	LoadedRecentChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedRecentChannels: { channels: Schema.Array(ChannelSummary) },
	UpdatedPresenceStatus: { status: Schema.String },
	UpdatedMemberChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedUnjoinedChannels: { channels: Schema.Array(ChannelSummary) },
	LoadedRecentSearches: { searches: Schema.Array(RecentSearch) },
	UpdatedSuggestions: { suggestions: Schema.Array(Suggestion) },
	UpdatedLocalResults: { results: Schema.Array(SearchResult) },
	ChangedChannelName: { payload: TextField.ChangePayload },
	ChangedChannelType: { selected: Schema.Array(Schema.String) },
	PressedCreateChannel: {},
	SucceededCreateChannel: { channelId: ChannelId },
	FailedCreateChannel: {},
	ChangedJoinSearch: { payload: TextField.ChangePayload },
	PressedJoinChannel: { channelId: ChannelId },
	SucceededJoinChannel: {},
	FailedJoinChannel: { reason: Schema.Literals(["NotFound", "Other"]) },
})
export type PaletteMessage = typeof PaletteMessage.Type

/** What the host acts on: close the palette, open the AI panel, keep a picked status ahead of presence. */
export const PaletteEvents = UiSchema.TaggedEnum({
	RequestedClose: {},
	RequestedAiPanel: {},
	PickedStatus: { status: PresenceStatus },
})
export type PaletteEvents = typeof PaletteEvents.Type

// QUERIES

/** `message.search`: the org's server index over every channel the user can read. */
export class SearchMessages extends Query.Service<SearchMessages>()("hazel/palette/SearchMessages", {
	args: { organizationId: OrganizationId, query: Schema.String, filters: Schema.Array(SearchFilter) },
	success: Schema.Array(SearchResult),
	error: Schema.Literals(["Failed"]),
	staleTime: "30 seconds",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const data = yield* ClientData
			const lookup = hitLookupOf(data)
			return ({ organizationId, query, filters }) => {
				const request = toSearchRequest(organizationId, query, filters)
				return request === null
					? Effect.succeed([])
					: rpc("message.search", request).pipe(
							Effect.map((response) => response.results.map((hit) => resultOfHit(hit, lookup))),
							// BOUNDARY: offline, signed out or the server: the page says the search failed.
							Effect.tapCause((cause) => Effect.logWarning("palette search failed", cause)),
							Effect.catchCause(() => Effect.fail("Failed" as const)),
							Effect.withSpan("CommandPalette.serverSearch"),
						)
			}
		}),
	)
}

/** `customers.contacts.search`: the customers' users matching the typed text. */
export class SearchCustomerUsers extends Query.Service<SearchCustomerUsers>()(
	"hazel/palette/SearchCustomerUsers",
	{
		args: { organizationId: OrganizationId, query: Schema.String },
		success: Schema.Array(CustomerUserSummary),
		error: Schema.Literals(["Failed"]),
		staleTime: "30 seconds",
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, query }) =>
				rpc("customers.contacts.search", { organizationId, query }).pipe(
					Effect.map(({ contacts }) =>
						contacts.map((contact) => ({
							id: contact.id,
							accountId: contact.accountId,
							name: contact.name,
							email: contact.email,
							avatarUrl: contact.avatarUrl,
						})),
					),
					// BOUNDARY: the users group is a convenience; a failure only leaves it out.
					Effect.catchCause(() => Effect.fail("Failed" as const)),
					Effect.withSpan("CommandPalette.customerUserSearch"),
				)
		}),
	)
}

// COMMANDS

/** Creates the channel optimistically, as the sidebar's dialog does. */
export class CreatePaletteChannel extends Command.Service<CreatePaletteChannel>()(
	"hazel/palette/CreatePaletteChannel",
	{
		args: {
			name: Schema.String,
			type: ChannelType,
			organizationId: OrganizationId,
			currentUserId: UserId,
		},
		success: PaletteMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return ({ name, type, organizationId, currentUserId }) =>
				data.actions
					.createChannelAction({
						name,
						icon: null,
						type,
						organizationId,
						parentChannelId: null,
						currentUserId,
					})
					.pipe(
						Effect.map((result) =>
							PaletteMessage.SucceededCreateChannel({ channelId: result.data.channelId }),
						),
						// BOUNDARY: every failure reads the same toast here.
						Effect.tapCause((cause) => Effect.logWarning("palette create channel failed", cause)),
						Effect.catchCause(() => Effect.succeed(PaletteMessage.FailedCreateChannel())),
						Effect.provideService(HazelRpc, rpc),
					)
		}),
	)
}

export class JoinPaletteChannel extends Command.Service<JoinPaletteChannel>()(
	"hazel/palette/JoinPaletteChannel",
	{ args: { channelId: ChannelId, userId: UserId }, success: PaletteMessage },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return ({ channelId, userId }) =>
				data.actions.joinChannelAction({ channelId, userId }).pipe(
					Effect.as(PaletteMessage.SucceededJoinChannel()),
					Effect.catchTags({
						ChannelNotFoundError: () =>
							Effect.succeed(PaletteMessage.FailedJoinChannel({ reason: "NotFound" })),
					}),
					// BOUNDARY: every other failure reads the same toast here.
					Effect.tapCause((cause) => Effect.logWarning("palette join channel failed", cause)),
					Effect.catchCause(() =>
						Effect.succeed(PaletteMessage.FailedJoinChannel({ reason: "Other" })),
					),
					Effect.provideService(HazelRpc, rpc),
				)
		}),
	)
}

/** The status RPC; the host keeps the pick ahead of the away timer (`PickedStatus`). */
export class SetPresenceStatus extends Command.Service<SetPresenceStatus>()(
	"hazel/palette/SetPresenceStatus",
	{ args: { status: PresenceStatus }, success: Component.Noop },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ status }) =>
				rpc("userPresenceStatus.update", { status, customMessage: null }).pipe(
					// BOUNDARY: today ignores the result too; the status shows from presence.
					Effect.catchCause((cause) => Effect.logWarning("palette set status failed", cause)),
					Effect.as(Component.noop),
				)
		}),
	)
}

/** The channel goes first in the recents. Best effort. */
export class TrackRecentChannel extends Command.Service<TrackRecentChannel>()(
	"hazel/palette/TrackRecentChannel",
	{ args: { channelId: ChannelId }, success: Component.Noop },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(PaletteStorage),
			(storage) =>
				({ channelId }) =>
					storage.trackChannel(channelId).pipe(Effect.as(Component.noop)),
		),
	)
}

export class SaveRecentSearches extends Command.Service<SaveRecentSearches>()(
	"hazel/palette/SaveRecentSearches",
	{ args: { searches: Schema.Array(RecentSearch) }, success: Component.Noop },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(PaletteStorage),
			(storage) =>
				({ searches }) =>
					storage.saveRecentSearches(searches).pipe(Effect.as(Component.noop)),
		),
	)
}

// COMPONENT

const decodeChannelId = Schema.decodeUnknownOption(ChannelId)
const decodeAccountId = Schema.decodeUnknownOption(CustomerAccountId)

const PAGE_ACTIONS = {
	"action:search": "search",
	"action:create-channel": "create-channel",
	"action:join-channel": "join-channel",
	"pref:status": "status",
	"pref:appearance": "appearance",
} as const

const isPageAction = (id: string): id is keyof typeof PAGE_ACTIONS => Object.hasOwn(PAGE_ACTIONS, id)

/** Splits `<kind>:<value>`. */
const parseId = (id: string) => {
	const index = id.indexOf(":")
	return { kind: id.slice(0, index), value: id.slice(index + 1) }
}

const queryOf = (page: PageState) => ("query" in page ? page.query : "")

/** The search page's typed `filter:partial`, if it is open on one. */
const autocompleteFor = (model: PaletteModel) =>
	model.page._tag === "Search" ? autocompleteOf(model.query.text) : null

const filtersOf = (model: PaletteModel): ReadonlyArray<SearchFilter> =>
	model.page._tag === "Search" ? model.page.filters : []

const PaletteDef = Hazel.component({
	name: "CommandPalette",
	props: PaletteProps,
	model: PaletteModel,
	message: PaletteMessage,
	events: PaletteEvents,
	queries: {
		serverResults: {
			query: SearchMessages,
			debounce: "250 millis",
			args: ({ model, props }) => {
				if (!props.open || model.page._tag !== "Search") return undefined
				const query = textQueryOf(model.query.text)
				return toSearchRequest(props.organizationId, query, model.page.filters) === null
					? undefined
					: { organizationId: props.organizationId, query, filters: model.page.filters }
			},
		},
		customerUsers: {
			query: SearchCustomerUsers,
			debounce: "250 millis",
			// Orgs without customers never ask; one letter matches too much to be useful.
			args: ({ model, props }) =>
				props.open &&
				model.page._tag === "Home" &&
				model.customers.length > 0 &&
				model.query.text.trim().length >= 2
					? { organizationId: props.organizationId, query: model.query.text.trim() }
					: undefined,
		},
	},
	// The palette opens fresh each time; nothing of it is worth a history entry.
	restore: false,
})

// The `$` every handler gets, read off an update function over the whole message type.
const anyUpdate = PaletteDef.update(($) => $.model)
type Step = Parameters<typeof anyUpdate>[0]
type H = Parameters<Parameters<typeof PaletteDef.make>[0]["view"]>[0]

/** Shows `page` over `history`; a list page's field starts from its own query. */
const show = ($: Step, page: PageState, history: ReadonlyArray<PageState>) =>
	$.evolve({
		page: () => page,
		history: () => history,
		query: (query) => TextField.set(query, queryOf(page)),
	})

/** The current page with what is typed, to come back to. */
const remembered = (model: PaletteModel): PageState =>
	"query" in model.page ? { ...model.page, query: model.query.text } : model.page

const goBackOrClose = ($: Step) => {
	const previous = $.model.history.at(-1)
	return previous === undefined
		? $.emit(PaletteEvents.RequestedClose())
		: show($, previous, $.model.history.slice(0, -1))
}

const navigation = (href: string, toast?: AppToast) =>
	Navigate.make({ href, replace: false, ...(toast === undefined ? {} : { toast }) })

/** Follows an in-app link, then closes. */
const navigate = ($: Step, href: string) => $.run(navigation(href)).emit(PaletteEvents.RequestedClose())

const close = ($: Step) => $.emit(PaletteEvents.RequestedClose())

/** The server's hits merged with the loaded rows, as the search page lists them. */
const resultsOf = (
	model: PaletteModel,
	server: AsyncResult.AsyncResult<ReadonlyArray<SearchResult>, "Failed">,
) => mergeSearchResults(model.localResults, AsyncResult.isSuccess(server) ? server.value : [])

const openResult = ($: Step, index: number) => {
	if ($.model.page._tag !== "Search") return $.model
	const result = resultsOf($.model, $.queries.serverResults)[index]
	if (result === undefined) return $.model
	const searches = rememberSearch($.model.recentSearches, {
		query: textQueryOf($.model.query.text),
		filters: $.model.page.filters,
		timestamp: $.props.nowMs,
	})
	return $.evolve({ recentSearches: () => searches })
		.run(
			SaveRecentSearches.make({ searches }),
			navigation(messageHref($.props.orgSlug, result.channelId, result.messageId)),
		)
		.emit(PaletteEvents.RequestedClose())
}

const searchItem = ($: Step, id: string) => {
	const page = $.model.page
	if (page._tag !== "Search") return $.model
	const { kind, value } = parseId(id)
	const autocomplete = autocompleteFor($.model)
	if (kind === "suggestion" && autocomplete !== null) {
		const suggestion = $.model.suggestions.find((candidate) => candidate.id === value)
		if (suggestion === undefined) return $.model
		const next = pickSuggestion($.model.query.text, page.filters, autocomplete, suggestion)
		return $.evolve({
			page: () => ({ ...page, filters: next.filters }),
			query: (query) => TextField.set(query, next.text === "" ? "" : `${next.text} `),
		})
	}
	if (kind === "filter")
		return $.evolve({
			page: () => ({ ...page, filters: page.filters.filter((_, index) => String(index) !== value) }),
		})
	if (kind === "result") return openResult($, Number(value))
	if (id === "recent-search:clear")
		return $.evolve({ recentSearches: () => [] }).run(SaveRecentSearches.make({ searches: [] }))
	if (kind === "recent-search") {
		const recent = $.model.recentSearches[Number(value)]
		if (recent === undefined) return $.model
		return $.evolve({
			page: () => ({ ...page, filters: recent.filters }),
			query: (query) => TextField.set(query, recent.query),
		})
	}
	return $.model
}

const openChannel = ($: Step, kind: string, value: string) =>
	Option.match(decodeChannelId(value), {
		onNone: () => close($),
		onSome: (channelId) => {
			const href = channelHref($.props.orgSlug, channelId)
			return kind === "recent"
				? navigate($, href)
				: $.run(TrackRecentChannel.make({ channelId }), navigation(href)).emit(
						PaletteEvents.RequestedClose(),
					)
		},
	})

/** A list item's action, as each of today's menu items defines it. */
const selectedItem = ($: Step, id: string) => {
	if ($.model.page._tag === "Search") return searchItem($, id)
	if (isPageAction(id))
		return show($, initialPageState(PAGE_ACTIONS[id]), [...$.model.history, remembered($.model)])
	if (id === "action:start-dm")
		return $.run(OpenModal.make({ modal: { _tag: "CreateDm" } })).emit(PaletteEvents.RequestedClose())
	if (id === "action:invite")
		return $.run(OpenModal.make({ modal: { _tag: "EmailInvite" } })).emit(PaletteEvents.RequestedClose())
	if (id === "action:ai-panel")
		return $.emit(PaletteEvents.RequestedAiPanel()).emit(PaletteEvents.RequestedClose())
	const destination = $.props.destinations.find((page) => `go:${page.id}` === id)
	if (destination !== undefined) return navigate($, destination.href)
	const { kind, value } = parseId(id)
	if (kind === "recent" || kind === "channel" || kind === "dm") return openChannel($, kind, value)
	if (kind === "customer")
		return Option.match(decodeAccountId(value), {
			onNone: () => close($),
			onSome: (accountId) => navigate($, customerHref($.props.orgSlug, accountId, null)),
		})
	if (kind === "customer-user") {
		const users = AsyncResult.isSuccess($.queries.customerUsers) ? $.queries.customerUsers.value : []
		const user = users.find((candidate) => candidate.id === value)
		return user === undefined
			? close($)
			: navigate($, customerHref($.props.orgSlug, user.accountId, "users"))
	}
	const status = STATUS_OPTIONS.find((option) => `status:${option.value}` === id)
	if (status !== undefined)
		return $.run(SetPresenceStatus.make({ status: status.value }))
			.emit(PaletteEvents.PickedStatus({ status: status.value }))
			.emit(PaletteEvents.RequestedClose())
	const theme = THEME_OPTIONS.find((option) => `theme:${option.value}` === id)
	if (theme !== undefined)
		return $.run(SetTheme.make({ preference: { ...$.props.theme, mode: theme.value } })).emit(
			PaletteEvents.RequestedClose(),
		)
	return $.model
}

const toast = (intent: AppToast["intent"], title: string, description: string | null = null): AppToast => ({
	intent,
	title,
	description,
})

const submitCreateChannel = ($: Step) => {
	const page = $.model.page
	if (page._tag !== "CreateChannel" || page.isSubmitting) return $.model
	if (page.name.text.length <= 2)
		return $.evolve({ page: () => ({ ...page, error: "Channel name must be at least 3 characters" }) })
	return $.evolve({ page: () => ({ ...page, isSubmitting: true, error: null }) }).run(
		CreatePaletteChannel.make({
			name: page.name.text,
			type: page.channelType,
			organizationId: $.props.organizationId,
			currentUserId: $.props.userId,
		}),
	)
}

const createPage = ($: Step, change: (page: Extract<PageState, { _tag: "CreateChannel" }>) => PageState) => {
	const page = $.model.page
	return page._tag === "CreateChannel" ? $.evolve({ page: () => change(page) }) : $.model
}

// VIEW

const PLACEHOLDERS = {
	Home: "Where would you like to go?",
	Search: "Search messages... (from:user in:channel has:image)",
	Status: "Set your status...",
	Appearance: "Change appearance...",
} as const

const createChannelBody = (h: H, page: Extract<PageState, { _tag: "CreateChannel" }>) =>
	// HAZEL-GAP(p4-palette-form-subtitle): today's header has a subtitle under the title ("Create a new channel for your team").
	h.stack.density("relaxed").children(
		h.textField
			.label("Channel name")
			.placeholder("e.g. general, design, marketing")
			.value(page.name)
			.error(page.error ?? undefined)
			.on("change", (payload) => PaletteMessage.ChangedChannelName({ payload }))
			.on("submit", () => PaletteMessage.PressedCreateChannel()),
		h.choiceGroup
			.label("Channel type")
			.style("segmented")
			.options([
				{ value: "public", label: "Public", icon: "hashtag" },
				{ value: "private", label: "Private", icon: "lock" },
			])
			.selected([page.channelType])
			.on("change", ({ selected }) => PaletteMessage.ChangedChannelType({ selected })),
		// HAZEL-GAP(p4-palette-form-footer): today's footer is a bordered bar with a "Tab to switch fields" key hint.
		h.stack
			.axis("horizontal")
			.align("center")
			.children(
				h.text.role("caption").tone("muted").children("Tab to switch fields"),
				h.spacer,
				h.button
					.label(page.isSubmitting ? "Creating..." : "Create")
					.size("xsmall")
					.loading(page.isSubmitting)
					.disabled(page.name.text.trim() === "" || page.isSubmitting)
					.on("press", PaletteMessage.PressedCreateChannel()),
			),
	)

const joinChannelBody = (h: H, model: PaletteModel, page: Extract<PageState, { _tag: "JoinChannel" }>) => {
	const unjoined = model.unjoinedChannels ?? []
	const search = page.search.text.trim().toLowerCase()
	const filtered =
		search === "" ? unjoined : unjoined.filter((channel) => channel.name.toLowerCase().includes(search))
	return h.stack.children(
		h.searchField
			.placeholder("Search channels...")
			.value(page.search)
			.on("change", (payload) => PaletteMessage.ChangedJoinSearch({ payload })),
		unjoined.length === 0
			? h.emptyState.icon("hashtag").title("You've joined all available channels")
			: filtered.length === 0
				? h.text.role("caption").tone("muted").children("No channels match your search")
				: h.list.children(
						...filtered.map((channel) =>
							h.item
								.key(channel.id)
								.title(channel.name)
								.leading(h.icon.name(channel.type === "private" ? "lock" : "hashtag"))
								.trailing(h.badge.label("Join").tone("accent").style("quiet"))
								.on("press", PaletteMessage.PressedJoinChannel({ channelId: channel.id })),
						),
					),
	)
}

const listGroups = (h: H, model: PaletteModel) =>
	Match.value(model.page).pipe(
		Match.tag("Home", () =>
			homeGroups(
				model,
				h.props,
				AsyncResult.isSuccess(h.queries.customerUsers) ? h.queries.customerUsers.value : [],
			),
		),
		Match.tag("Status", () => statusGroups(model)),
		Match.tag("Appearance", () => appearanceGroups(model, h.props)),
		Match.tag("Search", (page) =>
			searchGroups({
				filters: page.filters,
				autocomplete: autocompleteFor(model),
				suggestions: model.suggestions,
				hasQuery: hasQuery(model.query.text, page.filters),
				results: resultsOf(model, h.queries.serverResults),
				recentSearches: model.recentSearches,
				nowMs: h.props.nowMs,
			}),
		),
		Match.orElse(() => []),
	)

/** The search page's empty line: what to type, nothing found, or the server's failure. */
const searchEmpty = (h: H, model: PaletteModel, filters: ReadonlyArray<SearchFilter>) => {
	if (!hasQuery(model.query.text, filters)) return "Start typing to search messages"
	return AsyncResult.isFailure(h.queries.serverResults)
		? "Couldn't search messages. Check your connection and try again."
		: "No messages found"
}

const decodeFilters = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(SearchFilter)))

const idsOf = (joined: string) => (joined === "" ? [] : joined.split(",").map((id) => ChannelId.make(id)))

export const CommandPaletteNoDeps = PaletteDef.make({
	init: ({ props }) => ({
		page: initialPageState(props.page),
		history: [],
		query: TextField.empty,
		channels: [],
		dmChannels: [],
		customers: [],
		recentChannelIds: [],
		recentChannels: [],
		memberChannelIds: null,
		unjoinedChannels: null,
		presenceStatus: "online",
		recentSearches: [],
		suggestions: [],
		localResults: [],
	}),
	update: {
		ChangedQuery: ($, { payload }) => $.evolve({ query: (query) => TextField.changed(query, payload) }),
		SelectedItem: ($, { id }) => selectedItem($, id),
		PressedBack: ($) => goBackOrClose($),
		// Escape with an empty field (the palette clears a query first) or a press on the scrim.
		DismissedPalette: ($) => (isFormPage($.model.page) ? close($) : goBackOrClose($)),
		UpdatedChannels: ($, { channels }) => $.evolve({ channels: () => channels }),
		UpdatedDmChannels: ($, { dmChannels }) => $.evolve({ dmChannels: () => dmChannels }),
		UpdatedCustomers: ($, { customers }) => $.evolve({ customers: () => customers }),
		LoadedRecentChannelIds: ($, { channelIds }) => $.evolve({ recentChannelIds: () => channelIds }),
		UpdatedRecentChannels: ($, { channels }) => $.evolve({ recentChannels: () => channels }),
		UpdatedPresenceStatus: ($, { status }) => $.evolve({ presenceStatus: () => status }),
		UpdatedMemberChannelIds: ($, { channelIds }) => $.evolve({ memberChannelIds: () => channelIds }),
		UpdatedUnjoinedChannels: ($, { channels }) => $.evolve({ unjoinedChannels: () => channels }),
		LoadedRecentSearches: ($, { searches }) => $.evolve({ recentSearches: () => searches }),
		UpdatedSuggestions: ($, { suggestions }) => $.evolve({ suggestions: () => suggestions }),
		UpdatedLocalResults: ($, { results }) => $.evolve({ localResults: () => results }),
		ChangedChannelName: ($, { payload }) =>
			createPage($, (page) => ({ ...page, name: TextField.changed(page.name, payload), error: null })),
		ChangedChannelType: ($, { selected }) =>
			createPage($, (page) => ({
				...page,
				channelType: selected.includes("private") ? "private" : "public",
			})),
		PressedCreateChannel: ($) => submitCreateChannel($),
		SucceededCreateChannel: ($, { channelId }) =>
			$.run(
				navigation(
					channelHref($.props.orgSlug, channelId),
					toast("success", "Channel created successfully"),
				),
			).emit(PaletteEvents.RequestedClose()),
		FailedCreateChannel: ($) => {
			const page = $.model.page
			return $.evolve({
				page: () => (page._tag === "CreateChannel" ? { ...page, isSubmitting: false } : page),
			}).run(
				ShowToast.make({
					toast: toast(
						"error",
						"Failed to create channel",
						"Something went wrong. Please try again.",
					),
				}),
			)
		},
		ChangedJoinSearch: ($, { payload }) => {
			const page = $.model.page
			return page._tag === "JoinChannel"
				? $.evolve({ page: () => ({ ...page, search: TextField.changed(page.search, payload) }) })
				: $.model
		},
		PressedJoinChannel: ($, { channelId }) =>
			$.run(JoinPaletteChannel.make({ channelId, userId: $.props.userId })),
		SucceededJoinChannel: ($) =>
			$.run(ShowToast.make({ toast: toast("success", "Successfully joined channel") })).emit(
				PaletteEvents.RequestedClose(),
			),
		FailedJoinChannel: ($, { reason }) =>
			$.run(
				ShowToast.make({
					toast:
						reason === "NotFound"
							? toast("error", "Channel not found", "This channel may have been deleted.")
							: toast(
									"error",
									"Failed to join channel",
									"Something went wrong. Please try again.",
								),
				}),
			),
	},
	subscriptions: ({ props, model }) => {
		if (!props.open) return []
		const tag = model.page._tag
		const autocomplete = autocompleteFor(model)
		const { organizationId, userId } = props
		const on = (page: PageState["_tag"]) => tag === page
		const storage = <A>(read: (storage: PaletteStorage["Service"]) => Effect.Effect<A>) =>
			Stream.fromEffect(Effect.flatMap(Effect.service(PaletteStorage), read))
		return [
			Subscription.make("channels", [on("Home")], ([home]) =>
				home
					? channelsStream(organizationId, userId).pipe(
							Stream.map((channels) => PaletteMessage.UpdatedChannels({ channels })),
						)
					: Stream.empty,
			),
			Subscription.make("dmChannels", [on("Home")], ([home]) =>
				home
					? dmChannelsStream(organizationId, userId).pipe(
							Stream.map((dmChannels) => PaletteMessage.UpdatedDmChannels({ dmChannels })),
						)
					: Stream.empty,
			),
			Subscription.make("customers", [on("Home")], ([home]) =>
				home
					? customersStream(organizationId).pipe(
							Stream.map((customers) => PaletteMessage.UpdatedCustomers({ customers })),
						)
					: Stream.empty,
			),
			Subscription.make("recentChannelIds", [], () =>
				storage((store) => store.recentChannelIds).pipe(
					Stream.map((channelIds) => PaletteMessage.LoadedRecentChannelIds({ channelIds })),
				),
			),
			Subscription.make("recentChannels", [model.recentChannelIds.join(",")], ([ids]) =>
				ids === ""
					? Stream.empty
					: recentChannelsStream(organizationId, idsOf(ids)).pipe(
							Stream.map((channels) => PaletteMessage.UpdatedRecentChannels({ channels })),
						),
			),
			Subscription.make("presence", [on("Status")], ([status]) =>
				status
					? presenceStream(userId).pipe(
							Stream.map((value) => PaletteMessage.UpdatedPresenceStatus({ status: value })),
						)
					: Stream.empty,
			),
			Subscription.make("memberChannelIds", [on("JoinChannel")], ([join]) =>
				join
					? memberChannelIdsStream(userId).pipe(
							Stream.map((channelIds) =>
								PaletteMessage.UpdatedMemberChannelIds({ channelIds }),
							),
						)
					: Stream.empty,
			),
			Subscription.make(
				"unjoinedChannels",
				[on("JoinChannel"), model.memberChannelIds?.join(",") ?? null],
				([join, ids]) =>
					join && ids !== null
						? unjoinedChannelsStream(organizationId, idsOf(ids)).pipe(
								Stream.map((channels) =>
									PaletteMessage.UpdatedUnjoinedChannels({ channels }),
								),
							)
						: Stream.empty,
			),
			Subscription.make("recentSearches", [on("Search")], ([search]) =>
				search
					? storage((store) => store.recentSearches).pipe(
							Stream.map((searches) => PaletteMessage.LoadedRecentSearches({ searches })),
						)
					: Stream.empty,
			),
			Subscription.make(
				"suggestions",
				[autocomplete?.filterType ?? null, autocomplete?.search ?? ""],
				([filterType, search]) => {
					const toMessage = (suggestions: ReadonlyArray<Suggestion>) =>
						PaletteMessage.UpdatedSuggestions({ suggestions })
					if (filterType === null) return Stream.succeed(toMessage([]))
					if (filterType === "from")
						return userSuggestionsStream(organizationId, search).pipe(Stream.map(toMessage))
					if (filterType === "in")
						return channelSuggestionsStream(organizationId, userId, search).pipe(
							Stream.map(toMessage),
						)
					return Stream.succeed(toMessage(hasSuggestions(search)))
				},
			),
			Subscription.make(
				"localResults",
				[on("Search"), textQueryOf(model.query.text), JSON.stringify(filtersOf(model))],
				([search, query, filtersJson]) => {
					const filters = decodeFilters(filtersJson)
					return search && hasQuery(query, filters)
						? localResultsStream(organizationId, userId, query, filters).pipe(
								Stream.map((results) => PaletteMessage.UpdatedLocalResults({ results })),
							)
						: Stream.succeed(PaletteMessage.UpdatedLocalResults({ results: [] }))
				},
			),
		]
	},
	view: (h, model) => {
		const page = model.page
		const palette = h.commandPalette
			.open(h.props.open)
			.on("change", (payload) => PaletteMessage.ChangedQuery({ payload }))
			.on("select", ({ id }) => PaletteMessage.SelectedItem({ id }))
			.on("back", () => PaletteMessage.PressedBack())
			.on("dismiss", () => PaletteMessage.DismissedPalette())
		if (page._tag === "CreateChannel")
			return palette.title("Create channel").children(createChannelBody(h, page))
		if (page._tag === "JoinChannel")
			return palette.title("Join channel").children(joinChannelBody(h, model, page))
		const searching = page._tag === "Search"
		// The server answers only for text or a filter, never for `has:`; a pick in progress waits.
		const loading =
			searching &&
			autocompleteFor(model) === null &&
			toSearchRequest(h.props.organizationId, textQueryOf(model.query.text), page.filters) !== null &&
			AsyncResult.isInitial(h.queries.serverResults)
		return palette
			.placeholder(
				searching && page.filters.length > 0
					? "Add more filters or search..."
					: PLACEHOLDERS[page._tag],
			)
			.query(model.query)
			.groups(listGroups(h, model))
			.loading(loading)
			.empty(searching ? searchEmpty(h, model, page.filters) : "No results found.")
	},
})

/** The palette with its queries and Commands; the host provides `ClientData`, `HazelRpc`, storage and requests. */
export const CommandPalette = CommandPaletteNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(
			SearchMessages.layer,
			SearchCustomerUsers.layer,
			CreatePaletteChannel.layer,
			JoinPaletteChannel.layer,
			SetPresenceStatus.layer,
			TrackRecentChannel.layer,
			SaveRecentSearches.layer,
		),
	),
)
