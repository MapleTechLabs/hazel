import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId } from "@hazel/schema"
import { Option } from "effect"
import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { formatCount, formatDate, formatMoney, formatRelative } from "../../../customers/format"
import { accountLabelOf, environmentCounts, environmentsHintOf } from "../../../customers/groups"
import { environmentBadge, healthBadge, stageBadge } from "../../../customers/ui/badges"
import { viewTabs } from "../../../customers/ui/filter-bar"
import { linkClass } from "../../../customers/ui/surface"
import {
	companyLogo,
	menuAvatar,
	personLabel,
	SOURCE_LABEL,
	sourceLogo,
} from "../../../customers/ui/identity"
import {
	IconArrowPath,
	IconChevronDown,
	IconCheck,
	IconChevronRight,
	IconClose,
	IconDots,
	IconEdit,
	IconPlus,
	IconSidebarRight,
} from "../../../icons"
import {
	type ChannelLinkRow,
	type ChannelOption,
	channelMark,
	ORIGIN_LABEL,
	searchOptions,
} from "../../../customers/channels"
import { shownSuggestions, suggestionRow } from "../../../customers/suggestions"
import { featureFlagKeysOf, hasFlag } from "../../../customers/feature-flags"
import { safeSourceUrl } from "../../../customers/providers"
import { attentionMuteLabel, isAttentionMuted } from "../../../customers/queries"
import { isMuteKey, MUTE_LABEL } from "../../../customers/ui/menus"
import { AppRoute, hrefOf } from "../../../route"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { checkbox } from "../../../ui/checkbox"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import { input } from "../../../ui/input"
import { radioGroup } from "../../../ui/radio"
import { searchField } from "../../../ui/search-field"
import { textField } from "../../../ui/text-field"
import { link } from "../../../ui/link"
import { menuDescription, menuLabel } from "../../../ui/menu-view"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"
import type { PageViewInputs } from "../../contract"
import { isCustomersAdmin } from "../settings/shared"
import { activityTab } from "./activity-tab"
import { billingTab } from "./billing-tab"
import { impersonateDialog } from "./impersonate-dialog"
import { Message } from "./message"
import {
	accountOf,
	type ActionKey,
	actionEntries,
	customerOfAccount,
	ENVIRONMENT_INPUT_ID,
	environmentEntries,
	groupOfModel,
	isNotFound,
	LINK_SEARCH_ID,
	linkCandidates,
	type Model,
	OWNER_NONE,
	ownerEntries,
	positionOf,
	renewingSubscriptionOf,
	primaryOf,
	userIdOfOwnerKey,
} from "./model"
import { notesTab } from "./notes-tab"
import { peopleInChat } from "./people-in-chat"
import { overviewTab } from "./overview-tab"
import { companySection } from "./company-section"
import { type Context, icon, memberOf, menu, property, sidebarSection } from "./parts"
import { usersTab } from "./users-tab"
import { heading } from "../../../ui/heading"

/** The customer page (Wonder: Customer Page — overview, users, billing, activity, notes, header menu). */

const ACTION_LABEL = {
	copy_link: "Copy link to customer",
	change_owner: "Change owner…",
	mute_attention: "Mute in Needs attention",
	unmute_attention: "Unmute in Needs attention",
	recompute: "Recompute health and signals",
	link_source: "Link a source record…",
	link_customer: "Link to another customer…",
	make_primary: "Make primary",
	unlink: "Unlink from its primary",
	name_environment: "Name environment…",
	raw_data: "View raw data",
	archive: "Archive customer…",
} as const satisfies Record<ActionKey, string>

const ACTION_REASON = new Map<ActionKey, string>([
	["recompute", "Runs on its own every hour; no manual trigger yet."],
	["link_source", "Link records from Data sources › Unmatched for now."],
	["archive", "Not available yet."],
])

const LINK_LABEL = {
	clerk: "Clerk organization",
	stripe: "Stripe customer",
	autumn: "Autumn customer",
	maple: "Maple group",
} as const satisfies Record<Customers.CustomerProvider, string>

const MATCH_LABEL = {
	existing: "existing link",
	shared_id: "shared ID",
	domain: "domain",
	manual: "linked by hand",
	created: "created from this record",
} as const satisfies Record<Customers.MatchMethod, string>

// LINKS

const attentionMutedBadge = (h: HtmlBuilder<Message>, account: Context["account"]): ReadonlyArray<Html> =>
	isAttentionMuted(account) ? [badge(h, { intent: "secondary" }, ["Attention muted"])] : []

/** The account's site: a link only when the domain is a plain host (it is provider data). */
const domainLink = (h: HtmlBuilder<Message>, domain: string): Html => {
	const href = Option.liftThrowable(() => new URL(`https://${domain}`))().pipe(
		Option.filter((url) => url.hostname === domain.toLowerCase()),
		Option.map((url) => url.href),
	)
	return Option.match(href, {
		onNone: () => h.span([h.Class("block truncate text-fg-2")], [domain]),
		onSome: (site) =>
			h.a(
				[
					h.Href(site),
					h.Attribute("target", "_blank"),
					h.Attribute("rel", "noreferrer"),
					h.Class(
						"block truncate rounded-sm text-fg-2 outline-hidden hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-ring/70",
					),
					h.Title(domain),
				],
				[domain],
			),
	})
}

/** `Open` to the record in its provider, when its URL is on the provider's hosts (`safeSourceUrl`). */
const recordLink = (
	h: HtmlBuilder<Message>,
	ref: Readonly<{ provider: Customers.CustomerSource; externalUrl: string | null }>,
): ReadonlyArray<Html> => {
	const href = safeSourceUrl(ref.provider, ref.externalUrl)
	return href === null
		? []
		: [
				h.a(
					[
						h.Href(href),
						h.Attribute("target", "_blank"),
						h.Attribute("rel", "noreferrer"),
						h.AriaLabel(`Open in ${SOURCE_LABEL[ref.provider]}`),
						h.Class(twMerge(linkClass, "text-xs")),
					],
					["Open"],
				),
			]
}

// HEADER

/** An action's label; the grouping ones name what they act on. */
const actionLabel = (model: Model, account: Context["account"], key: string): string => {
	const primary = primaryOf(model)
	if (key === "unlink" && primary !== null) return `Unlink from ${accountLabelOf(primary)}`
	if (key === "name_environment" && account.environment !== null) return "Rename environment…"
	return ACTION_LABEL[key as ActionKey] ?? key
}

/**
 * Beside the name: the account's environment, and for a customer with several a menu of them
 * (primary first) to switch to another.
 */
const environmentSwitch = (h: HtmlBuilder<Message>, model: Model, context: Context): ReadonlyArray<Html> => {
	const group = groupOfModel(model)
	const environment = context.account.environment
	if (group.length === 0) return environment === null ? [] : [environmentBadge(h, environment)]
	return [
		menu(h, model.environmentMenu, {
			entries: environmentEntries(model),
			trigger: (attributes, overlay) =>
				button(
					h,
					{
						intent: "outline",
						size: "xs",
						className: "max-w-48",
						attributes: [...attributes, h.AriaLabel(`Environment: ${environment ?? "unnamed"}`)],
					},
					[
						h.span([h.Class("min-w-0 truncate")], [environment ?? "Environments"]),
						IconChevronDown(h, icon),
						overlay,
					],
				),
			content: (key) => {
				const account = group.find((member) => member.id === key)
				if (account === undefined) return []
				return [
					menuLabel(h, model.environmentMenu.id, key, [
						h.span(
							[h.Class("flex min-w-0 items-center gap-2")],
							[
								h.span(
									[
										h.Class(
											twMerge(
												"truncate",
												account.environment === null && "text-muted-fg",
											),
										),
									],
									[account.environment ?? "Unnamed environment"],
								),
								...(account.id === group[0]?.id
									? [h.span([h.Class("text-muted-fg text-xs")], ["Primary"])]
									: []),
								...(account.id === model.accountId
									? [IconCheck(h, { className: "ml-auto size-3.5 shrink-0" })]
									: []),
							],
						),
					]),
				]
			},
			toMessage: (message) => Message.GotEnvironmentMenuMessage({ message }),
			className: "min-w-48",
		}),
	]
}

/** The header's owner picker; the sidebar only shows the owner (one Menu model, one rendering). */
const ownerMenu = (h: HtmlBuilder<Message>, model: Model, context: Context): Html =>
	menu(h, model.ownerMenu, {
		entries: ownerEntries(model.members),
		trigger: (attributes, overlay) =>
			button(
				h,
				{
					intent: "outline",
					size: "sm",
					// A long owner name truncates in the button, not past the page's edge.
					className: "max-w-48",
					attributes: [...attributes, h.AriaLabel("Owner")],
				},
				[
					personLabel(h, memberOf(context, context.account.ownerUserId)),
					IconChevronDown(h, { className: "size-3" }),
					overlay,
				],
			),
		content: (key) => {
			const member = model.members.find((entry) => entry.id === userIdOfOwnerKey(key)) ?? null
			return [
				menuAvatar(h, key === OWNER_NONE ? null : member),
				menuLabel(
					h,
					model.ownerMenu.id,
					key,
					key === OWNER_NONE ? "Remove owner" : (member?.name ?? key),
				),
			]
		},
		toMessage: (message) => Message.GotOwnerMenuMessage({ message }),
		className: "min-w-56",
	})

const topBar = (h: HtmlBuilder<Message>, model: Model, context: Context | null, orgSlug: string): Html => {
	const position = positionOf(model)
	const navButton = (step: -1 | 1, label: string, isDisabled: boolean) =>
		h.button(
			[
				h.Type("button"),
				h.AriaLabel(label),
				h.Disabled(isDisabled),
				h.OnClick(Message.PressedNeighbour({ step })),
				h.Class(
					"inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-fg outline-hidden transition-colors hover:bg-secondary hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent max-md:size-10",
				),
			],
			[IconChevronDown(h, { className: twMerge("size-3.5", step === -1 && "rotate-180") })],
		)
	return h.div(
		[
			h.Class(
				"flex h-12 shrink-0 items-center justify-between gap-4 border-border border-b px-4 lg:px-6",
			),
		],
		[
			h.nav(
				[h.AriaLabel("Breadcrumb"), h.Class("flex min-w-0 items-center gap-1.5 text-sm")],
				[
					h.a(
						[
							h.Href(hrefOf(AppRoute.CustomersList({ orgSlug, view: Option.none() }))),
							h.Class("text-muted-fg hover:text-fg"),
						],
						["Customers"],
					),
					IconChevronRight(h, { className: "size-3 text-muted-fg" }),
					h.span(
						[h.AriaCurrent("page"), h.Class("truncate font-medium text-fg")],
						[context?.account.name ?? "…"],
					),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-1")],
				[
					...(position === null
						? []
						: [
								h.span(
									[
										h.Class(
											"whitespace-nowrap pr-1 text-muted-fg text-xs tabular-nums max-md:hidden",
										),
									],
									[`${formatCount(position.index + 1)} of ${formatCount(position.total)}`],
								),
								navButton(-1, "Previous customer", position.previous === null),
								navButton(1, "Next customer", position.next === null),
							]),
					h.button(
						[
							h.Type("button"),
							h.AriaLabel(model.isSidebarOpen ? "Hide details" : "Show details"),
							h.AriaPressed(model.isSidebarOpen ? "true" : "false"),
							h.OnClick(Message.ToggledSidebar()),
							h.Class(
								twMerge(
									// A phone has no side panel to toggle: its details sit under the overview.
									"ml-1 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-fg outline-hidden transition-colors hover:bg-secondary hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70 max-md:hidden",
									model.isSidebarOpen && "bg-secondary text-fg",
								),
							),
						],
						[IconSidebarRight(h, { className: "size-4" })],
					),
				],
			),
		],
	)
}

const header = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const { account } = context
	const meta = [
		account.planName,
		account.mrrMinor > 0 ? `${formatMoney(account.mrrMinor, account.currency)}/mo` : null,
	].filter((part) => part !== null)
	return h.div(
		[h.Class("px-4 pt-5 lg:px-6")],
		[
			h.div(
				[
					h.Class(
						"flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-3",
					),
				],
				[
					h.div(
						[h.Class("flex min-w-0 items-center gap-3")],
						[
							companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "md" }),
							h.div(
								[h.Class("flex min-w-0 flex-col gap-0.5")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											heading(
												h,
												{ variant: "title", level: 1, className: "wrap-anywhere" },
												[account.name],
											),
											...environmentSwitch(h, model, context),
											healthBadge(h, {
												status: account.healthStatus,
												score: account.healthScore,
											}),
											...attentionMutedBadge(h, account),
										],
									),
									// Each part's dot sits in the gap before it, so a wrapped line starts
									// with a part, not a dot: the dot of a line's first part is clipped.
									// `pr-4` keeps a part's `max-w-full` inside: a long domain truncates.
									h.div(
										[h.Class("overflow-hidden text-muted-fg text-sm")],
										[
											h.p(
												[h.Class("-ml-4 flex flex-wrap items-center pr-4")],
												[
													...(account.domain === null
														? []
														: [domainLink(h, account.domain)]),
													...meta.map((part) => h.span([], [part])),
												].map((part) =>
													h.span(
														[
															h.Class(
																"relative ml-4 max-w-full whitespace-nowrap before:absolute before:-left-2.5 before:content-['·']",
															),
														],
														[part],
													),
												),
											),
										],
									),
								],
							),
						],
					),
					h.div(
						[h.Class("flex shrink-0 items-center gap-2")],
						[
							ownerMenu(h, model, context),
							button(h, { intent: "outline", size: "sm", onPress: Message.PressedAddNote() }, [
								IconEdit(h, icon),
								"Add note",
							]),
							menu(h, model.actionsMenu, {
								entries: actionEntries(model, context.isAdmin, isAttentionMuted(account)),
								trigger: (attributes, overlay) =>
									button(
										h,
										{
											intent: "outline",
											size: "sm",
											className: "px-2",
											attributes: [...attributes, h.AriaLabel("More actions")],
										},
										[IconDots(h, icon), overlay],
									),
								content: (key) => {
									if (isMuteKey(key)) {
										return [menuLabel(h, model.actionsMenu.id, key, MUTE_LABEL[key])]
									}
									const reason =
										key === "unmute_attention"
											? (attentionMuteLabel(account, context.nowMs) ?? undefined)
											: ACTION_REASON.get(key as ActionKey)
									return [
										menuLabel(
											h,
											model.actionsMenu.id,
											key,
											actionLabel(model, account, key),
										),
										...(reason === undefined
											? []
											: [
													menuDescription(
														h,
														model.actionsMenu.id,
														key,
														reason,
														"text-xs",
													),
												]),
									]
								},
								toMessage: (message) => Message.GotActionsMenuMessage({ message }),
								className: "min-w-72",
							}),
						],
					),
				],
			),
		],
	)
}

const tabsRow = (h: HtmlBuilder<Message>, model: Model, context: Context): Html =>
	h.div(
		[h.Class("border-border border-b px-4 lg:px-6")],
		[
			viewTabs(h, {
				ariaLabel: "Customer",
				className: "border-b-0",
				tabs: [
					{ key: "overview", label: "Overview" },
					{ key: "users", label: "Users", count: context.account.contactCount },
					{ key: "billing", label: "Billing" },
					{ key: "activity", label: "Activity" },
					{
						key: "notes",
						label: "Notes",
						count: model.notes === null ? undefined : model.notes.length,
					},
				],
				selected: model.tab,
				onSelect: (tab) => Message.ClickedTab({ tab }),
			}),
		],
	)

// SIDEBAR

const tags = (h: HtmlBuilder<Message>, model: Model, context: Context): Html =>
	h.div(
		[h.Class("flex flex-wrap items-center gap-1")],
		[
			...context.account.tags.map((tag) =>
				h.span(
					[
						h.Key(tag),
						h.Class(
							"inline-flex items-center gap-1 rounded bg-secondary py-0.5 pr-1 pl-1.5 text-secondary-fg text-xs",
						),
					],
					[
						tag,
						h.button(
							[
								h.Type("button"),
								h.AriaLabel(`Remove tag ${tag}`),
								h.OnClick(Message.RemovedTag({ tag })),
								h.Class(
									"inline-flex cursor-pointer rounded text-muted-fg hover:text-fg max-md:p-1.5",
								),
							],
							[IconClose(h, { className: "size-2.5" })],
						),
					],
				),
			),
			h.submodel({
				slotId: model.tagPopover.id,
				model: model.tagPopover,
				view: Popover.view,
				viewInputs: {
					toTrigger: (attributes) =>
						h.button(
							[
								...attributes,
								h.AriaLabel("Add tag"),
								h.Class(
									"inline-flex size-5 cursor-pointer items-center justify-center rounded border border-border text-muted-fg hover:text-fg max-md:size-8",
								),
							],
							[IconPlus(h, { className: "size-3" })],
						),
					toContent: () => [
						h.form(
							[h.Class("flex w-56 flex-col gap-2 p-2"), h.OnSubmit(Message.SubmittedTag())],
							[
								input(h, {
									placeholder: "Tag name",
									attributes: [
										h.AriaLabel("Tag name"),
										h.Value(model.tagInput),
										h.OnInput((value) => Message.ChangedTagInput({ value })),
									],
								}),
								button(
									h,
									{
										size: "sm",
										isDisabled: model.tagInput.trim() === "",
										attributes: [h.Type("submit")],
									},
									["Add tag"],
								),
							],
						),
					],
					placement: "bottom start",
				},
				toParentMessage: (message) => Message.GotTagPopoverMessage({ message }),
			}),
		],
	)

/** One linked channel: its mark, name (opens it), origin, and unlink. */
const linkedChannelRow = (
	h: HtmlBuilder<Message>,
	context: Context,
	entry: ChannelLinkRow,
	channel: ChannelOption | undefined,
): Html => {
	const channelId = entry.channelId
	return h.div(
		[h.Key(channelId), h.Class("flex items-center gap-2 rounded-lg border border-border px-3 py-2")],
		[
			channel === undefined
				? channelMark(h, { origin: "hazel", isPrivate: true })
				: channelMark(h, channel),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				channel === undefined
					? [h.span([h.Class("truncate text-muted-fg text-sm")], ["A channel you can't see"])]
					: [
							link(
								h,
								{
									href: hrefOf(
										AppRoute.ChatChannel({
											orgSlug: context.orgSlug,
											channelId: channel.id,
										}),
									),
									className: "truncate font-medium text-fg text-sm",
								},
								[channel.name],
							),
							h.span(
								[h.Class("text-muted-fg text-xs")],
								[
									entry.linkedBy === null
										? `${ORIGIN_LABEL[channel.origin]} · Linked automatically`
										: ORIGIN_LABEL[channel.origin],
								],
							),
						],
			),
			button(
				h,
				{
					intent: "plain",
					size: "sq-xs",
					onPress: Message.PressedUnlinkChannel({ channelId }),
					attributes: [
						h.AriaLabel(channel === undefined ? "Unlink channel" : `Unlink ${channel.name}`),
					],
				},
				[IconClose(h, icon)],
			),
		],
	)
}

/** The customer's open suggestions (hidden when none): one click links, × dismisses. */
const suggestedChannels = (
	h: HtmlBuilder<Message>,
	model: Model,
	customer: string,
	linkedHere: ReadonlySet<string>,
): ReadonlyArray<Html> => {
	const customerOf = customerOfAccount(model)
	const shown = shownSuggestions(model.suggestions, model.channelOptions).filter(
		({ suggestion }) =>
			customerOf(suggestion.accountId) === customer && !linkedHere.has(suggestion.channelId),
	)
	if (shown.length === 0) return []
	return [
		h.div(
			[h.Class("flex flex-col pt-2")],
			[
				heading(h, { variant: "label", level: 3 }, ["Suggested"]),
				h.ul(
					[h.Class("flex flex-col divide-y divide-border"), h.AriaLabel("Suggested channels")],
					shown.map((entry) =>
						suggestionRow(h, {
							shown: entry,
							showAccount: false,
							onLink: Message.PressedAcceptSuggestion({ suggestionId: entry.suggestion.id }),
							onDismiss: Message.PressedDismissSuggestion({
								suggestionId: entry.suggestion.id,
							}),
						}),
					),
				),
			],
		),
	]
}

/** The channel picker: search the org's channels; one linked elsewhere says where (it moves here). */
const channelPicker = (h: HtmlBuilder<Message>, model: Model, linkedHere: ReadonlySet<string>): Html => {
	const customerOf = customerOfAccount(model)
	const owners = new Map(model.channelLinks.map((entry) => [entry.channelId, customerOf(entry.accountId)]))
	const names = new Map((model.accounts ?? []).map((account) => [account.id, account.name]))
	const candidates = searchOptions(
		model.channelOptions.filter((channel) => !linkedHere.has(channel.id)),
		model.channelSearch,
	)
	return h.submodel({
		slotId: model.channelPopover.id,
		model: model.channelPopover,
		view: Popover.view,
		viewInputs: {
			toTrigger: (attributes) =>
				button(h, { intent: "outline", size: "xs", attributes: [...attributes] }, [
					IconPlus(h, icon),
					"Link channel",
				]),
			toContent: () => [
				h.div(
					[h.Class("flex w-72 flex-col gap-1 p-2")],
					[
						input(h, {
							placeholder: "Search channels",
							attributes: [
								h.AriaLabel("Search channels"),
								h.Value(model.channelSearch),
								h.OnInput((value) => Message.ChangedChannelSearch({ value })),
							],
						}),
						...(candidates.length === 0
							? [
									h.p(
										[h.Class("px-2 py-3 text-muted-fg text-sm")],
										[
											model.channelOptions.length === 0
												? "No channels to link yet."
												: "No channel matches.",
										],
									),
								]
							: candidates.map((channel) => {
									const owner = owners.get(channel.id)
									const ownerName = owner === undefined ? undefined : names.get(owner)
									return button(
										h,
										{
											intent: "plain",
											size: "sm",
											className: "w-full justify-start",
											onPress: Message.PressedLinkChannel({ channelId: channel.id }),
											attributes: [h.Key(channel.id)],
										},
										[
											channelMark(h, channel),
											h.span(
												[h.Class("min-w-0 flex-1 truncate text-left")],
												[channel.name],
											),
											h.span(
												[h.Class("shrink-0 text-muted-fg text-xs")],
												[
													owner === undefined
														? ORIGIN_LABEL[channel.origin]
														: `Linked to ${ownerName ?? "another customer"}`,
												],
											),
										],
									)
								})),
					],
				),
			],
			placement: "bottom start",
		},
		toParentMessage: (message) => Message.GotChannelPopoverMessage({ message }),
	})
}

/**
 * Where the team talks to this customer: Hazel, Slack, Discord or Connect channels. They are the
 * customer's, so every environment of it shows the same ones.
 */
const channelsSection = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const customerOf = customerOfAccount(model)
	const customer = customerOf(context.account.id)
	const linked = model.channelLinks.filter((entry) => customerOf(entry.accountId) === customer)
	const linkedHere = new Set<string>(linked.map((entry) => entry.channelId))
	const options = new Map(model.channelOptions.map((channel) => [channel.id, channel]))
	return sidebarSection(h, "Channels", linked.length === 0 ? null : formatCount(linked.length), [
		...(linked.length === 0
			? [
					h.p(
						[h.Class("text-muted-fg text-sm")],
						["Link the Slack, Discord, Connect or Hazel channels you talk to this customer in."],
					),
				]
			: linked.map((entry) => linkedChannelRow(h, context, entry, options.get(entry.channelId)))),
		...suggestedChannels(h, model, customer, linkedHere),
		h.div([h.Class("pt-1")], [channelPicker(h, model, linkedHere)]),
	])
}

/**
 * The "Add flags" picker: tick the flags this customer does not have, then add them at once.
 * `holdsAny`: with no candidates, the customer has every flag rather than none existing.
 */
const flagPicker = (
	h: HtmlBuilder<Message>,
	model: Model,
	candidates: ReadonlyArray<string>,
	holdsAny: boolean,
): Html =>
	h.submodel({
		slotId: model.flagPopover.id,
		model: model.flagPopover,
		view: Popover.view,
		viewInputs: {
			toTrigger: (attributes) =>
				button(h, { intent: "outline", size: "xs", attributes: [...attributes] }, [
					IconPlus(h, icon),
					"Add flags",
				]),
			toContent: () => [
				h.div(
					[h.Class("flex w-64 flex-col gap-1 p-2")],
					candidates.length === 0
						? [
								h.p(
									[h.Class("px-2 py-3 text-muted-fg text-sm")],
									[
										holdsAny
											? "It has every flag. Create new ones under Settings → Feature flags."
											: "No flags to add yet. Create one under Settings → Feature flags.",
									],
								),
							]
						: [
								h.div(
									[h.Class("flex max-h-64 flex-col gap-1 overflow-y-auto px-1 py-1")],
									candidates.map((key) =>
										h.div(
											[h.Key(key)],
											[
												checkbox(
													h,
													{
														id: `customer-flag-${key}`,
														isSelected: model.flagSelection.includes(key),
														onChange: (isSelected) =>
															Message.ToggledFlagSelection({ key, isSelected }),
													},
													key,
												),
											],
										),
									),
								),
								button(
									h,
									{
										size: "sm",
										isDisabled: model.flagSelection.length === 0,
										onPress: Message.PressedAddFlags(),
									},
									[
										model.flagSelection.length <= 1
											? "Add flag"
											: `Add ${formatCount(model.flagSelection.length)} flags`,
									],
								),
							],
				),
			],
			placement: "bottom start",
		},
		toParentMessage: (message) => Message.GotFlagPopoverMessage({ message }),
	})

/** The Clerk feature flags this customer has on, and (admins) adding and removing them. */
const featureFlagsSection = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const on = Object.keys(context.account.featureFlags)
		.filter((key) => hasFlag(context.account, key))
		.sort()
	const candidates = featureFlagKeysOf(model.createdFeatureFlags, model.accounts ?? []).filter(
		(key) => !hasFlag(context.account, key),
	)
	return sidebarSection(h, "Feature flags", on.length === 0 ? null : formatCount(on.length), [
		...(on.length === 0
			? [h.p([h.Class("text-muted-fg text-sm")], ["No feature flags on."])]
			: [
					h.div(
						[h.Class("flex flex-col gap-1")],
						on.map((key) =>
							h.div(
								[
									h.Key(key),
									h.Class(
										"flex min-h-8 items-center gap-2 rounded-lg border border-border px-3 py-1",
									),
								],
								[
									h.span(
										[h.Class("min-w-0 flex-1 truncate font-mono text-fg text-sm")],
										[key],
									),
									...(context.isAdmin
										? [
												button(
													h,
													{
														intent: "plain",
														size: "sq-xs",
														onPress: Message.PressedRemoveFlag({ key }),
														attributes: [h.AriaLabel(`Turn off ${key}`)],
													},
													[IconClose(h, icon)],
												),
											]
										: []),
								],
							),
						),
					),
				]),
		...(context.isAdmin
			? [h.div([h.Class("pt-1")], [flagPicker(h, model, candidates, on.length > 0)])]
			: []),
	])
}

const attributeValue = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: JSON.stringify(value)

/** Each source record the customer is linked to, one line each; the match is in the tooltip. */
const linkedRecords = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const { detail } = context
	const now = new Date(context.nowMs)
	const refs = (detail?.refs ?? []).filter((ref) => ref.entityType === "account")
	const linked = new Set(refs.map((ref) => ref.provider))
	const unlinked = model.connectedProviders.filter((provider) => !linked.has(provider))
	return sidebarSection(h, "Linked records", null, [
		...refs.map((ref) =>
			h.div(
				[
					h.Key(ref.id),
					h.Title(
						[
							ref.externalId,
							`Matched by ${MATCH_LABEL[ref.matchMethod]}`,
							ref.lastSyncedAt === null
								? null
								: `synced ${formatRelative(ref.lastSyncedAt, now)}`,
							ref.staleAt === null ? null : "stale (source disconnected)",
						]
							.filter((part) => part !== null)
							.join(" · "),
					),
					h.Class(
						twMerge(
							"flex min-h-8 items-center gap-2 text-sm",
							ref.staleAt !== null && "opacity-60",
						),
					),
				],
				[
					sourceLogo(h, ref.provider),
					h.span([h.Class("shrink-0 text-fg")], [LINK_LABEL[ref.provider]]),
					h.span([h.Class("min-w-0 flex-1 truncate text-muted-fg")], [ref.name ?? ""]),
					...recordLink(h, ref),
				],
			),
		),
		...unlinked.map((provider) =>
			h.div(
				[h.Key(provider), h.Class("flex min-h-8 items-center gap-2 text-sm")],
				[
					sourceLogo(h, provider),
					h.span(
						[h.Class("min-w-0 flex-1 truncate text-muted-fg")],
						[`No ${SOURCE_LABEL[provider]} record`],
					),
					h.a(
						[
							h.Href(hrefOf(AppRoute.CustomersUnmatched({ orgSlug: context.orgSlug }))),
							h.Class(twMerge(linkClass, "shrink-0 text-xs")),
						],
						["Find"],
					),
				],
			),
		),
		...(refs.length === 0 && unlinked.length === 0
			? [
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[detail === null ? "Loading…" : "Not linked to any source."],
					),
				]
			: []),
	])
}

/** The account's attributes from its sources; left out when there are none. */
const attributesSection = (h: HtmlBuilder<Message>, context: Context): ReadonlyArray<Html> => {
	const fieldSources = context.detail?.account.fieldSources ?? {}
	const attributes = Object.entries(context.detail?.account.attributes ?? {}).filter(
		([, value]) => value !== null,
	)
	return attributes.length === 0
		? []
		: [
				sidebarSection(
					h,
					"Attributes",
					formatCount(attributes.length),
					attributes.map(([key, value]) =>
						h.div(
							[
								h.Key(key),
								h.Class("grid min-h-8 grid-cols-[7rem_1fr_auto] items-center gap-2 text-sm"),
							],
							[
								h.span(
									[h.Class("truncate text-muted-fg")],
									[
										key
											.replace(/([A-Z])/g, " $1")
											.replace(/^./, (first) => first.toUpperCase()),
									],
								),
								h.span([h.Class("truncate text-fg")], [attributeValue(value)]),
								...(fieldSources[key] === undefined
									? []
									: [
											h.span(
												[h.Class("text-muted-fg text-xs")],
												[SOURCE_LABEL[fieldSources[key]]],
											),
										]),
							],
						),
					),
				),
			]
}

/**
 * Beside the tab from lg, under it on a tablet; inside the overview on a phone (`isStacked`). The
 * facts people look up (owner, stage, plan) first; the company and where they talk next; the
 * plumbing (flags, attributes, source records) last.
 */
const sidebar = (h: HtmlBuilder<Message>, model: Model, context: Context, isStacked = false): Html => {
	const { account, detail } = context
	const now = new Date(context.nowMs)
	const fieldSources = detail?.account.fieldSources ?? {}
	const sourceOf = (field: string): ReadonlyArray<Html> => {
		const source = fieldSources[field]
		return source === undefined
			? []
			: [h.span([h.Class("ml-auto text-muted-fg text-xs")], [SOURCE_LABEL[source]])]
	}
	const subscription = renewingSubscriptionOf(detail?.subscriptions ?? [])
	const hasFlags = Object.keys(account.featureFlags).some((key) => hasFlag(account, key))
	return h.aside(
		[
			h.AriaLabel("Customer details"),
			h.Class(
				isStacked
					? "flex flex-col rounded-xl border border-border"
					: "flex shrink-0 flex-col border-border max-lg:border-t lg:w-80 lg:overflow-y-auto lg:border-l",
			),
		],
		[
			sidebarSection(h, "Details", null, [
				property(
					h,
					"Owner",
					personLabel(h, memberOf(context, account.ownerUserId), { className: "max-w-full" }),
				),
				property(
					h,
					"Stage",
					h.span(
						[h.Class("flex items-center")],
						[stageBadge(h, account.lifecycleStage), ...sourceOf("lifecycleStage")],
					),
				),
				property(h, "Plan", account.planName ?? "—"),
				property(h, "MRR", formatMoney(account.mrrMinor, account.currency)),
				...(account.seatsUsed === null
					? []
					: [
							property(
								h,
								"Seats",
								account.seatsLimit === null
									? formatCount(account.seatsUsed)
									: `${formatCount(account.seatsUsed)} of ${formatCount(account.seatsLimit)}`,
							),
						]),
				...(subscription === undefined || subscription.currentPeriodEnd === null
					? []
					: [
							property(
								h,
								subscription.cancelAtPeriodEnd ? "Cancels" : "Renews",
								formatDate(subscription.currentPeriodEnd, { now, withYear: true }),
							),
						]),
				property(
					h,
					"Customer since",
					formatDate(new Date(account.firstSeenAtMs), { now, withYear: true }),
				),
				property(h, "Tags", tags(h, model, context)),
			]),
			companySection(h, model, context),
			channelsSection(h, model, context),
			sidebarSection(h, "People in chat", null, peopleInChat(h, model, context)),
			...(hasFlags || context.isAdmin ? [featureFlagsSection(h, model, context)] : []),
			...attributesSection(h, context),
			linkedRecords(h, model, context),
		],
	)
}

// STATES

const centered = (h: HtmlBuilder<Message>, title: string, description: string, action?: Html): Html =>
	h.div(
		[h.Class("flex h-full flex-col items-center justify-center gap-2 px-6 text-center")],
		[
			heading(h, { variant: "title", level: 1 }, [title]),
			h.p([h.Class("max-w-sm text-muted-fg text-sm")], [description]),
			...(action === undefined ? [] : [h.div([h.Class("pt-2")], [action])]),
		],
	)

const loading = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.AriaBusy(true), h.Class("flex flex-col gap-4 p-6")],
		[
			h.div(
				[h.Class("flex items-center gap-4")],
				[
					h.span([h.Class("size-12 animate-pulse rounded-xl bg-secondary")]),
					h.span([h.Class("h-6 w-64 animate-pulse rounded bg-secondary")]),
				],
			),
			h.div([h.Class("h-24 animate-pulse rounded-xl bg-secondary/50")]),
			h.div([h.Class("h-64 animate-pulse rounded-xl bg-secondary/40")]),
		],
	)

const rawDialog = (h: HtmlBuilder<Message>, model: Model, context: Context): Html =>
	Modal.controlledModal(h, {
		model: model.rawModal,
		toParentMessage: (message) => Message.GotRawModalMessage({ message }),
		size: "lg",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.rawModal.id), text: "Raw data" },
				description: "The account as Hazel stores it, with its source links.",
			}),
			dialogBody(h, [
				h.pre(
					[
						h.Class(
							"max-h-[60vh] overflow-auto rounded-lg bg-secondary/50 p-3 font-mono text-fg text-xs",
						),
					],
					[
						JSON.stringify(
							{
								account: context.detail?.account ?? context.account,
								refs: context.detail?.refs ?? [],
							},
							null,
							2,
						),
					],
				),
			]),
			dialogFooter(h, [dialogClose(h, closeAttributes, ["Close"])]),
		],
	})

const deleteNoteDialog = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.deleteNoteModal,
		toParentMessage: (message) => Message.GotDeleteNoteModalMessage({ message }),
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.deleteNoteModal.id), text: "Delete this note?" },
				description: "It's removed for everyone. This can't be undone.",
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.PressedConfirmDeleteNote() }, ["Delete note"]),
			]),
		],
	})

// GROUP DIALOGS

/** Link this customer to another: search, pick the customer it belongs to, confirm. */
const linkDialog = (h: HtmlBuilder<Message>, model: Model, context: Context | null): Html => {
	const candidates = linkCandidates(model)
	const picked = candidates.find((account) => account.id === model.linkPrimaryId) ?? null
	const counts = environmentCounts(model.accounts ?? [])
	const name = context === null ? "this customer" : accountLabelOf(context.account)
	return Modal.controlledModal(h, {
		model: model.linkModal,
		toParentMessage: (message) => Message.GotLinkModalMessage({ message }),
		size: "md",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.linkModal.id), text: `Link ${name} to another customer` },
				description:
					"It becomes an environment of the customer you pick, with its own environments if it has any. Each environment keeps its own numbers, users and billing; signals are raised for the whole customer, on its primary. You can unlink it again.",
			}),
			dialogBody(h, [
				h.div(
					[h.Class("flex flex-col gap-3")],
					[
						searchField(
							h,
							{
								id: LINK_SEARCH_ID,
								value: model.linkQuery,
								onInput: (value) => Message.ChangedLinkQuery({ value }),
								onClear: Message.ClearedLinkQuery(),
								ariaLabel: "Search customers",
							},
							(parts) => [parts.searchInput({ placeholder: "Search customers…" })],
						),
						candidates.length === 0
							? h.p(
									[h.Class("px-1 py-3 text-center text-muted-fg text-sm")],
									["No other customers match."],
								)
							: radioGroup(
									h,
									{
										id: "customer-link-pick",
										value: picked?.id ?? null,
										onChange: (value) =>
											Message.PickedLinkPrimary({
												pickedId: CustomerAccountId.make(value),
											}),
										className: "max-h-72 overflow-y-auto",
									},
									(parts) => [
										parts.label(["Customer to join"], { className: "sr-only" }),
										...candidates.slice(0, 100).map((account) =>
											parts.radio(account.id, [
												h.span(
													[h.Class("flex min-w-0 items-center gap-2.5")],
													[
														companyLogo(h, {
															name: account.name,
															logoUrl: account.logoUrl,
															size: "xs",
														}),
														h.span(
															[h.Class("flex min-w-0 flex-col")],
															[
																h.span(
																	[
																		h.Class(
																			"flex min-w-0 items-center gap-2",
																		),
																	],
																	[
																		h.span(
																			[
																				h.Class(
																					"truncate text-fg text-sm",
																				),
																			],
																			[account.name],
																		),
																		...(account.environment === null
																			? []
																			: [
																					environmentBadge(
																						h,
																						account.environment,
																					),
																				]),
																	],
																),
																h.span(
																	[
																		h.Class(
																			"truncate text-muted-fg text-xs",
																		),
																	],
																	[
																		[
																			account.domain,
																			environmentsHintOf(
																				counts.get(account.id) ?? 0,
																			),
																			account.mrrMinor > 0
																				? `${formatMoney(account.mrrMinor, account.currency)} MRR`
																				: null,
																		]
																			.filter((part) => part !== null)
																			.join(" · ") || "No domain",
																	],
																),
															],
														),
													],
												),
											]),
										),
									],
								),
						...(model.linkError === null
							? []
							: [
									h.p(
										[h.Role("alert"), h.Class("text-danger-subtle-fg text-sm")],
										[model.linkError],
									),
								]),
					],
				),
			]),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(
					h,
					{
						intent: "primary",
						isDisabled: picked === null,
						isPending: model.isLinking,
						onPress: Message.PressedConfirmLink(),
					},
					[picked === null ? "Link" : `Link to ${accountLabelOf(picked)}`],
				),
			]),
		],
	})
}

/** Name this account's environment; empty clears it. */
const environmentDialog = (h: HtmlBuilder<Message>, model: Model, context: Context | null): Html => {
	const isNamed = (context?.account.environment ?? null) !== null
	return Modal.controlledModal(h, {
		model: model.environmentModal,
		toParentMessage: (message) => Message.GotEnvironmentModalMessage({ message }),
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: {
					id: Modal.titleId(model.environmentModal.id),
					text: isNamed ? "Rename environment" : "Name environment",
				},
				description: `What the team calls ${context?.account.name ?? "this customer"} here, e.g. US or EU. It shows beside the name everywhere. Leave empty to clear it.`,
			}),
			h.form(
				[h.Class("contents"), h.OnSubmit(Message.SubmittedEnvironment())],
				[
					dialogBody(h, [
						textField(
							h,
							{
								id: ENVIRONMENT_INPUT_ID,
								value: model.environmentDraft,
								onInput: (value) => Message.ChangedEnvironmentDraft({ value }),
							},
							(parts) => [
								parts.label(["Environment"]),
								parts.input({
									placeholder: "EU",
									attributes: [
										h.Attribute("maxlength", "60"),
										h.Attribute("autocomplete", "off"),
									],
								}),
							],
						),
					]),
					dialogFooter(h, [
						dialogClose(h, closeAttributes, ["Cancel"]),
						button(
							h,
							{
								intent: "primary",
								isPending: model.isSavingEnvironment,
								attributes: [h.Type("submit")],
							},
							["Save"],
						),
					]),
				],
			),
		],
	})
}

// PAGE

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const orgSlug = shared.orgSlug ?? ""
	const account = accountOf(model)
	const detail = Option.getOrNull(AsyncData.getData(model.detail))
	if (isNotFound(model))
		return h.div(
			[h.Class("h-full")],
			[
				topBar(h, model, null, orgSlug),
				centered(
					h,
					"Customer not found",
					"It was merged, archived or never existed in this workspace.",
					h.a(
						[
							h.Href(hrefOf(AppRoute.CustomersList({ orgSlug, view: Option.none() }))),
							h.Class(linkClass),
						],
						["Back to customers"],
					),
				),
			],
		)
	const failure = AsyncData.getError(model.detail)
	if (account === undefined)
		return h.div(
			[h.Class("h-full")],
			[
				topBar(h, model, null, orgSlug),
				failure._tag === "Some" && failure.value !== "NotFound"
					? centered(
							h,
							commonMessage(failure.value).title,
							commonMessage(failure.value).description ?? "",
							button(
								h,
								{ intent: "outline", size: "sm", onPress: Message.PressedRetryDetail() },
								[IconArrowPath(h, icon), "Try again"],
							),
						)
					: loading(h),
			],
		)
	const context: Context = {
		orgSlug,
		nowMs: shared.nowMs,
		userId: shared.currentUser?.id ?? null,
		account,
		detail,
		membersById: new Map(model.members.map((member) => [member.id, member])),
		isAdmin: isCustomersAdmin(shared),
	}
	const body =
		model.tab === "users"
			? usersTab(h, model, context)
			: model.tab === "billing"
				? billingTab(h, model, context)
				: model.tab === "activity"
					? activityTab(h, model, context)
					: model.tab === "notes"
						? notesTab(h, model, context, shared.organization?.name ?? "your workspace")
						: overviewTab(h, model, context, model.bands)
	const hasSidebar = model.isSidebarOpen && model.tab !== "users" && !shared.isMobile
	return h.div(
		[h.Class("flex h-full min-h-0 flex-col")],
		[
			topBar(h, model, context, orgSlug),
			// From lg the panel is a column beside the tab, each scrolling on its own. Below lg (a
			// tablet) the two stack and scroll as one, so the panel stays reachable.
			h.div(
				[h.Class("flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto")],
				[
					h.div(
						[h.Class("min-w-0 max-lg:shrink-0 lg:flex-1 lg:overflow-y-auto")],
						[
							header(h, model, context),
							h.div([h.Class("pt-4")], [tabsRow(h, model, context)]),
							...(failure._tag === "Some" && detail === null
								? [
										h.div(
											[
												h.Class(
													"mx-4 mt-4 flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm lg:mx-6",
												),
											],
											[
												h.span(
													[h.Class("text-muted-fg")],
													["Couldn't load this customer's details."],
												),
												button(
													h,
													{
														intent: "outline",
														size: "xs",
														onPress: Message.PressedRetryDetail(),
													},
													["Try again"],
												),
											],
										),
									]
								: []),
							h.div(
								[h.Class("flex flex-col gap-4 px-4 py-5 lg:px-6")],
								[
									...body,
									...(shared.isMobile && model.tab === "overview"
										? [sidebar(h, model, context, true)]
										: []),
								],
							),
						],
					),
					...(hasSidebar ? [sidebar(h, model, context)] : []),
				],
			),
			rawDialog(h, model, context),
			deleteNoteDialog(h, model),
			linkDialog(h, model, context),
			environmentDialog(h, model, context),
			impersonateDialog(h, model),
		],
	)
})
