// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customer page's header (today's `page/customers/detail/view.ts` `topBar`, `header`, `tabsRow`):
 * the crumbs with prev and next, the logo, name, environment and meta line, the owner menu, Add
 * note and More, the company's key facts, and the tabs.
 */
import * as Customers from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { IconName } from "@hazel/ui/vocabulary/options"
import {
	countryFlag,
	employeesLabel,
	fundingStageLabel,
	fundingStageOf,
	headquartersLabel,
	linkLabel,
	rankedSocials,
} from "../data/company"
import { formatCount, formatMoney } from "../data/format"
import type { AccountRow, MemberRow } from "../data/queries"
import { environmentBadge } from "../ui/badges"
import { viewTabs } from "../ui/filter-bar"
import { companyLogo } from "../ui/identity"
import {
	actionEntries,
	type CustomerDetailModel,
	CustomerDetailMessage,
	type CustomerTab,
	customersListHref,
	environmentEntries,
	groupOfState,
	ownerEntries,
	positionOf,
} from "./model"

type H = Hazel.H<CustomerDetailMessage>

/** What the header reads besides the Model. */
export interface HeaderInputs {
	readonly model: CustomerDetailModel
	readonly accountId: AccountRow["id"]
	readonly orgSlug: string
	readonly tab: CustomerTab
	readonly account: AccountRow | null
	readonly owner: MemberRow | null
	readonly isAdmin: boolean
	readonly isMobile: boolean
	readonly hasSidebar: boolean
}

/**
 * The crumbs (`Customers › Name`), "2 of 214" and prev and next, and the details toggle (wide only:
 * a phone stacks the details under the overview).
 */
export const topBar = (h: H, inputs: HeaderInputs) => {
	const position = positionOf({ model: inputs.model, accountId: inputs.accountId })
	const step = (direction: -1 | 1, label: string, isDisabled: boolean) =>
		h.button
			.key(label)
			.label(label)
			// HAZEL-GAP(pk5-chevron-up): today's previous is an up chevron; `IconName` has no `chevron-up`.
			.icon(direction === -1 ? "chevron-left" : "chevron-down")
			.iconOnly()
			.variant("ghost")
			.size("xsmall")
			.disabled(isDisabled)
			.on("press", CustomerDetailMessage.PressedNeighbour({ step: direction }))
	// HAZEL-GAP(pk5-detail-top-bar): today's bar is one `h-12` row with the crumbs at its start;
	// the detail screen's header puts the crumbs over an empty title row.
	return {
		crumbs: [
			{ label: "Customers", href: customersListHref(inputs.orgSlug) },
			{ label: inputs.account?.name ?? "…" },
		],
		toolbar: [
			position === null || inputs.isMobile
				? null
				: h.text
						.key("position")
						.role("caption")
						.tone("muted")
						.numeric()
						.children(`${formatCount(position.index + 1)} of ${formatCount(position.total)}`),
			position === null ? null : step(-1, "Previous customer", position.previous === null),
			position === null ? null : step(1, "Next customer", position.next === null),
			inputs.isMobile
				? null
				: h.button
						.key("details")
						.label(inputs.model.isSidebarOpen ? "Hide details" : "Show details")
						.icon("sidebar-right")
						.iconOnly()
						.variant("ghost")
						.size("xsmall")
						.selected(inputs.model.isSidebarOpen)
						.on("press", CustomerDetailMessage.PressedToggleSidebar()),
		],
	}
}

/** Beside the name: the environment, and for a customer with several a menu to switch to another. */
const environmentSwitch = (h: H, inputs: HeaderInputs, account: AccountRow) => {
	const state = { model: inputs.model, accountId: inputs.accountId }
	if (groupOfState(state).length === 0)
		return account.environment === null ? null : environmentBadge(h, account.environment)
	return h.menu
		.key("environment")
		.label(`Environment: ${account.environment ?? "unnamed"}`)
		.entries(environmentEntries(state))
		.trigger(
			h.button
				.label(account.environment ?? "Environments")
				.trailingIcon("chevron-down")
				.variant("outline")
				.size("xsmall"),
		)
		.on("select", ({ id }) => CustomerDetailMessage.SelectedEnvironment({ id }))
}

/** The company's socials, by name. */
const socials = (h: H, company: Customers.CompanyProfile | null) =>
	// HAZEL-GAP(pk5-company-socials): today's socials are the platforms' marks (LinkedIn, X, GitHub)
	// as 24px icon links; `link` has no brand marks, so they read as names.
	(company === null ? [] : rankedSocials(company)).flatMap((link) =>
		link.url.startsWith("https://")
			? [h.link.key(`${link.type}:${link.url}`).tone("muted").label(linkLabel(link)).href(link.url)]
			: [],
	)

/** The site, a link only when the domain is a plain host (it is provider data). */
const domainOf = (h: H, domain: string) => {
	const isHost = /^[a-z0-9.-]+$/i.test(domain)
	return isHost
		? h.link.key("domain").tone("muted").label(domain).href(`https://${domain}`)
		: h.text.key("domain").tone("muted").truncate().children(domain)
}

/** The enriched company's key facts as outlined chips, under the name. */
export const companyFacts = (h: H, company: Customers.CompanyProfile | null) => {
	if (company === null) return []
	const flag = countryFlag(company.headquarters?.countryCode ?? null)
	const headquarters = headquartersLabel(company)
	const employees = employeesLabel(company)
	const stage = fundingStageOf(company)
	const facts: ReadonlyArray<readonly [IconName, string, string] | null> = [
		company.industry === null ? null : ["office", company.subindustry ?? company.industry, "Industry"],
		employees === null ? null : ["users", `${employees} employees`, "Employees"],
		headquarters === null
			? null
			: ["map-pin", flag === "" ? headquarters : `${flag} ${headquarters}`, "Headquarters"],
		stage === null ? null : ["rocket", fundingStageLabel(stage), "Funding stage"],
	]
	return facts.flatMap((fact) =>
		fact === null
			? []
			: [h.badge.key(fact[2]).style("outline").icon(fact[0]).title(fact[2]).label(fact[1])],
	)
}

/** The logo, name, environment and meta line; the owner menu, Add note and More. */
export const header = (h: H, inputs: HeaderInputs, account: AccountRow) => {
	const state = { model: inputs.model, accountId: inputs.accountId }
	const meta = [
		account.planName,
		account.mrrMinor > 0 ? `${formatMoney(account.mrrMinor, account.currency)}/mo` : null,
	].filter((part) => part !== null)
	const facts = companyFacts(h, account.company)
	const isMuted = account.attentionMutedAtMs !== null
	return h.stack
		.key("header")
		.density("relaxed")
		.children(
			h.stack
				.axis(inputs.isMobile ? "vertical" : "horizontal")
				.align(inputs.isMobile ? "stretch" : "center")
				.density("regular")
				.children(
					h.stack
						.axis("horizontal")
						.align("center")
						.children(
							companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "md" }),
							h.stack.density("tight").children(
								h.stack
									.axis("horizontal")
									.align("center")
									.density("compact")
									.wrap()
									.children(
										h.heading.level("1").size("large").children(account.name),
										environmentSwitch(h, inputs, account),
										isMuted ? h.badge.key("muted").label("Attention muted") : null,
									),
								h.stack
									.axis("horizontal")
									.align("center")
									.density("compact")
									.wrap()
									.children(
										account.domain === null ? null : domainOf(h, account.domain),
										...meta.map((part) =>
											h.text.key(part).tone("muted").dot().children(part),
										),
										...socials(h, account.company),
									),
							),
						),
					h.spacer,
					h.stack
						.axis("horizontal")
						.align("center")
						.density("compact")
						.children(
							// HAZEL-GAP(pk5-owner-trigger): today's trigger shows the owner's avatar before
							// the name; a button carries an icon only.
							h.menu
								.key("owner")
								.label("Owner")
								.entries(ownerEntries([...inputs.model.members]))
								.trigger(
									h.button
										.label(inputs.owner?.name ?? "Unassigned")
										.icon("user")
										.trailingIcon("chevron-down")
										.variant("outline")
										.size("small"),
								)
								.on("select", ({ id }) => CustomerDetailMessage.SelectedOwner({ id })),
							h.button
								.key("add-note")
								.label("Add note")
								.icon("edit")
								.variant("outline")
								.size("small")
								.on("press", CustomerDetailMessage.PressedAddNote()),
							h.menu
								.key("actions")
								.label("More actions")
								.entries(actionEntries(state, inputs.isAdmin, account))
								.trigger(
									h.button
										.label("More actions")
										.icon("dots")
										.iconOnly()
										.variant("outline")
										.size("small"),
								)
								.on("select", ({ id }) => CustomerDetailMessage.SelectedAction({ id })),
						),
				),
			facts.length === 0
				? null
				: h.stack
						.key("facts")
						.axis("horizontal")
						.density("compact")
						.wrap()
						.children(...facts),
		)
}

/**
 * The five tabs; Users and Notes count theirs.
 * HAZEL-GAP(pk5-page-tabs-compact): at 390 the bar draws clipped to half its height.
 */
export const tabs = (h: H, inputs: HeaderInputs, account: AccountRow) =>
	viewTabs<CustomerDetailMessage, CustomerTab>(h, {
		tabs: [
			{ key: "overview", label: "Overview" },
			{ key: "users", label: "Users", count: account.contactCount },
			{ key: "billing", label: "Billing" },
			{ key: "activity", label: "Activity" },
			inputs.model.noteCount === null
				? { key: "notes", label: "Notes" }
				: { key: "notes", label: "Notes", count: inputs.model.noteCount },
		],
		selected: inputs.tab,
		onSelect: (tab) => CustomerDetailMessage.SelectedTab({ tab }),
	})
