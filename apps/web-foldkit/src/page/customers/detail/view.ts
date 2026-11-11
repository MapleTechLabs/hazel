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
	IconExternalLink,
	IconPlus,
} from "../../../icons"
import { safeSourceUrl } from "../../../customers/providers"
import { AppRoute, hrefOf } from "../../../route"
import { button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import { input } from "../../../ui/input"
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

/** The customer page (Wonder: Customer Page — overview, users, billing, activity, notes, header menu). */

const ACTION_LABEL = {
	copy_link: "Copy link to customer",
	change_owner: "Change owner…",
	recompute: "Recompute health and signals",
	link_source: "Link a source record…",
	merge: "Merge with another account…",
	raw_data: "View raw data",
	archive: "Archive customer…",
} as const satisfies Record<ActionKey, string>

const ACTION_REASON = new Map<ActionKey, string>([
	["recompute", "Runs on its own every hour; no manual trigger yet."],
	["link_source", "Link records from Data sources › Unmatched for now."],
	["merge", "Not available yet."],
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
					h.Class("inline-flex items-center gap-1 text-fg-2 hover:underline"),
				],
				[domain, IconExternalLink(h, { className: "size-3" })],
			),
	})
}

/** `↗` to the record in its provider, when its URL is on the provider's hosts (`safeSourceUrl`). */
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
						h.Class("text-muted-fg hover:text-fg"),
					],
					[IconExternalLink(h, { className: "size-3.5" })],
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
					"inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-border text-fg-2 hover:bg-secondary disabled:cursor-default disabled:opacity-40",
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
					h.span([h.Class("truncate font-medium text-fg")], [context?.account.name ?? "…"]),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					...(position === null
						? []
						: [
								h.span(
									[h.Class("text-muted-fg text-xs tabular-nums")],
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
									"ml-2 inline-flex h-7 cursor-pointer items-center rounded-md border border-border px-2 text-fg-2 text-xs hover:bg-secondary",
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
		[h.Class("flex flex-col gap-4 px-4 pt-5 lg:px-6")],
		[
			h.div(
				[h.Class("flex items-start justify-between gap-4")],
				[
					h.div(
						[h.Class("flex min-w-0 gap-4")],
						[
							companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "lg" }),
							h.div(
								[h.Class("flex min-w-0 flex-col gap-1.5")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											h.h1([h.Class("font-semibold text-2xl text-fg")], [account.name]),
											stageBadge(h, account.lifecycleStage),
											healthBadge(h, {
												status: account.healthStatus,
												score: account.healthScore,
											}),
										],
									),
									h.p(
										[
											h.Class(
												"flex flex-wrap items-center gap-x-2 text-muted-fg text-sm",
											),
										],
										[
											...(account.domain === null
												? []
												: [domainLink(h, account.domain)]),
											...meta.map((part) => h.span([], [`· ${part}`])),
										],
									),
									h.div(
										[h.Class("flex flex-wrap items-center gap-2 pt-1")],
										[
											ownerMenu(h, model, context),
											h.span([h.Class("mx-1 h-5 w-px bg-border")]),
											...refs
												.filter(
													(ref) =>
														ref.externalUrl !== null &&
														ref.entityType === "account",
												)
												.map((ref) =>
													sourceLinkChip(h, {
														source: ref.provider,
														label: SOURCE_LABEL[ref.provider],
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
															"inline-flex h-7 items-center gap-1 rounded-md border border-border border-dashed px-2 text-muted-fg text-xs",
														),
													],
													[
														IconPlus(h, { className: "size-3" }),
														`No ${SOURCE_LABEL[provider]} record`,
													],
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
							[h.Class("pb-3 text-muted-fg text-xs max-md:hidden")],
							[`Health computed ${formatRelative(healthAt, new Date(context.nowMs))}`],
						),
					]),
		],
	)
}

// SIDEBAR

const property = (h: HtmlBuilder<Message>, label: string, value: Html | string) =>
	h.div(
		[h.Class("grid grid-cols-[7rem_1fr] items-center gap-2 py-1.5 text-sm")],
		[h.span([h.Class("text-muted-fg")], [label]), h.div([h.Class("min-w-0 text-fg")], [value])],
	)

const sidebarSection = (
	h: HtmlBuilder<Message>,
	title: string,
	aside: string | null,
	children: ReadonlyArray<Html>,
) =>
	h.section(
		[h.Class("flex flex-col gap-1 border-border border-b px-5 py-4 last:border-b-0")],
		[
			h.div(
				[h.Class("flex items-center justify-between pb-1")],
				[
					h.h2([h.Class("font-medium text-muted-fg text-xs uppercase tracking-wider")], [title]),
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
								h.Class("inline-flex cursor-pointer rounded text-muted-fg hover:text-fg"),
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
									"inline-flex size-5 cursor-pointer items-center justify-center rounded border border-border text-muted-fg hover:text-fg",
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

const attributeValue = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: JSON.stringify(value)

const sourceLabelOf = (source: Customers.CustomerSource | undefined): ReadonlyArray<Html | string> =>
	source === undefined ? [] : [SOURCE_LABEL[source]]

const sidebar = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
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
			: [h.span([h.Class("ml-2 text-muted-fg text-xs")], [`from ${SOURCE_LABEL[source]}`])]
	}
	return h.aside(
		[
			h.AriaLabel("Customer details"),
			h.Class("flex w-80 shrink-0 flex-col overflow-y-auto border-border border-l max-lg:hidden"),
		],
		[
			sidebarSection(h, "Properties", null, [
				property(h, "Owner", personLabel(h, memberOf(context, account.ownerUserId))),
				property(
					h,
					"Stage",
					h.span(
						[h.Class("inline-flex items-center")],
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
										"grid grid-cols-[7rem_1fr_auto] items-center gap-2 py-1.5 text-sm",
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
									...sourceLabelOf(fieldSources[key]),
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
										"flex flex-col gap-0.5 rounded-lg border border-border p-3",
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
								h.span(
									[h.Class("truncate font-mono text-muted-fg text-xs")],
									[ref.externalId],
								),
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
										"flex items-center gap-2 rounded-lg border border-border border-dashed p-3",
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
											h.Class("ml-auto text-primary text-xs hover:underline"),
										],
										["Unmatched"],
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
			h.h1([h.Class("font-semibold text-fg text-lg")], [title]),
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
							h.Class("text-primary text-sm hover:underline"),
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
	const hasSidebar = model.isSidebarOpen && model.tab !== "users"
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
							h.div([h.Class("flex flex-col gap-4 px-4 py-5 lg:px-6")], [...body]),
						],
					),
					...(hasSidebar ? [sidebar(h, model, context)] : []),
				],
			),
			rawDialog(h, model, context),
			deleteNoteDialog(h, model),
		],
	)
})
