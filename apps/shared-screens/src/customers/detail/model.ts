// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customer page's shell (today's `web-foldkit/src/page/customers/detail`, its header, sidebar
 * and dialogs): the props, Model and messages, and the pure reads the views and `update` share.
 * The tabs' content is the host's, placed in the page's `tab` slot.
 */
import { UiSchema } from "@effect/ui"
import * as Customers from "@hazel/domain/customers"
import {
	ChannelId,
	CustomerAccountId,
	CustomerChannelSuggestionId,
	type CustomerContactId,
	UserId,
} from "@hazel/schema"
import { TextField } from "@hazel/ui/vocabulary/index"
import type { Content } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Session } from "../../app/session"
import { ChannelLinkRow, ChannelOption } from "../data/channels"
import { ChatParticipantRow, CustomerAuthorInfo } from "../data/chat-authors"
import { groupIdOf, groupOf } from "../data/groups"
import { AccountRow, MemberRow } from "../data/queries"
import { EMPTY_SUGGESTIONS, SuggestionList } from "../data/suggestions"

// ROUTE

/** `?tab=` of `/$orgSlug/customers/$accountId`; none is the overview. */
export const CustomerTab = Schema.Literals(["overview", "users", "billing", "activity", "notes"])
export type CustomerTab = typeof CustomerTab.Type

/** The customer's page, on a tab (the overview has no `?tab=`). */
export const customerHref = (orgSlug: string, accountId: string, tab: CustomerTab = "overview"): string =>
	`/${orgSlug}/customers/${accountId}${tab === "overview" ? "" : `?tab=${tab}`}`

export const customersListHref = (orgSlug: string) => `/${orgSlug}/customers/list`

// PROPS

export const CustomerDetailProps = Schema.Struct({
	accountId: CustomerAccountId,
	tab: CustomerTab,
	session: Session,
	/** The shell's `(max-width: 767px)`: no side panel; the overview stacks it under the tab. */
	isMobile: Schema.Boolean,
	nowMs: Schema.Finite,
})
export type CustomerDetailProps = typeof CustomerDetailProps.Type

// MODEL

/** The company domain being added or changed: `editing` the one changed, null while adding. */
export const DomainForm = Schema.Struct({
	field: TextField.State,
	editing: Schema.NullOr(Schema.String),
	isSaving: Schema.Boolean,
})
export type DomainForm = typeof DomainForm.Type

export const CustomerDetailModel = Schema.Struct({
	/** Live rows; null until each query answers. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	/** The synced list has had this account: it leaving then means merged or deleted. */
	hasSeenAccount: Schema.Boolean,
	noteCount: Schema.NullOr(Schema.Int),
	members: Schema.Array(MemberRow),
	connectedProviders: Schema.Array(Customers.CustomerProvider),
	channelLinks: Schema.Array(ChannelLinkRow),
	channelOptions: Schema.Array(ChannelOption),
	chatParticipants: Schema.Array(ChatParticipantRow),
	chatAuthors: Schema.Array(CustomerAuthorInfo),
	createdFeatureFlags: Schema.Array(Schema.String),
	/** Counts "Try again": a failed detail is fetched again under a new key. */
	detailAttempt: Schema.Int,
	/** Accepted or dismissed suggestions, kept out of the query's answers. */
	hiddenSuggestions: Schema.Array(CustomerChannelSuggestionId),
	isSidebarOpen: Schema.Boolean,
	isTagPickerOpen: Schema.Boolean,
	tagInput: TextField.State,
	isChannelPickerOpen: Schema.Boolean,
	channelSearch: TextField.State,
	isFlagPickerOpen: Schema.Boolean,
	flagSelection: Schema.Array(Schema.String),
	domain: DomainForm,
	/** When this page last asked for a company lookup, and the account's last check at that press. */
	companyRefreshAtMs: Schema.NullOr(Schema.Finite),
	companyCheckedAtPressMs: Schema.NullOr(Schema.Finite),
})
export type CustomerDetailModel = typeof CustomerDetailModel.Type

export const initialModel: CustomerDetailModel = {
	accounts: null,
	hasSeenAccount: false,
	noteCount: null,
	members: [],
	connectedProviders: [],
	channelLinks: [],
	channelOptions: [],
	chatParticipants: [],
	chatAuthors: [],
	createdFeatureFlags: [],
	detailAttempt: 0,
	hiddenSuggestions: [],
	isSidebarOpen: true,
	isTagPickerOpen: false,
	tagInput: TextField.empty,
	isChannelPickerOpen: false,
	channelSearch: TextField.empty,
	isFlagPickerOpen: false,
	flagSelection: [],
	domain: { field: TextField.empty, editing: null, isSaving: false },
	companyRefreshAtMs: null,
	companyCheckedAtPressMs: null,
}

// MESSAGES

/** Which account write failed, for its toast. */
export const AccountWrite = Schema.Literals(["owner", "tags", "mute", "regroup", "flags"])
export type AccountWrite = typeof AccountWrite.Type

export const CustomerDetailMessage = UiSchema.TaggedEnum({
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedNoteCount: { count: Schema.Int },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	UpdatedConnectedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedChannelLinks: { links: Schema.Array(ChannelLinkRow) },
	UpdatedChannelOptions: { channels: Schema.Array(ChannelOption) },
	UpdatedChatParticipants: { participants: Schema.Array(ChatParticipantRow) },
	UpdatedChatAuthors: { authors: Schema.Array(CustomerAuthorInfo) },
	UpdatedCreatedFeatureFlags: { keys: Schema.Array(Schema.String) },
	PressedNeighbour: { step: Schema.Literals([-1, 1]) },
	PressedToggleSidebar: {},
	PressedRetryDetail: {},
	SelectedTab: { tab: CustomerTab },
	PressedAddNote: {},
	SelectedOwner: { id: Schema.String },
	SelectedAction: { id: Schema.String },
	SelectedEnvironment: { id: Schema.String },
	PressedRemoveTag: { tag: Schema.String },
	PressedAddTag: {},
	DismissedTagPicker: {},
	ChangedTagInput: { payload: TextField.ChangePayload },
	SubmittedTag: { payload: TextField.ChangePayload },
	PressedSaveTag: {},
	PressedRefreshCompany: {},
	PressedChangeDomain: { domain: Schema.String },
	PressedCancelDomain: {},
	ChangedDomain: { payload: TextField.ChangePayload },
	SubmittedDomain: { payload: TextField.ChangePayload },
	PressedSaveDomain: {},
	PressedLinkChannelPicker: {},
	DismissedChannelPicker: {},
	ChangedChannelSearch: { payload: TextField.ChangePayload },
	PressedLinkChannel: { channelId: ChannelId },
	PressedUnlinkChannel: { channelId: ChannelId },
	PressedAcceptSuggestion: { suggestionId: CustomerChannelSuggestionId },
	PressedDismissSuggestion: { suggestionId: CustomerChannelSuggestionId },
	SelectedChatPersonEntry: { userId: UserId, id: Schema.String },
	PressedAddFlagsPicker: {},
	DismissedFlagPicker: {},
	ToggledFlag: { key: Schema.String, checked: Schema.Boolean },
	PressedAddFlags: {},
	PressedRemoveFlag: { key: Schema.String },
	PressedCopy: { text: Schema.String, label: Schema.String },
	SucceededCopy: { label: Schema.String },
	FailedCopy: {},
	FailedAccountWrite: { write: AccountWrite, message: Schema.NullOr(Schema.String) },
	SucceededAddDomain: {},
	FailedAddDomain: { message: Schema.NullOr(Schema.String) },
	FailedCompanyRefresh: { message: Schema.NullOr(Schema.String) },
	FailedChannelWrite: { action: Schema.Literals(["link", "unlink"]), reason: Schema.String },
	FailedSuggestionAction: {
		suggestionId: CustomerChannelSuggestionId,
		action: Schema.Literals(["accept", "dismiss"]),
	},
	FailedChatPersonSide: {},
})
export type CustomerDetailMessage = typeof CustomerDetailMessage.Type

// WHAT IS SHOWN

type State = Readonly<{ model: CustomerDetailModel; accountId: CustomerAccountId }>

export const accountOf = ({ model, accountId }: State): AccountRow | undefined =>
	model.accounts?.find((account) => account.id === accountId)

/** "2 of 214": this account's place among all of them (by name), and its neighbours. */
export const positionOf = ({ model, accountId }: State) => {
	const accounts = model.accounts ?? []
	const index = accounts.findIndex((account) => account.id === accountId)
	if (index < 0) return null
	return {
		index,
		total: accounts.length,
		previous: accounts[index - 1] ?? null,
		next: accounts[index + 1] ?? null,
	}
}

/** The detail RPC's refusal as the page keeps it. */
export const DetailFailure = Schema.Literals(["NotFound", "Other"])
export type DetailFailure = typeof DetailFailure.Type

/**
 * Gone: the RPC says so, or the synced list lacks it, having loaded without it (a new account may
 * reach the RPC first) or dropped it (merged or deleted while shown).
 */
export const isNotFound = (state: State, detail: "Loading" | "Loaded" | DetailFailure): boolean =>
	detail === "NotFound" ||
	(state.model.accounts !== null &&
		accountOf(state) === undefined &&
		(detail !== "Loaded" || state.model.hasSeenAccount))

/** This customer's environments, primary first; empty when it stands alone. */
export const groupOfState = ({ model, accountId }: State): ReadonlyArray<AccountRow> =>
	groupOf(model.accounts ?? [], accountId)

/** The customer an account belongs to: its group's live primary, else itself. */
export const customerOfAccount = (
	accounts: ReadonlyArray<AccountRow> | null,
): ((accountId: CustomerAccountId) => CustomerAccountId) => {
	const rows = accounts ?? []
	const liveIds = new Set<string>(rows.map((account) => account.id))
	const byId = new Map(rows.map((account) => [account.id, account]))
	return (accountId) => {
		const account = byId.get(accountId)
		return account === undefined ? accountId : groupIdOf(account, liveIds)
	}
}

/** The primary this account is an environment of; null for a primary or a standalone account. */
export const primaryOf = (state: State): AccountRow | null => {
	const [primary] = groupOfState(state)
	return primary === undefined || primary.id === state.accountId ? null : primary
}

/** Which subscription's renewal the panel shows: a billing one first; a canceled one never. */
const RENEWAL_RANK = {
	active: 0,
	trialing: 0,
	past_due: 0,
	unpaid: 1,
	paused: 2,
	canceled: 3,
} as const satisfies Record<Customers.SubscriptionStatus, number>

export const renewingSubscriptionOf = (
	subscriptions: ReadonlyArray<Customers.Subscription>,
): Customers.Subscription | undefined =>
	subscriptions
		.filter((entry) => entry.status !== "canceled")
		.toSorted((left, right) => RENEWAL_RANK[left.status] - RENEWAL_RANK[right.status])[0]

// FEATURE FLAGS

/** The flags: the ones created in Hazel and every key a live account holds (on or off), sorted. */
export const featureFlagKeysOf = (
	created: ReadonlyArray<string>,
	accounts: ReadonlyArray<AccountRow>,
): ReadonlyArray<string> =>
	[...new Set([...created, ...accounts.flatMap((account) => Object.keys(account.featureFlags))])].sort()

export const hasFlag = (account: AccountRow, key: string): boolean => account.featureFlags[key] === true

// MENUS

export const OWNER_NONE = "none"
const OWNER_USER = "user:"
export const ownerKeyOf = (userId: UserId) => `${OWNER_USER}${userId}`
export const userIdOfOwnerKey = (key: string): string | null =>
	key.startsWith(OWNER_USER) ? key.slice(OWNER_USER.length) : null

export const ownerEntries = (members: ReadonlyArray<MemberRow>): Content.MenuGroups => [
	{ entries: members.map((member) => ({ id: ownerKeyOf(member.id), label: member.name })) },
	{ entries: [{ id: OWNER_NONE, label: "Remove owner" }] },
]

/** Leaf keys of the "Mute in Needs attention" submenu. */
export const MUTE_KEYS = ["mute:week", "mute:month", "mute:forever"] as const
export type MuteKey = (typeof MUTE_KEYS)[number]
export const MUTE_LABEL = {
	"mute:week": "For a week",
	"mute:month": "For a month",
	"mute:forever": "Until unmuted",
} as const satisfies Record<MuteKey, string>
export const isMuteKey = (key: string): key is MuteKey => (MUTE_KEYS as ReadonlyArray<string>).includes(key)

/** When the mute ends: 7 or 30 days from now, or never (null). */
export const muteUntilMs = (key: MuteKey, nowMs: number): number | null =>
	key === "mute:forever" ? null : nowMs + (key === "mute:week" ? 7 : 30) * 86_400_000

export const ActionKey = Schema.Literals([
	"copy_link",
	"change_owner",
	"mute_attention",
	"unmute_attention",
	"recompute",
	"link_source",
	"link_customer",
	"make_primary",
	"unlink",
	"name_environment",
	"raw_data",
	"archive",
])
export type ActionKey = typeof ActionKey.Type

const ACTION_LABEL = {
	copy_link: "Copy link to customer",
	change_owner: "Change owner…",
	mute_attention: "Mute in Needs attention",
	unmute_attention: "Unmute in Needs attention",
	recompute: "Recompute signals",
	link_source: "Link a source record…",
	link_customer: "Link to another customer…",
	make_primary: "Make primary",
	unlink: "Unlink from its primary",
	name_environment: "Name environment…",
	raw_data: "View raw data",
	archive: "Archive customer…",
} as const satisfies Record<ActionKey, string>

/**
 * What the RPCs support runs; the rest shows, disabled. A muted customer offers Unmute; else Mute
 * with its three lengths. Grouping is for admins: linking, naming the environment, and for an
 * environment making it primary or unlinking it.
 */
export const actionEntries = (state: State, isAdmin: boolean, account: AccountRow): Content.MenuGroups => {
	const primary = primaryOf(state)
	const isMuted = account.attentionMutedAtMs !== null
	const label = (key: ActionKey): string =>
		key === "unlink" && primary !== null
			? `Unlink from ${primary.environment === null ? primary.name : `${primary.name} (${primary.environment})`}`
			: key === "name_environment" && account.environment !== null
				? "Rename environment…"
				: ACTION_LABEL[key]
	const item = (key: ActionKey, extra: Partial<Content.MenuEntry> = {}): Content.MenuEntry => ({
		id: key,
		label: label(key),
		...extra,
	})
	// HAZEL-GAP(pk5-menu-entry-description): today's items carry a second line (why Recompute,
	// Link a source record and Archive are off, and until when Unmute runs).
	return [
		{
			entries: [
				item("copy_link"),
				item("change_owner"),
				isMuted
					? item("unmute_attention")
					: item("mute_attention", {
							entries: MUTE_KEYS.map((key) => ({ id: key, label: MUTE_LABEL[key] })),
						}),
				item("recompute", { disabled: true }),
			],
		},
		{
			entries: [
				item("link_source", { disabled: true }),
				...(isAdmin
					? [
							item("link_customer"),
							...(primary !== null ? [item("make_primary"), item("unlink")] : []),
							item("name_environment"),
						]
					: []),
				item("raw_data"),
			],
		},
		{ entries: [item("archive", { disabled: true, destructive: true })] },
	]
}

/** The environment menu: the customer's accounts, primary first, this one checked. */
export const environmentEntries = (state: State): Content.MenuGroups => {
	const group = groupOfState(state)
	return [
		{
			entries: group.map((account, index) => ({
				id: account.id,
				label: `${account.environment ?? "Unnamed environment"}${index === 0 ? " · Primary" : ""}`,
				checked: account.id === state.accountId,
			})),
		},
	]
}

// PEOPLE IN CHAT

/** Someone shown in "People in chat"; `side` and `override` are the org's latest. */
export interface ChatPerson {
	readonly userId: UserId
	readonly name: string
	readonly avatarUrl: string | null
	readonly side: Customers.AuthorSide
	readonly reason: Customers.AuthorSideReason
	readonly override: Customers.AuthorSideOverride | null
	readonly contactId: CustomerContactId | null
	readonly lastMessageAtMs: number
}

/**
 * The customer's people: its participants on the customer side, or marked as our team, once each,
 * newest first. The author row (the org source) wins over the participant's copy.
 */
export const chatPeopleOf = (
	participants: ReadonlyArray<ChatParticipantRow>,
	authors: ReadonlyArray<CustomerAuthorInfo>,
	customerId: CustomerAccountId,
	customerOf: (accountId: CustomerAccountId) => CustomerAccountId,
): ReadonlyArray<ChatPerson> => {
	const authorsById = new Map(authors.map((author) => [author.userId, author]))
	const newest = new Map<UserId, ChatParticipantRow>()
	for (const participant of participants) {
		if (customerOf(participant.accountId) !== customerId) continue
		const held = newest.get(participant.userId)
		if (held === undefined || participant.lastMessageAtMs > held.lastMessageAtMs)
			newest.set(participant.userId, participant)
	}
	return [...newest.values()]
		.flatMap((participant): ReadonlyArray<ChatPerson> => {
			const author = authorsById.get(participant.userId)
			const side = author?.side ?? participant.side
			const override = author?.override ?? null
			// Bots stay bots whatever the override.
			if (side === "bot" || (side !== "customer" && override !== "team")) return []
			return [
				{
					userId: participant.userId,
					name: participant.name,
					avatarUrl: participant.avatarUrl,
					side,
					reason: author?.reason ?? participant.reason,
					override,
					contactId: participant.contactId,
					lastMessageAtMs: participant.lastMessageAtMs,
				},
			]
		})
		.sort((left, right) => right.lastMessageAtMs - left.lastMessageAtMs)
}

export const ChatPersonKey = Schema.Literals(["mark_team", "mark_customer", "reset"])
export type ChatPersonKey = typeof ChatPersonKey.Type

const CHAT_PERSON_LABEL = {
	mark_team: "Mark as team",
	mark_customer: "Mark as customer",
	reset: "Reset to automatic",
} as const satisfies Record<ChatPersonKey, string>

/** The override each key sets (`null` clears it). */
export const CHAT_PERSON_SIDE = {
	mark_team: "team",
	mark_customer: "customer",
	reset: null,
} as const satisfies Record<ChatPersonKey, Customers.AuthorSideOverride | null>

/** The other side, and Reset while a member's mark is set. */
export const chatPersonEntries = (person: ChatPerson): Content.MenuGroups => [
	{
		entries: [
			person.side === "customer"
				? { id: "mark_team", label: CHAT_PERSON_LABEL.mark_team }
				: { id: "mark_customer", label: CHAT_PERSON_LABEL.mark_customer },
		],
	},
	...(person.override === null ? [] : [{ entries: [{ id: "reset", label: CHAT_PERSON_LABEL.reset }] }]),
]

// SUGGESTIONS

export const suggestionsOf = (
	items: ReadonlyArray<Customers.ChannelSuggestion> | null,
	hidden: ReadonlyArray<CustomerChannelSuggestionId>,
): SuggestionList => ({ ...EMPTY_SUGGESTIONS, items, hidden })

// COMPANY LOOKUP

/** A refresh within this long of the last answer changes nothing on the server: that answer is the press's. */
const COMPANY_REFRESH_COOLDOWN_MS = 60_000
/** How long a requested lookup may still be running (two calls of up to 75 s, after the next alarm). */
export const COMPANY_REFRESH_PENDING_MS = 5 * 60_000

const answers = (checkedAtMs: number | null, requestedAtMs: number) =>
	checkedAtMs !== null && checkedAtMs >= requestedAtMs - COMPANY_REFRESH_COOLDOWN_MS

/** This page's company lookup is still on its way: asked, and the account not checked since. */
export const isCompanyRefreshPending = (
	model: CustomerDetailModel,
	nowMs: number,
	checkedAtMs: number | null,
): boolean =>
	model.companyRefreshAtMs !== null &&
	nowMs - model.companyRefreshAtMs < COMPANY_REFRESH_PENDING_MS &&
	!answers(checkedAtMs, model.companyRefreshAtMs)

/** This page asked, the window passed, and the account was not checked since: the lookup failed. */
export const isCompanyRefreshUnanswered = (
	model: CustomerDetailModel,
	nowMs: number,
	checkedAtMs: number | null,
): boolean =>
	model.companyRefreshAtMs !== null &&
	!isCompanyRefreshPending(model, nowMs, checkedAtMs) &&
	!answers(checkedAtMs, model.companyRefreshAtMs)
