import * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { formatCount, formatDate, formatMoney, formatRelative } from "../../../customers/format"
import { healthBadge, stageBadge } from "../../../customers/ui/badges"
import { viewTabs } from "../../../customers/ui/filter-bar"
import { linkClass } from "../../../customers/ui/surface"
import {
	companyLogo,
	personAvatar,
	personLabel,
	SOURCE_LABEL,
	sourceLinkChip,
	sourceLogo,
} from "../../../customers/ui/identity"
import {
	IconArrowPath,
	IconChevronDown,
	IconChevronRight,
	IconClose,
	IconDots,
	IconEdit,
	IconPlus,
} from "../../../icons"
import { type ChannelOption, channelMark, ORIGIN_LABEL, searchOptions } from "../../../customers/channels"
import { safeSourceUrl } from "../../../customers/providers"
import { organizationsLabel } from "../../../customers/queries"
import { AppRoute, hrefOf } from "../../../route"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import { input } from "../../../ui/input"
import { radioGroup } from "../../../ui/radio"
import { searchField } from "../../../ui/search-field"
import { link } from "../../../ui/link"
import { menuLabel } from "../../../ui/menu-view"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"
import type { PageViewInputs } from "../../contract"
import { activityTab } from "./activity-tab"
import { billingTab } from "./billing-tab"
import { Message } from "./message"
import {
	accountOf,
	type ActionKey,
	actionEntries,
	isNotFound,
	mergeCandidates,
	MERGE_SEARCH_ID,
	type Model,
	OWNER_NONE,
	ownerEntries,
	positionOf,
	userIdOfOwnerKey,
} from "./model"
import { notesTab } from "./notes-tab"
import { overviewTab } from "./overview-tab"
import { type Context, icon, memberOf, menu } from "./parts"
import { usersTab } from "./users-tab"
import { heading } from "../../../ui/heading"

/** The customer page (Wonder: Customer Page — overview, users, billing, activity, notes, header menu). */

const ACTION_LABEL = {
	copy_link: "Copy link to customer",
	change_owner: "Change owner…",
	recompute: "Recompute health and signals",
	link_source: "Link a source record…",
	merge: "Merge another customer into this one…",
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

/** "2 organizations" beside the name, for a customer holding several Clerk organizations. */
const organizationsBadge = (h: HtmlBuilder<Message>, account: Context["account"]): ReadonlyArray<Html> => {
	const label = organizationsLabel(account)
	return label === null ? [] : [badge(h, { intent: "secondary" }, [label])]
}

/** A source chip's label: the source, and the record's name when the source has several (merged). */
const refLabel = (ref: Customers.ExternalRef, refs: ReadonlyArray<Customers.ExternalRef>): string => {
	const several =
		refs.filter((other) => other.entityType === "account" && other.provider === ref.provider).length > 1
	return several
		? `${SOURCE_LABEL[ref.provider]} · ${ref.name ?? ref.externalId}`
		: SOURCE_LABEL[ref.provider]
}

/** The account's site: a link only when the domain is a plain host (it is provider data). */
const domainLink = (h: HtmlBuilder<Message>, domain: string): Html => {
	const href = Option.liftThrowable(() => new URL(`https://${domain}`))().pipe(
		Option.filter((url) => url.hostname === domain.toLowerCase()),
		Option.map((url) => url.href),
	)
	return Option.match(href, {
		onNone: () => h.span([h.Class("text-fg-2")], [domain]),
		onSome: (site) =>
			h.a(
				[
					h.Href(site),
					h.Attribute("target", "_blank"),
					h.Attribute("rel", "noreferrer"),
					h.Class(
						"rounded-sm text-fg-2 outline-hidden hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-ring/70",
					),
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

/** The header's owner picker; the sidebar only shows the owner (one Menu model, one rendering). */
const ownerMenu = (h: HtmlBuilder<Message>, model: Model, context: Context): Html =>
	menu(h, model.ownerMenu, {
		entries: ownerEntries(model.members),
		trigger: (attributes, overlay) =>
			button(
				h,
				{
					intent: "outline",
					size: "xs",
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
				h.span(
					[h.DataAttribute("slot", "icon"), h.Class("inline-flex")],
					[personAvatar(h, key === OWNER_NONE ? null : member)],
				),
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
				[h.Class("flex items-center gap-1")],
				[
					...(position === null
						? []
						: [
								h.span(
									[h.Class("pr-1 text-muted-fg text-xs tabular-nums max-md:hidden")],
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
									"ml-1 inline-flex h-7 cursor-pointer items-center rounded-md px-2 font-medium text-muted-fg text-xs outline-hidden transition-colors hover:bg-secondary hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70 max-md:hidden",
									model.isSidebarOpen && "bg-secondary text-fg",
								),
							),
						],
						["Details"],
					),
				],
			),
		],
	)
}

const header = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const { account, detail } = context
	const now = new Date(context.nowMs)
	const refs = detail?.refs ?? []
	const linked = new Set(refs.map((ref) => ref.provider))
	const unlinked = model.connectedProviders.filter((provider) => !linked.has(provider))
	const meta = [
		account.planName,
		account.mrrMinor > 0 ? `${formatMoney(account.mrrMinor, account.currency)} MRR` : null,
		account.customerSinceMs === null
			? null
			: `Customer since ${formatDate(new Date(account.customerSinceMs), { now, withYear: true })}`,
	].filter((part) => part !== null)
	return h.div(
		[h.Class("flex flex-col gap-4 px-4 pt-6 lg:px-6")],
		[
			h.div(
				[h.Class("flex items-start justify-between gap-4 max-md:flex-col max-md:gap-3")],
				[
					h.div(
						[h.Class("flex min-w-0 gap-3.5")],
						[
							companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "md" }),
							h.div(
								[h.Class("flex min-w-0 flex-col gap-1")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											heading(h, { variant: "display", className: "max-md:text-xl" }, [
												account.name,
											]),
											stageBadge(h, account.lifecycleStage),
											healthBadge(h, {
												status: account.healthStatus,
												score: account.healthScore,
											}),
											...organizationsBadge(h, account),
										],
									),
									// Each part's dot sits in the gap before it, so a wrapped line starts
									// with a part, not a dot: the dot of a line's first part is clipped.
									h.div(
										[h.Class("overflow-hidden text-muted-fg text-sm")],
										[
											h.p(
												[h.Class("-ml-4 flex flex-wrap items-center")],
												[
													...(account.domain === null
														? []
														: [domainLink(h, account.domain)]),
													...meta.map((part) => h.span([], [part])),
												].map((part) =>
													h.span(
														[
															h.Class(
																"relative ml-4 whitespace-nowrap before:absolute before:-left-2.5 before:content-['·']",
															),
														],
														[part],
													),
												),
											),
										],
									),
									h.div(
										[h.Class("flex flex-wrap items-center gap-1.5 pt-2")],
										[
											ownerMenu(h, model, context),
											h.span([h.AriaHidden(true), h.Class("mx-1 h-4 w-px bg-border")]),
											...refs
												.filter(
													(ref) =>
														ref.externalUrl !== null &&
														ref.entityType === "account",
												)
												.map((ref) =>
													sourceLinkChip(h, {
														source: ref.provider,
														label: refLabel(ref, refs),
														href: ref.externalUrl ?? "",
														className:
															ref.staleAt === null ? undefined : "opacity-60",
													}),
												),
											...unlinked.map((provider) =>
												h.span(
													[
														h.Title("Link records from Data sources › Unmatched"),
														h.Class(
															"inline-flex h-7 items-center rounded-md border border-border border-dashed px-2 text-muted-fg text-xs",
														),
													],
													[`No ${SOURCE_LABEL[provider]} record`],
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
							button(h, { intent: "outline", size: "sm", onPress: Message.PressedAddNote() }, [
								IconEdit(h, icon),
								"Add note",
							]),
							menu(h, model.actionsMenu, {
								entries: actionEntries,
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
									const reason = ACTION_REASON.get(key as ActionKey)
									return [
										menuLabel(
											h,
											model.actionsMenu.id,
											key,
											ACTION_LABEL[key as ActionKey] ?? key,
										),
										...(reason === undefined
											? []
											: [
													h.span(
														[
															h.Attribute("slot", "description"),
															h.Class("text-muted-fg text-xs"),
														],
														[reason],
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

const tabsRow = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const healthAt = context.detail?.account.healthUpdatedAt ?? null
	return h.div(
		[h.Class("flex items-end justify-between gap-4 border-border border-b px-4 lg:px-6")],
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
			...(healthAt === null
				? []
				: [
						h.span(
							[h.Class("whitespace-nowrap pb-3 text-muted-fg text-xs max-md:hidden")],
							[`Health computed ${formatRelative(healthAt, new Date(context.nowMs))}`],
						),
					]),
		],
	)
}

// SIDEBAR

const property = (h: HtmlBuilder<Message>, label: string, value: Html | string) =>
	h.div(
		[h.Class("grid min-h-8 grid-cols-[7rem_1fr] items-center gap-2 text-sm")],
		[h.span([h.Class("text-muted-fg")], [label]), h.div([h.Class("min-w-0 text-fg")], [value])],
	)

const sidebarSection = (
	h: HtmlBuilder<Message>,
	title: string,
	aside: string | null,
	children: ReadonlyArray<Html>,
) =>
	h.section(
		[h.Class("flex flex-col border-border border-b px-5 py-4 last:border-b-0 max-md:px-4")],
		[
			h.div(
				[h.Class("flex items-center justify-between pb-2")],
				[
					heading(h, { variant: "subsection", level: 2 }, [title]),
					...(aside === null ? [] : [h.span([h.Class("text-muted-fg text-xs")], [aside])]),
				],
			),
			...children,
		],
	)

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
	channelId: ChannelOption["id"],
	channel: ChannelOption | undefined,
): Html =>
	h.div(
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
							h.span([h.Class("text-muted-fg text-xs")], [ORIGIN_LABEL[channel.origin]]),
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

/** The channel picker: search the org's channels; one linked elsewhere says where (it moves here). */
const channelPicker = (h: HtmlBuilder<Message>, model: Model, linkedHere: ReadonlySet<string>): Html => {
	const owners = new Map(model.channelLinks.map((entry) => [entry.channelId, entry.accountId]))
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

/** Where the team talks to this customer: Hazel, Slack, Discord or Connect channels. */
const channelsSection = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const linked = model.channelLinks.filter((entry) => entry.accountId === context.account.id)
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
			: linked.map((entry) =>
					linkedChannelRow(h, context, entry.channelId, options.get(entry.channelId)),
				)),
		h.div([h.Class("pt-1")], [channelPicker(h, model, linkedHere)]),
	])
}

const attributeValue = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: JSON.stringify(value)

/** Beside the tab on a desktop (hidden below lg); under the overview on a phone (`isStacked`). */
const sidebar = (h: HtmlBuilder<Message>, model: Model, context: Context, isStacked = false): Html => {
	const { account, detail } = context
	const now = new Date(context.nowMs)
	const fieldSources = detail?.account.fieldSources ?? {}
	const attributes = Object.entries(detail?.account.attributes ?? {}).filter(([, value]) => value !== null)
	const refs = (detail?.refs ?? []).filter((ref) => ref.entityType === "account")
	const linked = new Set(refs.map((ref) => ref.provider))
	const sourceOf = (field: string): ReadonlyArray<Html> => {
		const source = fieldSources[field]
		return source === undefined
			? []
			: [h.span([h.Class("ml-auto text-muted-fg text-xs")], [SOURCE_LABEL[source]])]
	}
	return h.aside(
		[
			h.AriaLabel("Customer details"),
			h.Class(
				isStacked
					? "flex flex-col rounded-xl border border-border"
					: "flex w-80 shrink-0 flex-col overflow-y-auto border-border border-l max-lg:hidden",
			),
		],
		[
			sidebarSection(h, "Properties", null, [
				property(h, "Owner", personLabel(h, memberOf(context, account.ownerUserId))),
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
				property(
					h,
					"Seats",
					account.seatsUsed === null
						? "—"
						: account.seatsLimit === null
							? formatCount(account.seatsUsed)
							: `${formatCount(account.seatsUsed)} of ${formatCount(account.seatsLimit)}`,
				),
				property(
					h,
					"First seen",
					formatDate(new Date(account.firstSeenAtMs), { now, withYear: true }),
				),
				property(
					h,
					"Customer since",
					account.customerSinceMs === null
						? "—"
						: formatDate(new Date(account.customerSinceMs), { now, withYear: true }),
				),
				property(
					h,
					"Last active",
					account.lastActiveAtMs === null
						? "Never"
						: formatRelative(new Date(account.lastActiveAtMs), now),
				),
				property(h, "Tags", tags(h, model, context)),
			]),
			channelsSection(h, model, context),
			sidebarSection(
				h,
				"Attributes",
				null,
				attributes.length === 0
					? [
							h.p(
								[h.Class("text-muted-fg text-sm")],
								[detail === null ? "Loading…" : "No attributes from your sources."],
							),
						]
					: attributes.map(([key, value]) =>
							h.div(
								[
									h.Key(key),
									h.Class(
										"grid min-h-8 grid-cols-[7rem_1fr_auto] items-center gap-2 text-sm",
									),
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
			sidebarSection(
				h,
				"Linked records",
				refs.length === 0
					? null
					: `${refs.length} of ${refs.length + model.connectedProviders.filter((provider) => !linked.has(provider)).length}`,
				[
					...refs.map((ref) =>
						h.div(
							[
								h.Key(ref.id),
								h.Class(
									twMerge(
										"mb-2 flex flex-col gap-0.5 rounded-lg border border-border p-3 last:mb-0",
										ref.staleAt !== null && "opacity-60",
									),
								),
							],
							[
								h.div(
									[h.Class("flex items-center justify-between gap-2")],
									[
										h.span(
											[
												h.Class(
													"inline-flex items-center gap-2 font-medium text-fg text-sm",
												),
											],
											[sourceLogo(h, ref.provider), LINK_LABEL[ref.provider]],
										),
										...recordLink(h, ref),
									],
								),
								...(ref.name === null
									? []
									: [h.span([h.Class("truncate text-fg text-sm")], [ref.name])]),
								h.span([h.Class("truncate font-mono text-fg-2 text-xs")], [ref.externalId]),
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[
										[
											`Matched by ${MATCH_LABEL[ref.matchMethod]}`,
											ref.lastSyncedAt === null
												? null
												: `synced ${formatRelative(ref.lastSyncedAt, now)}`,
											ref.staleAt === null ? null : "stale (source disconnected)",
										]
											.filter((part) => part !== null)
											.join(" · "),
									],
								),
							],
						),
					),
					...model.connectedProviders
						.filter((provider) => !linked.has(provider))
						.map((provider) =>
							h.div(
								[
									h.Key(provider),
									h.Class(
										"mb-2 flex items-center gap-2.5 rounded-lg border border-border border-dashed p-3 last:mb-0",
									),
								],
								[
									sourceLogo(h, provider),
									h.div(
										[h.Class("flex min-w-0 flex-col")],
										[
											h.span(
												[h.Class("font-medium text-fg text-sm")],
												[SOURCE_LABEL[provider]],
											),
											h.span(
												[h.Class("text-muted-fg text-xs")],
												["No record matched this customer."],
											),
										],
									),
									h.a(
										[
											h.Href(
												hrefOf(
													AppRoute.CustomersUnmatched({ orgSlug: context.orgSlug }),
												),
											),
											h.Class(twMerge(linkClass, "ml-auto shrink-0 text-xs")),
										],
										["Find record"],
									),
								],
							),
						),
					...(refs.length === 0 && model.connectedProviders.length === 0
						? [
								h.p(
									[h.Class("text-muted-fg text-sm")],
									[detail === null ? "Loading…" : "Not linked to any source."],
								),
							]
						: []),
				],
			),
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

const mergeDialog = (h: HtmlBuilder<Message>, model: Model, context: Context | null): Html => {
	const candidates = mergeCandidates(model)
	const picked = candidates.find((account) => account.id === model.mergeAccountId) ?? null
	const name = context?.account.name ?? "this customer"
	return Modal.controlledModal(h, {
		model: model.mergeModal,
		toParentMessage: (message) => Message.GotMergeModalMessage({ message }),
		size: "md",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.mergeModal.id), text: `Merge into ${name}` },
				description:
					"The customer you pick joins this one: its organizations, billing, users, notes and signals move here, and it leaves the list. Clerk, Stripe and Autumn keep their own IDs. This can't be undone.",
			}),
			dialogBody(h, [
				h.div(
					[h.Class("flex flex-col gap-3")],
					[
						searchField(
							h,
							{
								id: MERGE_SEARCH_ID,
								value: model.mergeQuery,
								onInput: (value) => Message.ChangedMergeQuery({ value }),
								onClear: Message.ClearedMergeQuery(),
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
										id: "customer-merge-pick",
										value: picked?.id ?? null,
										onChange: (pickedId) => Message.PickedMergeAccount({ pickedId }),
										className: "max-h-72 overflow-y-auto",
									},
									(parts) => [
										parts.label(["Customer to merge"], { className: "sr-only" }),
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
																	[h.Class("truncate text-fg text-sm")],
																	[account.name],
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
																			organizationsLabel(account),
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
						isPending: model.isMerging,
						onPress: Message.PressedConfirmMerge(),
					},
					[picked === null ? "Merge" : `Merge ${picked.name}`],
				),
			]),
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
			h.div(
				[h.Class("flex min-h-0 flex-1")],
				[
					h.div(
						[h.Class("min-w-0 flex-1 overflow-y-auto")],
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
			mergeDialog(h, model, context),
		],
	)
})
