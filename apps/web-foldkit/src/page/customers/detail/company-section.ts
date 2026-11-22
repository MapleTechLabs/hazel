import { enrichmentDomainOf } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	addressLabel,
	companyTypeLabel,
	countryFlag,
	employeesLabel,
	fundingStageLabel,
	fundingStageOf,
	headquartersLabel,
	revenueLabel,
	usdLabel,
} from "../../../customers/company"
import { formatCount, formatDate, formatRelative } from "../../../customers/format"
import { companyPageLinks } from "../../../customers/ui/company"
import { IconArrowPath } from "../../../icons"
import { button } from "../../../ui/button"
import { input } from "../../../ui/input"
import { Message } from "./message"
import {
	DOMAIN_INPUT_ID,
	isCompanyRefreshAnswered,
	isCompanyRefreshPending,
	isCompanyRefreshUnanswered,
	type Model,
} from "./model"
import { type Context, icon, property, sidebarSection } from "./parts"

/**
 * The customer's company, enriched from its domain (`docs/customers/enrichment.md`): the sidebar's
 * Company section: the description, the figures (headcount, funding, revenue, age) as a grid, the
 * rest as rows, and the company's own pages. Its key facts sit under the name, its socials in the
 * top bar. Every field may be missing.
 */

const muted = (h: HtmlBuilder<Message>, text: string) => h.span([h.Class("text-muted-fg")], [text])

/** A value with its quieter detail on a line under it. */
const stacked = (h: HtmlBuilder<Message>, value: string, detail: string | null): Html =>
	h.span(
		[h.Class("flex min-w-0 flex-col py-1")],
		[
			h.span([h.Class("truncate"), h.Title(value)], [value]),
			...(detail === null
				? []
				: [h.span([h.Class("truncate text-muted-fg text-xs"), h.Title(detail)], [detail])]),
		],
	)

/** One figure of the stat grid: a small label over the value, a quieter detail under it. */
const stat = (
	h: HtmlBuilder<Message>,
	label: string,
	value: string | null,
	detail: string | null,
): ReadonlyArray<Html> =>
	value === null
		? []
		: [
				h.div(
					[h.Class("flex min-w-0 flex-col gap-0.5 rounded-lg border border-border px-3 py-2")],
					[
						h.span([h.Class("text-muted-fg text-xs")], [label]),
						h.span(
							[h.Class("truncate font-medium text-fg text-sm tabular-nums"), h.Title(value)],
							[value],
						),
						...(detail === null
							? []
							: [
									h.span(
										[
											h.Class("truncate text-muted-fg text-xs tabular-nums"),
											h.Title(detail),
										],
										[detail],
									),
								]),
					],
				),
			]

/** The figures, two a row; a lone last one spans the row. Nothing when no figure is known. */
const grid = (h: HtmlBuilder<Message>, stats: ReadonlyArray<Html>): ReadonlyArray<Html> =>
	stats.length === 0
		? []
		: [h.div([h.Class("grid grid-cols-2 gap-2 pb-3 [&>*:last-child:nth-child(odd)]:col-span-2")], stats)]

const refreshButton = (
	h: HtmlBuilder<Message>,
	options: Readonly<{ label: string; isPending: boolean; iconOnly: boolean }>,
): Html =>
	button(
		h,
		{
			intent: options.iconOnly ? "plain" : "outline",
			size: "xs",
			isPending: options.isPending,
			onPress: Message.PressedRefreshCompany(),
			// Loading, not disabled: the turning arrow and the label say so at full strength.
			className: twMerge(options.iconOnly && "px-1.5", "data-pending:opacity-100"),
			attributes: options.iconOnly ? [h.AriaLabel(options.label), h.Title(options.label)] : [],
		},
		[
			IconArrowPath(h, { ...icon, className: options.isPending ? "animate-spin" : undefined }),
			// Keyed by the label: "Looking up" mounts in place of "Look up now" and blurs in.
			...(options.iconOnly
				? []
				: [
						h.keyed("span")(
							`label-${options.label}`,
							[h.Class(options.isPending ? "animate-blur-in" : "")],
							[options.label],
						),
					]),
		],
	)

/** Where the company's figures will be, while the lookup runs: the grid's cards, and two lines. */
const lookupSkeleton = (h: HtmlBuilder<Message>): Html => {
	const bar = (className: string) =>
		h.div([h.Class(twMerge("animate-pulse rounded-sm bg-secondary", className))])
	return h.div(
		[h.AriaHidden(true), h.Class("blur-in-stagger flex flex-col gap-3 pb-3")],
		[
			h.div(
				[h.Class("grid grid-cols-2 gap-2")],
				[0, 1, 2, 3].map((index) =>
					h.div(
						[
							h.Key(String(index)),
							h.Class("flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5"),
						],
						[bar("h-2.5 w-12"), bar("h-3.5 w-16")],
					),
				),
			),
			h.div([h.Class("flex flex-col gap-2")], [bar("h-3 w-4/5"), bar("h-3 w-3/5")]),
		],
	)
}

/**
 * "Add domain", for a customer with no company domain, or the domain being changed (Save / Cancel):
 * the company is then looked up by it.
 */
const domainForm = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.form(
		[h.Class("flex items-center gap-1.5 pb-2"), h.OnSubmit(Message.SubmittedDomain())],
		[
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					input(h, {
						placeholder: "acme.com",
						attributes: [
							h.Id(DOMAIN_INPUT_ID),
							h.AriaLabel("Company domain"),
							h.Type("text"),
							h.Attribute("autocomplete", "off"),
							h.Attribute("spellcheck", "false"),
							h.Value(model.domainDraft),
							h.OnInput((value) => Message.ChangedDomainDraft({ value })),
						],
					}),
				],
			),
			button(
				h,
				{
					intent: "outline",
					size: "sm",
					isPending: model.isSavingDomain,
					isDisabled: model.domainDraft.trim() === "",
					attributes: [h.Type("submit")],
				},
				[model.editingDomain === null ? "Add" : "Save"],
			),
			...(model.editingDomain === null
				? []
				: [
						button(
							h,
							{
								intent: "plain",
								size: "sm",
								isDisabled: model.isSavingDomain,
								onPress: Message.PressedCancelDomain(),
							},
							["Cancel"],
						),
					]),
		],
	)

/** The domain the company is looked up by; an admin changes it in place. */
const domainRow = (h: HtmlBuilder<Message>, model: Model, context: Context, domain: string): Html =>
	context.isAdmin && model.editingDomain === domain
		? domainForm(h, model)
		: property(
				h,
				"Domain",
				h.span(
					[h.Class("flex min-w-0 items-center justify-between gap-2")],
					[
						h.span([h.Class("truncate"), h.Title(domain)], [domain]),
						...(context.isAdmin
							? [
									button(
										h,
										{
											intent: "plain",
											size: "xs",
											onPress: Message.PressedChangeDomain({ domain }),
											attributes: [h.AriaLabel(`Change domain ${domain}`)],
										},
										["Change"],
									),
								]
							: []),
					],
				),
			)

export const companySection = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const { account } = context
	const company = account.company
	const now = new Date(context.nowMs)
	const isPending = isCompanyRefreshPending(model, context.nowMs, account.companyCheckedAtMs)
	const isUnanswered = isCompanyRefreshUnanswered(model, context.nowMs, account.companyCheckedAtMs)
	// The synced row's domain first: the detail is not read again after a domain is added here.
	const domains = [
		...(account.domain === null ? [] : [account.domain]),
		...(context.detail?.account.domains ?? []),
	]
	const domain = enrichmentDomainOf(domains)
	const checked =
		account.companyCheckedAtMs === null ? null : formatRelative(new Date(account.companyCheckedAtMs), now)

	if (company === null && domain === null) {
		return sidebarSection(h, "Company", null, [
			h.p(
				[h.Class("pb-2 text-muted-fg text-sm")],
				[
					context.isAdmin
						? "Add the customer's website domain and Hazel looks up their company."
						: "No company domain to look up. An admin can add one.",
				],
			),
			...(context.isAdmin ? [domainForm(h, model)] : []),
		])
	}

	if (company === null) {
		const [text, action] =
			domain === null
				? ["No company domain to look up.", null]
				: isPending
					? [`Looking up ${domain}…`, "Looking up"]
					: isUnanswered
						? [`Couldn't look up ${domain} just now. Hazel tries again shortly.`, "Try again"]
						: checked === null
							? [`Not looked up yet. Hazel looks up ${domain} automatically.`, "Look up now"]
							: [`context.dev has no company at ${domain}.`, "Look up again"]
		// A lookup asked on this page: its states change in view, so each new line blurs in.
		const isAsked = model.companyRefreshAtMs !== null
		return sidebarSection(h, "Company", checked === null ? null : `Checked ${checked}`, [
			...(domain === null ? [] : [domainRow(h, model, context, domain)]),
			// The live region stays; the line inside it is keyed, so a new one mounts and animates.
			h.div(
				[h.AriaLive("polite"), h.Class("pb-2")],
				[
					h.keyed("p")(
						`status-${text}`,
						[h.Class(twMerge("text-muted-fg text-sm", isAsked && "animate-blur-in"))],
						[text],
					),
				],
			),
			...(isPending ? [lookupSkeleton(h)] : []),
			...(action === null
				? []
				: [h.div([], [refreshButton(h, { label: action, isPending, iconOnly: false })])]),
		])
	}

	const latest = company.funding?.rounds[0] ?? null
	// Third-party data: a date that does not parse is left out rather than breaking the page.
	const latestMs = latest?.date == null ? Number.NaN : Date.parse(`${latest.date}T00:00:00Z`)
	const latestParts = [
		latest === null || latest.amountUsd === null ? null : usdLabel(latest.amountUsd),
		Number.isNaN(latestMs) ? null : formatDate(new Date(latestMs), { now, withYear: true }),
	].filter((part) => part !== null)
	const stage = fundingStageOf(company)
	const totalUsd = company.funding?.totalUsd ?? null
	const flag = countryFlag(company.headquarters?.countryCode ?? null)
	const headquarters = headquartersLabel(company)
	const address = addressLabel(company)
	const type = companyTypeLabel(company)
	const description = company.description
	// The company's own pages (pricing, blog, careers); its socials are in the top bar.
	const pages = companyPageLinks(h, company)
	const founded = company.foundedYear === null ? null : String(company.foundedYear)
	const age = company.foundedYear === null ? null : now.getUTCFullYear() - company.foundedYear
	const status = [isPending ? "Looking up…" : isUnanswered ? "Refresh failed, retrying soon" : checked]
		.filter((part) => part !== null)
		.join("")

	// The answer to a lookup asked on this page: keyed by when it was checked, so the profile mounts
	// afresh and its parts blur in one after another. A profile already there on open stays still.
	const isArriving = isCompanyRefreshAnswered(model, account.companyCheckedAtMs)
	return sidebarSection(h, "Company", null, [
		h.keyed("div")(
			`company-${account.companyCheckedAtMs ?? "unchecked"}`,
			[h.Class(twMerge("flex flex-col", isArriving && "blur-in-stagger"))],
			[
				...(description === null
					? []
					: [
							// The clamp sits on the text alone: padding inside it would show a cut line.
							h.div(
								[h.Class("pb-3")],
								[
									h.p(
										[
											h.Class(
												"line-clamp-3 wrap-anywhere text-fg-2 text-sm leading-relaxed",
											),
											h.Title(description),
										],
										[description],
									),
								],
							),
						]),
				...grid(h, [
					...stat(
						h,
						"Employees",
						employeesLabel(company),
						company.employeeCount === null || company.employeeRange === null
							? null
							: `${formatCount(company.employeeCount)} on record`,
					),
					...stat(
						h,
						"Funding",
						stage === null
							? totalUsd === null
								? null
								: usdLabel(totalUsd)
							: fundingStageLabel(stage),
						stage === null || totalUsd === null ? null : `${usdLabel(totalUsd)} raised`,
					),
					...stat(
						h,
						"Est. revenue",
						revenueLabel(company),
						revenueLabel(company) === null ? null : "per year",
					),
					...stat(
						h,
						"Founded",
						founded,
						age === null || age < 1 ? null : `${age} ${age === 1 ? "year" : "years"} ago`,
					),
				]),
				...(domain === null ? [] : [domainRow(h, model, context, domain)]),
				property(
					h,
					"Industry",
					// The industry the list shows and filters by; the sub-industry under it.
					company.industry === null
						? muted(h, "—")
						: stacked(h, company.industry, company.subindustry),
				),
				property(
					h,
					"Headquarters",
					headquarters === null
						? muted(h, "—")
						: h.span(
								[h.Class("block truncate"), ...(address === null ? [] : [h.Title(address)])],
								[flag === "" ? headquarters : `${flag} ${headquarters}`],
							),
				),
				...(type === null ? [] : [property(h, "Type", type)]),
				...(latestParts.length === 0 || latest === null
					? []
					: [
							property(
								h,
								"Last round",
								stacked(h, fundingStageLabel(latest.type), latestParts.join(" · ")),
							),
						]),
				...(pages.length === 0
					? []
					: [h.div([h.Class("-ml-1.5 flex flex-wrap gap-0.5 pt-2")], pages)]),
			],
		),
		// Outside the keyed profile: the live region stays mounted across a lookup, so "Looking up…"
		// turning into "just now" is announced, and the button keeps focus.
		h.div(
			[h.Class("flex items-center justify-between gap-2 pt-3 text-muted-fg text-xs")],
			[
				h.span(
					[h.AriaLive("polite"), h.Class("truncate")],
					[status === "" ? "From context.dev" : `From context.dev · ${status}`],
				),
				refreshButton(h, { label: "Refresh company profile", isPending, iconOnly: true }),
			],
		),
	])
}
