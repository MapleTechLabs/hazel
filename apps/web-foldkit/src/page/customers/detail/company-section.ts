import { type CompanyLink, enrichmentDomainOf } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
	addressLabel,
	companyPages,
	companyTypeLabel,
	countryFlag,
	employeesLabel,
	fundingLabel,
	headquartersLabel,
	linkLabel,
	rankedSocials,
	revenueLabel,
	usdLabel,
} from "../../../customers/company"
import { formatCount, formatDate, formatRelative } from "../../../customers/format"
import { IconArrowPath, IconLink } from "../../../icons"
import { button } from "../../../ui/button"
import { Message } from "./message"
import { isCompanyRefreshPending, isCompanyRefreshUnanswered, type Model } from "./model"
import { type Context, disclosure, icon, property, sidebarSection } from "./parts"

/**
 * The customer's company, enriched from its domain (`docs/customers/enrichment.md`): the sidebar's
 * Company section: the description and key facts, the rest behind More. Every field may be missing.
 */

/** Only `https:` links leave the page (the profile is third-party data). */
const safeHref = (url: string): string | null => {
	try {
		return new URL(url).protocol === "https:" ? url : null
	} catch {
		return null
	}
}

const linkChip = (h: HtmlBuilder<Message>, link: CompanyLink): ReadonlyArray<Html> => {
	const href = safeHref(link.url)
	return href === null
		? []
		: [
				h.a(
					[
						h.Key(`${link.type}:${href}`),
						h.Href(href),
						h.Target("_blank"),
						h.Rel("noreferrer"),
						h.Title(href),
						h.Class(
							"inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 font-medium text-fg text-xs outline-hidden transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70",
						),
					],
					[IconLink(h, { className: "size-3.5 text-muted-fg" }), linkLabel(link)],
				),
			]
}

const muted = (h: HtmlBuilder<Message>, text: string) => h.span([h.Class("text-muted-fg")], [text])

/** A value with a quieter detail after it: `201–500 · 312`. */
const withDetail = (h: HtmlBuilder<Message>, value: string | null, detail: string | null): Html | string =>
	value === null
		? muted(h, "—")
		: detail === null
			? value
			: h.span(
					[h.Class("flex min-w-0 gap-1.5")],
					[h.span([h.Class("truncate")], [value]), muted(h, `· ${detail}`)],
				)

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
			className: options.iconOnly ? "px-1.5" : undefined,
			attributes: options.iconOnly ? [h.AriaLabel(options.label), h.Title(options.label)] : [],
		},
		options.iconOnly ? [IconArrowPath(h, icon)] : [IconArrowPath(h, icon), options.label],
	)

export const companySection = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const { account } = context
	const company = account.company
	const now = new Date(context.nowMs)
	const isPending = isCompanyRefreshPending(model, context.nowMs, account.companyCheckedAtMs)
	const isUnanswered = isCompanyRefreshUnanswered(model, context.nowMs, account.companyCheckedAtMs)
	const domains = context.detail?.account.domains ?? (account.domain === null ? [] : [account.domain])
	const domain = enrichmentDomainOf(domains)
	const checked =
		account.companyCheckedAtMs === null ? null : formatRelative(new Date(account.companyCheckedAtMs), now)

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
		return sidebarSection(h, "Company", checked === null ? null : `Checked ${checked}`, [
			h.p([h.AriaLive("polite"), h.Class("pb-2 text-muted-fg text-sm")], [text]),
			...(action === null
				? []
				: [h.div([], [refreshButton(h, { label: action, isPending, iconOnly: false })])]),
		])
	}

	const latest = company.funding?.rounds[0] ?? null
	// Third-party data: a date that does not parse is left out rather than breaking the page.
	const latestMs = latest?.date == null ? Number.NaN : Date.parse(`${latest.date}T00:00:00Z`)
	const latestParts = [
		latest === null ? null : latest.amountUsd === null ? null : usdLabel(latest.amountUsd),
		Number.isNaN(latestMs) ? null : formatDate(new Date(latestMs), { now, withYear: true }),
	].filter((part) => part !== null)
	const latestLabel = latestParts.length === 0 ? null : latestParts.join(" · ")
	const flag = countryFlag(company.headquarters?.countryCode ?? null)
	const headquarters = headquartersLabel(company)
	const address = addressLabel(company)
	const type = companyTypeLabel(company)
	const links = [...rankedSocials(company), ...companyPages(company)].flatMap((link) => linkChip(h, link))
	const description = company.description
	const more = [
		property(h, "Founded", company.foundedYear === null ? muted(h, "—") : String(company.foundedYear)),
		...(type === null ? [] : [property(h, "Type", type)]),
		...(latestLabel === null ? [] : [property(h, "Last round", latestLabel)]),
		property(h, "Est. revenue", withDetail(h, revenueLabel(company), null)),
		...(links.length === 0 ? [] : [h.div([h.Class("flex flex-wrap gap-1.5 pt-2")], links)]),
	]

	return sidebarSection(h, "Company", null, [
		h.div(
			[h.Class("-mt-1 flex items-center justify-between gap-2 pb-1 text-muted-fg text-xs")],
			[
				h.span(
					[h.AriaLive("polite")],
					[
						`context.dev · ${isPending ? "looking up…" : isUnanswered ? "refresh failed, retrying soon" : (checked ?? "")}`,
					],
				),
				refreshButton(h, { label: "Refresh company profile", isPending, iconOnly: true }),
			],
		),
		...(description === null
			? []
			: [h.p([h.Class("line-clamp-3 pb-1.5 text-fg-2 text-sm"), h.Title(description)], [description])]),
		property(
			h,
			"Industry",
			// The industry the list shows and filters by; the sub-industry under it.
			company.industry === null
				? muted(h, "—")
				: h.span(
						[h.Class("flex min-w-0 flex-col py-1")],
						[
							h.span([h.Class("truncate")], [company.industry]),
							...(company.subindustry === null
								? []
								: [
										h.span(
											[h.Class("truncate text-muted-fg text-xs")],
											[company.subindustry],
										),
									]),
						],
					),
		),
		property(
			h,
			"Employees",
			withDetail(
				h,
				employeesLabel(company),
				company.employeeCount === null || company.employeeRange === null
					? null
					: formatCount(company.employeeCount),
			),
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
		property(h, "Funding", withDetail(h, fundingLabel(company), null)),
		disclosure(h, { summary: ["More"], className: "pt-1.5", summaryClassName: "py-1" }, [
			h.div([h.Class("pt-1")], more),
		]),
	])
}
