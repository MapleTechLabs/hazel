// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customer page's details panel (today's `page/customers/detail/view.ts` `sidebar`,
 * `company-section.ts`, `people-in-chat.ts`): what people look up first (owner, stage, plan), the
 * company and where the team talks to the customer, then the plumbing (flags, attributes, records).
 */
import { enrichmentDomainOf } from "@hazel/domain/customers"
import type * as Customers from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import {
	companyPages,
	companyTypeLabel,
	countryFlag,
	employeesLabel,
	fundingStageLabel,
	fundingStageOf,
	headquartersLabel,
	linkLabel,
	revenueLabel,
	usdLabel,
} from "../data/company"
import { type ChannelLinkRow, type ChannelOption, ORIGIN_LABEL, searchOptions } from "../data/channels"
import { formatCount, formatDate, formatMoney, formatRelative } from "../data/format"
import { providerOf, safeSourceUrl, sourceLabel } from "../data/providers"
import type { AccountRow, MemberRow } from "../data/queries"
import { shownSuggestions } from "../data/suggestions"
import { stageBadge } from "../ui/badges"
import { personAvatar, personLabel, sourceLogo } from "../ui/identity"
import {
	type ChatPerson,
	chatPeopleOf,
	chatPersonEntries,
	type CustomerDetailModel,
	CustomerDetailMessage,
	customerOfAccount,
	featureFlagKeysOf,
	hasFlag,
	isCompanyRefreshPending,
	isCompanyRefreshUnanswered,
	renewingSubscriptionOf,
	suggestionsOf,
} from "./model"

type H = Hazel.H<CustomerDetailMessage>

/** What the panel reads besides the Model. */
export interface SidebarInputs {
	readonly model: CustomerDetailModel
	readonly account: AccountRow
	readonly detail: Customers.AccountDetail | null
	readonly suggestions: ReadonlyArray<Customers.ChannelSuggestion> | null
	readonly owner: MemberRow | null
	readonly orgSlug: string
	readonly nowMs: number
	readonly isAdmin: boolean
}

/**
 * One titled group of the panel, with its count or note at the end of the title line.
 * HAZEL-GAP(pk5-panel-section): today's group is `px-5 py-4` under a hairline with the kit's
 * `subsection` heading; the nearest is a padded stack with a `heading` level 3.
 */
const panelSection = (h: H, key: string, title: string, aside: string | null, ...rows: Array<unknown>) =>
	h.stack
		.key(key)
		.inset("page")
		.density("compact")
		.children(
			h.stack
				.axis("horizontal")
				.align("center")
				.children(
					h.heading.level("3").children(title),
					h.spacer,
					aside === null ? null : h.text.role("caption").tone("muted").children(aside),
				),
			h.stack.density("none").children(...(rows as Array<never>)),
		)

const note = (h: H, text: string) => h.text.key(text).tone("muted").children(text)

const property = (h: H, label: string, ...value: Array<unknown>) =>
	h.property
		.key(label)
		.label(label)
		.children(...(value as Array<never>))

const copyButton = (h: H, text: string, label: string) =>
	h.button
		.key(`copy:${label}`)
		.label(`Copy ${label}`)
		.icon("copy")
		.iconOnly()
		.variant("ghost")
		.size("xsmall")
		.on("press", CustomerDetailMessage.PressedCopy({ text, label }))

// DETAILS

// HAZEL-GAP(pk5-tag-chip): today's tags are small secondary chips and add is a 20px bordered "+".
const tagsRow = (h: H, model: CustomerDetailModel, account: AccountRow) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.density("tight")
		.wrap()
		.children(
			...account.tags.map((tag) =>
				h.button
					.key(tag)
					.label(tag)
					.variant("chip")
					.size("xsmall")
					.removable()
					.on("remove", CustomerDetailMessage.PressedRemoveTag({ tag })),
			),
			h.popover
				.key("tag-picker")
				.open(model.isTagPickerOpen)
				.anchor(
					h.button
						.label("Add tag")
						.icon("plus")
						.iconOnly()
						.variant("dashed")
						.size("xsmall")
						.on("press", CustomerDetailMessage.PressedAddTag()),
				)
				.on("dismiss", CustomerDetailMessage.DismissedTagPicker())
				.children(
					h.frame.surface("overlay").children(
						h.stack.density("compact").children(
							h.textField
								.label("Tag name")
								.placeholder("Tag name")
								.value(model.tagInput)
								.on("change", (payload) => CustomerDetailMessage.ChangedTagInput({ payload }))
								.on("submit", (payload) => CustomerDetailMessage.SubmittedTag({ payload })),
							h.button
								.label("Add tag")
								.size("small")
								.disabled(model.tagInput.text.trim() === "")
								.on("press", CustomerDetailMessage.PressedSaveTag()),
						),
					),
				),
		)

const detailsSection = (h: H, inputs: SidebarInputs) => {
	const { account, detail } = inputs
	const now = new Date(inputs.nowMs)
	const fieldSources = detail?.account.fieldSources ?? {}
	const stageSource = fieldSources["lifecycleStage"]
	const subscription = renewingSubscriptionOf(detail?.subscriptions ?? [])
	return panelSection(
		h,
		"details",
		"Details",
		null,
		property(h, "Owner", personLabel(h, inputs.owner)),
		property(
			h,
			"Stage",
			h.stack
				.axis("horizontal")
				.align("center")
				.children(
					stageBadge(h, account.lifecycleStage),
					h.spacer,
					stageSource === undefined
						? null
						: h.text.role("caption").tone("muted").children(sourceLabel(stageSource)),
				),
		),
		property(h, "Plan", h.text.children(account.planName ?? "—")),
		property(h, "MRR", h.text.children(formatMoney(account.mrrMinor, account.currency))),
		account.seatsUsed === null
			? null
			: property(
					h,
					"Seats",
					h.text.children(
						account.seatsLimit === null
							? formatCount(account.seatsUsed)
							: `${formatCount(account.seatsUsed)} of ${formatCount(account.seatsLimit)}`,
					),
				),
		subscription === undefined || subscription.currentPeriodEnd === null
			? null
			: property(
					h,
					subscription.cancelAtPeriodEnd ? "Cancels" : "Renews",
					h.text.children(formatDate(subscription.currentPeriodEnd, { now, withYear: true })),
				),
		property(
			h,
			"Customer since",
			h.text.children(formatDate(new Date(account.firstSeenAtMs), { now, withYear: true })),
		),
		property(h, "Tags", tagsRow(h, inputs.model, account)),
	)
}

// COMPANY

/** "Add domain" (no company domain yet) or the domain being changed. */
const domainForm = (h: H, model: CustomerDetailModel) =>
	h.stack
		.key("domain-form")
		.axis("horizontal")
		.align("center")
		.density("compact")
		.children(
			h.textField
				.label("Company domain")
				.placeholder("acme.com")
				.value(model.domain.field)
				.on("change", (payload) => CustomerDetailMessage.ChangedDomain({ payload }))
				.on("submit", (payload) => CustomerDetailMessage.SubmittedDomain({ payload })),
			h.button
				.label(model.domain.editing === null ? "Add" : "Save")
				.variant("outline")
				.size("small")
				.loading(model.domain.isSaving)
				.disabled(model.domain.field.text.trim() === "")
				.on("press", CustomerDetailMessage.PressedSaveDomain()),
			model.domain.editing === null
				? null
				: h.button
						.label("Cancel")
						.variant("ghost")
						.size("small")
						.disabled(model.domain.isSaving)
						.on("press", CustomerDetailMessage.PressedCancelDomain()),
		)

const domainRow = (h: H, inputs: SidebarInputs, domain: string) =>
	inputs.isAdmin && inputs.model.domain.editing === domain
		? domainForm(h, inputs.model)
		: property(
				h,
				"Domain",
				h.stack
					.axis("horizontal")
					.align("center")
					.children(
						h.text.truncate().children(domain),
						h.spacer,
						inputs.isAdmin
							? h.button
									.label("Change")
									.variant("ghost")
									.size("xsmall")
									.on("press", CustomerDetailMessage.PressedChangeDomain({ domain }))
							: null,
					),
			)

const refreshButton = (h: H, label: string, isPending: boolean, iconOnly: boolean) =>
	h.button
		.key(`refresh:${label}`)
		.label(label)
		.icon("refresh")
		.iconOnly(iconOnly)
		.variant(iconOnly ? "ghost" : "outline")
		.size("xsmall")
		.loading(isPending)
		.on("press", CustomerDetailMessage.PressedRefreshCompany())

/** A figure of the company's grid; nothing when there is no value. */
const figure = (h: H, label: string, value: string | null, detail: string | null) =>
	value === null
		? null
		: // HAZEL-GAP(pk5-figure-tile): today's figure is a bordered `px-3 py-2` box, its value at
			// body size; `statTile` draws the value at the stat step.
			h.frame
				.key(label)
				.surface("inset")
				.children(
					h.stack
						.density("none")
						.children(
							h.text.role("caption").tone("muted").children(label),
							h.text.strong().children(value),
							detail === null ? null : h.text.role("caption").tone("muted").children(detail),
						),
				)

const companySection = (h: H, inputs: SidebarInputs) => {
	const { account, model } = inputs
	const company = account.company
	const now = new Date(inputs.nowMs)
	const isPending = isCompanyRefreshPending(model, inputs.nowMs, account.companyCheckedAtMs)
	const isUnanswered = isCompanyRefreshUnanswered(model, inputs.nowMs, account.companyCheckedAtMs)
	const domain = enrichmentDomainOf([
		...(account.domain === null ? [] : [account.domain]),
		...(inputs.detail?.account.domains ?? []),
	])
	const checked =
		account.companyCheckedAtMs === null ? null : formatRelative(new Date(account.companyCheckedAtMs), now)
	// HAZEL-GAP(pk5-company-blur-in): today's lookup states and a newly found profile blur in, one
	// part after another; the profile here appears at once.
	if (company === null && domain === null)
		return panelSection(
			h,
			"company",
			"Company",
			null,
			note(
				h,
				inputs.isAdmin
					? "Add the customer's website domain and Hazel looks up their company."
					: "No company domain to look up. An admin can add one.",
			),
			inputs.isAdmin ? domainForm(h, model) : null,
		)
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
		return panelSection(
			h,
			"company",
			"Company",
			checked === null ? null : `Checked ${checked}`,
			domain === null ? null : domainRow(h, inputs, domain),
			note(h, text),
			action === null ? null : refreshButton(h, action, isPending, false),
		)
	}
	const latest = company.funding?.rounds[0] ?? null
	const latestMs = latest?.date == null ? Number.NaN : Date.parse(`${latest.date}T00:00:00Z`)
	const latestParts = [
		latest === null || latest.amountUsd === null ? null : usdLabel(latest.amountUsd),
		Number.isNaN(latestMs) ? null : formatDate(new Date(latestMs), { now, withYear: true }),
	].filter((part) => part !== null)
	const stage = fundingStageOf(company)
	const totalUsd = company.funding?.totalUsd ?? null
	const flag = countryFlag(company.headquarters?.countryCode ?? null)
	const headquarters = headquartersLabel(company)
	const type = companyTypeLabel(company)
	const revenue = revenueLabel(company)
	const age = company.foundedYear === null ? null : now.getUTCFullYear() - company.foundedYear
	const figures = [
		figure(
			h,
			"Employees",
			employeesLabel(company),
			company.employeeCount === null || company.employeeRange === null
				? null
				: `${formatCount(company.employeeCount)} on record`,
		),
		figure(
			h,
			"Funding",
			stage === null ? (totalUsd === null ? null : usdLabel(totalUsd)) : fundingStageLabel(stage),
			stage === null || totalUsd === null ? null : `${usdLabel(totalUsd)} raised`,
		),
		figure(h, "Est. revenue", revenue, revenue === null ? null : "per year"),
		figure(
			h,
			"Founded",
			company.foundedYear === null ? null : String(company.foundedYear),
			age === null || age < 1 ? null : `${age} ${age === 1 ? "year" : "years"} ago`,
		),
	].filter((tile) => tile !== null)
	const status = isPending ? "Looking up…" : isUnanswered ? "Refresh failed, retrying soon" : checked
	const pages = companyPages(company).filter((page) => page.url.startsWith("https://"))
	return panelSection(
		h,
		"company",
		"Company",
		null,
		company.description === null
			? null
			: // HAZEL-GAP(pk5-text-clamp): today's description is clamped to three lines.
				h.text.key("description").tone("subtle").children(company.description),
		figures.length === 0
			? null
			: h.grid
					.key("figures")
					.columns("2")
					.density("compact")
					.children(...figures),
		domain === null ? null : domainRow(h, inputs, domain),
		property(
			h,
			"Industry",
			company.industry === null
				? h.text.tone("muted").children("—")
				: h.stack
						.density("none")
						.children(
							h.text.truncate().children(company.industry),
							company.subindustry === null
								? null
								: h.text
										.role("caption")
										.tone("muted")
										.truncate()
										.children(company.subindustry),
						),
		),
		property(
			h,
			"Headquarters",
			headquarters === null
				? h.text.tone("muted").children("—")
				: h.text.truncate().children(flag === "" ? headquarters : `${flag} ${headquarters}`),
		),
		type === null ? null : property(h, "Type", h.text.children(type)),
		latestParts.length === 0 || latest === null
			? null
			: property(
					h,
					"Last round",
					h.stack
						.density("none")
						.children(
							h.text.truncate().children(fundingStageLabel(latest.type)),
							h.text.role("caption").tone("muted").truncate().children(latestParts.join(" · ")),
						),
				),
		pages.length === 0
			? null
			: h.stack
					.key("pages")
					.axis("horizontal")
					.density("compact")
					.wrap()
					.children(
						...pages.map((page) =>
							h.link.key(page.url).tone("muted").label(linkLabel(page)).href(page.url),
						),
					),
		h.stack
			.key("source")
			.axis("horizontal")
			.align("center")
			.children(
				h.text
					.role("caption")
					.tone("muted")
					.truncate()
					.children(status === null ? "From context.dev" : `From context.dev · ${status}`),
				h.spacer,
				refreshButton(h, "Refresh company profile", isPending, true),
			),
	)
}

// CHANNELS

const linkedChannelRow = (
	h: H,
	inputs: SidebarInputs,
	entry: ChannelLinkRow,
	channel: ChannelOption | undefined,
) =>
	h.frame
		.key(entry.channelId)
		.surface("inset")
		.children(
			h.stack
				.axis("horizontal")
				.align("center")
				.density("compact")
				.children(
					// HAZEL-GAP(pk5-channel-mark): today's row leads with the channel's mark (its origin's
					// logo or a hash); `channelIcon` takes an emoji and marks, not an origin.
					h.icon.name(channel?.isPrivate === true || channel === undefined ? "lock" : "hashtag"),
					h.stack.density("none").children(
						channel === undefined
							? h.text.tone("muted").truncate().children("A channel you can't see")
							: h.link.label(channel.name).href(`/${inputs.orgSlug}/chat/${channel.id}`),
						channel === undefined
							? null
							: h.text
									.role("caption")
									.tone("muted")
									.children(
										entry.linkedBy === null
											? `${ORIGIN_LABEL[channel.origin]} · Linked automatically`
											: ORIGIN_LABEL[channel.origin],
									),
					),
					h.spacer,
					h.button
						.label(channel === undefined ? "Unlink channel" : `Unlink ${channel.name}`)
						.icon("close")
						.iconOnly()
						.variant("ghost")
						.size("xsmall")
						.on(
							"press",
							CustomerDetailMessage.PressedUnlinkChannel({ channelId: entry.channelId }),
						),
				),
		)

const channelPicker = (h: H, inputs: SidebarInputs, linkedHere: ReadonlySet<string>) => {
	const { model } = inputs
	const customerOf = customerOfAccount(model.accounts)
	const owners = new Map(model.channelLinks.map((entry) => [entry.channelId, customerOf(entry.accountId)]))
	const names = new Map((model.accounts ?? []).map((account) => [account.id, account.name]))
	const candidates = searchOptions(
		model.channelOptions.filter((channel) => !linkedHere.has(channel.id)),
		model.channelSearch.text,
	)
	return h.popover
		.key("channel-picker")
		.open(model.isChannelPickerOpen)
		.anchor(
			h.button
				.label("Link channel")
				.icon("plus")
				.variant("outline")
				.size("xsmall")
				.on("press", CustomerDetailMessage.PressedLinkChannelPicker()),
		)
		.on("dismiss", CustomerDetailMessage.DismissedChannelPicker())
		.children(
			h.frame.surface("overlay").children(
				h.stack.density("tight").children(
					h.searchField
						.placeholder("Search channels")
						.value(model.channelSearch)
						.on("change", (payload) => CustomerDetailMessage.ChangedChannelSearch({ payload })),
					...(candidates.length === 0
						? [
								note(
									h,
									model.channelOptions.length === 0
										? "No channels to link yet."
										: "No channel matches.",
								),
							]
						: candidates.map((channel) => {
								const owner = owners.get(channel.id)
								const ownerName = owner === undefined ? undefined : names.get(owner)
								return h.item
									.key(channel.id)
									.title(channel.name)
									.subtitle(
										owner === undefined
											? ORIGIN_LABEL[channel.origin]
											: `Linked to ${ownerName ?? "another customer"}`,
									)
									.leading(h.icon.name(channel.isPrivate ? "lock" : "hashtag"))
									.on(
										"press",
										CustomerDetailMessage.PressedLinkChannel({ channelId: channel.id }),
									)
							})),
				),
			),
		)
}

const channelsSection = (h: H, inputs: SidebarInputs) => {
	const { model, account } = inputs
	const customerOf = customerOfAccount(model.accounts)
	const customer = customerOf(account.id)
	const linked = model.channelLinks.filter((entry) => customerOf(entry.accountId) === customer)
	const linkedHere = new Set<string>(linked.map((entry) => entry.channelId))
	const options = new Map(model.channelOptions.map((channel) => [channel.id, channel]))
	const suggested = shownSuggestions(
		suggestionsOf(inputs.suggestions, model.hiddenSuggestions),
		model.channelOptions,
	).filter(
		({ suggestion }) =>
			customerOf(suggestion.accountId) === customer && !linkedHere.has(suggestion.channelId),
	)
	return panelSection(
		h,
		"channels",
		"Channels",
		linked.length === 0 ? null : formatCount(linked.length),
		...(linked.length === 0
			? [note(h, "Link the Slack, Discord, Connect or Hazel channels you talk to this customer in.")]
			: linked.map((entry) => linkedChannelRow(h, inputs, entry, options.get(entry.channelId)))),
		suggested.length === 0
			? null
			: h.stack
					.key("suggested")
					.density("tight")
					.children(
						h.text.role("label").tone("muted").children("Suggested"),
						...suggested.map(({ suggestion, channel }) =>
							h.item
								.key(suggestion.id)
								.title(channel.name)
								.leading(h.icon.name(channel.isPrivate ? "lock" : "hashtag"))
								.trailing(
									h.button
										.label("Link")
										.variant("outline")
										.size("xsmall")
										.on(
											"press",
											CustomerDetailMessage.PressedAcceptSuggestion({
												suggestionId: suggestion.id,
											}),
										),
									h.button
										.label(`Dismiss ${channel.name}`)
										.icon("close")
										.iconOnly()
										.variant("ghost")
										.size("xsmall")
										.on(
											"press",
											CustomerDetailMessage.PressedDismissSuggestion({
												suggestionId: suggestion.id,
											}),
										),
								),
						),
					),
		channelPicker(h, inputs, linkedHere),
	)
}

// PEOPLE IN CHAT

const personRow = (h: H, inputs: SidebarInputs, person: ChatPerson) => {
	const isTeam = person.side !== "customer"
	return h.item
		.key(person.userId)
		.title(person.name)
		.subtitle(`Last message ${formatRelative(new Date(person.lastMessageAtMs), new Date(inputs.nowMs))}`)
		.muted(isTeam)
		.leading(personAvatar(h, { name: person.name, avatarUrl: person.avatarUrl }, "md"))
		.trailing(
			isTeam ? h.badge.style("quiet").size("small").label("Team") : null,
			h.menu
				.label(`More for ${person.name}`)
				.entries(chatPersonEntries(person))
				.trigger(
					h.button
						.label(`More for ${person.name}`)
						.icon("dots")
						.iconOnly()
						.variant("ghost")
						.size("xsmall"),
				)
				.on("select", ({ id }) =>
					CustomerDetailMessage.SelectedChatPersonEntry({ userId: person.userId, id }),
				),
		)
}

const peopleSection = (h: H, inputs: SidebarInputs) => {
	const { model, account } = inputs
	const customerOf = customerOfAccount(model.accounts)
	const customer = customerOf(account.id)
	const hasLinkedChannel = model.channelLinks.some((link) => customerOf(link.accountId) === customer)
	const people = hasLinkedChannel
		? chatPeopleOf(model.chatParticipants, model.chatAuthors, customer, customerOf)
		: []
	return panelSection(
		h,
		"people",
		"People in chat",
		null,
		...(people.length > 0
			? people.map((person) => personRow(h, inputs, person))
			: [
					note(
						h,
						hasLinkedChannel
							? "No one from this customer has written in its linked channels yet."
							: "Link a channel to see who writes there.",
					),
				]),
	)
}

// FEATURE FLAGS

const flagPicker = (h: H, inputs: SidebarInputs, candidates: ReadonlyArray<string>, holdsAny: boolean) => {
	const { model } = inputs
	const count = model.flagSelection.length
	return h.popover
		.key("flag-picker")
		.open(model.isFlagPickerOpen)
		.anchor(
			h.button
				.label("Add flags")
				.icon("plus")
				.variant("outline")
				.size("xsmall")
				.on("press", CustomerDetailMessage.PressedAddFlagsPicker()),
		)
		.on("dismiss", CustomerDetailMessage.DismissedFlagPicker())
		.children(
			h.frame.surface("overlay").children(
				h.stack.density("tight").children(
					...(candidates.length === 0
						? [
								note(
									h,
									holdsAny
										? "It has every flag. Create new ones under Settings → Feature flags."
										: "No flags to add yet. Create one under Settings → Feature flags.",
								),
							]
						: [
								...candidates.map((key) =>
									h.toggle
										.key(key)
										.style("checkbox")
										.label(key)
										.checked(model.flagSelection.includes(key))
										.on("change", ({ checked }) =>
											CustomerDetailMessage.ToggledFlag({ key, checked }),
										),
								),
								h.button
									.label(count <= 1 ? "Add flag" : `Add ${formatCount(count)} flags`)
									.size("small")
									.disabled(count === 0)
									.on("press", CustomerDetailMessage.PressedAddFlags()),
							]),
				),
			),
		)
}

const flagsSection = (h: H, inputs: SidebarInputs) => {
	const { account, model } = inputs
	const on = Object.keys(account.featureFlags)
		.filter((key) => hasFlag(account, key))
		.sort()
	if (on.length === 0 && !inputs.isAdmin) return null
	const candidates = featureFlagKeysOf(model.createdFeatureFlags, model.accounts ?? []).filter(
		(key) => !hasFlag(account, key),
	)
	return panelSection(
		h,
		"flags",
		"Feature flags",
		on.length === 0 ? null : formatCount(on.length),
		...(on.length === 0
			? [note(h, "No feature flags on.")]
			: on.map((key) =>
					h.frame
						.key(key)
						.surface("inset")
						.children(
							h.stack
								.axis("horizontal")
								.align("center")
								.children(
									h.text.role("code").truncate().children(key),
									h.spacer,
									inputs.isAdmin
										? h.button
												.label(`Turn off ${key}`)
												.icon("close")
												.iconOnly()
												.variant("ghost")
												.size("xsmall")
												.on("press", CustomerDetailMessage.PressedRemoveFlag({ key }))
										: null,
								),
						),
				)),
		inputs.isAdmin ? flagPicker(h, inputs, candidates, on.length > 0) : null,
	)
}

// ATTRIBUTES AND RECORDS

const attributeValue = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: JSON.stringify(value)

const attributeLabel = (key: string): string =>
	key.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase())

const attributesSection = (h: H, inputs: SidebarInputs) => {
	const fieldSources = inputs.detail?.account.fieldSources ?? {}
	const attributes = Object.entries(inputs.detail?.account.attributes ?? {}).filter(
		([, value]) => value !== null,
	)
	return attributes.length === 0
		? null
		: panelSection(
				h,
				"attributes",
				"Attributes",
				formatCount(attributes.length),
				...attributes.map(([key, value]) => {
					const source = fieldSources[key]
					return property(
						h,
						attributeLabel(key),
						h.stack
							.axis("horizontal")
							.align("center")
							.density("compact")
							.children(
								h.text.truncate().children(attributeValue(value)),
								h.spacer,
								source === undefined
									? null
									: h.text.role("caption").tone("muted").children(sourceLabel(source)),
								copyButton(h, attributeValue(value), attributeLabel(key)),
							),
					)
				}),
			)
}

const MATCH_LABEL = {
	existing: "existing link",
	shared_id: "shared ID",
	domain: "domain",
	manual: "linked by hand",
	created: "created from this record",
} as const satisfies Record<Customers.MatchMethod, string>

const recordLabel = (provider: Customers.CustomerProvider): string => {
	const { name, accountNoun } = providerOf(provider)
	return `${name} ${accountNoun}`
}

const recordsSection = (h: H, inputs: SidebarInputs) => {
	const { detail } = inputs
	const now = new Date(inputs.nowMs)
	const refs = (detail?.refs ?? []).filter((ref) => ref.entityType === "account")
	const linked = new Set<string>(refs.map((ref) => ref.provider))
	const unlinked =
		detail === null ? [] : inputs.model.connectedProviders.filter((provider) => !linked.has(provider))
	// HAZEL-GAP(pk5-row-tooltip): today's record row names its id, match and last sync in a tooltip,
	// and a stale record is drawn at 60%.
	return panelSection(
		h,
		"records",
		"Linked records",
		null,
		...refs.map((ref) => {
			const href = safeSourceUrl(ref.provider, ref.externalUrl)
			const title = [
				ref.externalId,
				`Matched by ${MATCH_LABEL[ref.matchMethod]}`,
				ref.lastSyncedAt === null ? null : `synced ${formatRelative(ref.lastSyncedAt, now)}`,
			]
				.filter((part) => part !== null)
				.join(" · ")
			return h.stack
				.key(ref.id)
				.axis("horizontal")
				.align("center")
				.density("compact")
				.children(
					sourceLogo(h, ref.provider),
					h.text.children(recordLabel(ref.provider)),
					h.text
						.tone("muted")
						.truncate()
						.children(ref.name ?? title),
					h.spacer,
					href === null ? null : h.link.label("Open").href(href),
					copyButton(h, ref.externalId, `${recordLabel(ref.provider)} ID`),
				)
		}),
		...unlinked.map((provider) =>
			h.stack
				.key(provider)
				.axis("horizontal")
				.align("center")
				.density("compact")
				.children(
					sourceLogo(h, provider),
					h.text
						.tone("muted")
						.truncate()
						.children(`No ${sourceLabel(provider)} record`),
					h.spacer,
					h.link.label("Find").href(`/${inputs.orgSlug}/customers/settings/sources/unmatched`),
				),
		),
		refs.length === 0 && unlinked.length === 0
			? note(h, detail === null ? "Loading…" : "Not linked to any source.")
			: null,
	)
}

/** The whole panel, sections parted by hairlines. */
export const sidebar = (h: H, inputs: SidebarInputs) => {
	const sections = [
		detailsSection(h, inputs),
		companySection(h, inputs),
		channelsSection(h, inputs),
		peopleSection(h, inputs),
		flagsSection(h, inputs),
		attributesSection(h, inputs),
		recordsSection(h, inputs),
	].filter((section) => section !== null)
	return h.stack
		.key("customer-details")
		.density("none")
		.children(...sections.flatMap((section, index) => (index === 0 ? [section] : [h.divider, section])))
}
