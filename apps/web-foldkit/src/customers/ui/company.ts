import type { CompanyLink, CompanyProfile } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconLink, IconMapPin, IconOffice, type IconOptions, IconRocket, IconUsers } from "../../icons"
import {
	companyPages,
	countryFlag,
	employeesLabel,
	fundingStageLabel,
	fundingStageOf,
	headquartersLabel,
	linkLabel,
	rankedSocials,
} from "../company"
import { platformLogo, platformOf, platformTitle } from "../platform-logos"

/**
 * An enriched company at a glance (`docs/customers/enrichment.md`), wherever a customer is shown:
 * its key facts as chips and its links (socials as their platforms' marks, its own pages by name).
 */

/** Only `https:` links leave the page (the profile is third-party data). */
const safeHref = (url: string): string | null => {
	try {
		return new URL(url).protocol === "https:" ? url : null
	} catch {
		return null
	}
}

/** A social profile as its platform's mark (a link icon for a platform without one). */
const socialLink = <M>(h: HtmlBuilder<M>, link: CompanyLink, isCompact = false): ReadonlyArray<Html> => {
	const href = safeHref(link.url)
	if (href === null) return []
	const platform = platformOf(link.type, href)
	const label = platform === null ? linkLabel(link) : platformTitle(platform)
	return [
		h.a(
			[
				h.Key(`${link.type}:${href}`),
				h.Href(href),
				h.Target("_blank"),
				h.Rel("noreferrer"),
				h.AriaLabel(label),
				h.Title(label),
				h.Class(
					isCompact
						? "inline-flex size-6 items-center justify-center rounded-md outline-hidden transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70"
						: "inline-flex size-7 items-center justify-center rounded-md outline-hidden transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70",
				),
			],
			[
				platform === null
					? IconLink(h, {
							className: isCompact ? "size-3.5 text-muted-fg" : "size-4 text-muted-fg",
						})
					: platformLogo(h, platform, isCompact ? "size-3.5" : "size-4"),
			],
		),
	]
}

/** A page of the company's own site (pricing, blog, careers), by name. */
const pageLink = <M>(h: HtmlBuilder<M>, link: CompanyLink): ReadonlyArray<Html> => {
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
							"inline-flex h-6 items-center rounded-md px-1.5 text-muted-fg text-xs outline-hidden transition-colors hover:bg-secondary hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
						),
					],
					[linkLabel(link)],
				),
			]
}

/** The company's socials as their platforms' marks; `isCompact` to sit in a line of small text. */
export const companySocials = <M>(
	h: HtmlBuilder<M>,
	company: CompanyProfile,
	isCompact = false,
): ReadonlyArray<Html> => rankedSocials(company).flatMap((link) => socialLink(h, link, isCompact))

/** The company's own pages (pricing, blog, careers), by name. */
export const companyPageLinks = <M>(h: HtmlBuilder<M>, company: CompanyProfile): ReadonlyArray<Html> =>
	companyPages(company).flatMap((link) => pageLink(h, link))

/** The company's socials as logos, then its own pages by name. */
export const companyLinks = <M>(h: HtmlBuilder<M>, company: CompanyProfile): ReadonlyArray<Html> => [
	...companySocials(h, company),
	...companyPages(company).flatMap((link) => pageLink(h, link)),
]

type IconComponent = <M>(h: HtmlBuilder<M>, options?: IconOptions) => Html

/**
 * The facts people size a customer by, as short chips: industry, headcount, headquarters, funding.
 * Shown under the customer's name, so the company is seen without opening anything.
 */
export const companyFacts = <M>(h: HtmlBuilder<M>, company: CompanyProfile): ReadonlyArray<Html> => {
	const flag = countryFlag(company.headquarters?.countryCode ?? null)
	const headquarters = headquartersLabel(company)
	const employees = employeesLabel(company)
	const stage = fundingStageOf(company)
	const facts: ReadonlyArray<readonly [IconComponent, string, string] | null> = [
		company.industry === null ? null : [IconOffice, company.subindustry ?? company.industry, "Industry"],
		employees === null ? null : [IconUsers, `${employees} employees`, "Employees"],
		headquarters === null
			? null
			: [IconMapPin, flag === "" ? headquarters : `${flag} ${headquarters}`, "Headquarters"],
		stage === null ? null : [IconRocket, fundingStageLabel(stage), "Funding stage"],
	]
	return facts.flatMap((fact) =>
		fact === null
			? []
			: [
					h.span(
						[
							h.Key(fact[2]),
							h.Title(fact[2]),
							h.Class(
								"inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-border px-2 text-fg-2 text-xs",
							),
						],
						[
							fact[0](h, { className: "size-3.5 shrink-0 text-muted-fg" }),
							h.span([h.Class("truncate")], [fact[1]]),
						],
					),
				],
	)
}
