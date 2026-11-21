/**
 * Suggested channel links (`docs/customers/channels.md`): which customer a channel belongs to,
 * scored from what the `OrgObject` knows about the channel (its evidence) against what the
 * `CustomersObject` knows about its accounts (domains, contact emails, channels already linked).
 * Only the emails of the channel's external members make a suggestion; names never do.
 *
 * Pure and explainable, like signals: every suggestion carries the reasons that produced it, and
 * `describeReason` renders each as one sentence ("3 of 4 external members have @acme.com").
 */
import { FREE_MAIL_DOMAINS } from "./company"
import {
	ChannelId,
	ConnectConversationId,
	CustomerAccountId,
	CustomerChannelSuggestionId,
	OrganizationId,
} from "@hazel/schema"
import { Schema } from "effect"
import { JsonDate } from "../models/utils"

// ---------------------------------------------------------------------------
// Evidence (what the OrgObject answers for each linkable channel)
// ---------------------------------------------------------------------------

export const ChannelOrigin = Schema.Literals(["hazel", "slack", "discord", "connect"])
export type ChannelOrigin = typeof ChannelOrigin.Type

/** A provider workspace the channel is mirrored from or shared with. */
export const EvidenceWorkspace = Schema.Struct({
	provider: Schema.Literals(["slack", "discord"]),
	id: Schema.String,
	name: Schema.NullOr(Schema.String),
	/**
	 * Another organization's workspace: a Slack Connect team that is not the one the org installed
	 * from. A Discord guild is never `external` (it is the org's own server, shared or not).
	 */
	external: Schema.Boolean,
})
export type EvidenceWorkspace = typeof EvidenceWorkspace.Type

/** Someone from outside the org seen in the channel: a Connect guest or a Slack Connect author. */
export const EvidenceMember = Schema.Struct({
	source: Schema.Literals(["connect", "slack", "discord"]),
	/** Lower-cased; null when the provider does not share it. */
	email: Schema.NullOr(Schema.String),
})
export type EvidenceMember = typeof EvidenceMember.Type

export const ChannelEvidence = Schema.Struct({
	channelId: ChannelId,
	channelName: Schema.String,
	origin: ChannelOrigin,
	workspaces: Schema.Array(EvidenceWorkspace),
	/** At most `MAX_EVIDENCE_MEMBERS`, most recently seen first. */
	externalMembers: Schema.Array(EvidenceMember),
	/**
	 * How many external members there are in all (`externalMembers` may be a sample). A channel
	 * whose members were not all seen is never linked automatically.
	 */
	externalMemberCount: Schema.optionalKey(Schema.Finite),
	/**
	 * A Connect channel this org mounted as a guest: its people are the host's participants, which
	 * only the host org holds (`org.connectGuestEvidence`).
	 */
	connect: Schema.optionalKey(
		Schema.Struct({ hostOrganizationId: OrganizationId, conversationId: ConnectConversationId }),
	),
})
export type ChannelEvidence = typeof ChannelEvidence.Type

export const MAX_EVIDENCE_MEMBERS = 200

// ---------------------------------------------------------------------------
// Reasons and suggestions
// ---------------------------------------------------------------------------

export const SuggestionReason = Schema.Union([
	/** External members who are the account's contacts (exact email). */
	Schema.Struct({
		kind: Schema.Literal("contacts"),
		matched: Schema.Finite,
		/** External members whose email is known. */
		total: Schema.Finite,
		/** Every external member seen; absent on reasons stored before it was counted. */
		members: Schema.optionalKey(Schema.Finite),
		/** Up to three of the matched emails. */
		sample: Schema.Array(Schema.String),
	}),
	/** External members whose email is at one of the account's domains. */
	Schema.Struct({
		kind: Schema.Literal("domain"),
		domain: Schema.String,
		matched: Schema.Finite,
		/** External members whose email is known. */
		total: Schema.Finite,
		/** Every external member seen; absent on reasons stored before it was counted. */
		members: Schema.optionalKey(Schema.Finite),
	}),
	/** Other channels of the same workspace are linked to the account, and to no other. */
	Schema.Struct({
		kind: Schema.Literal("workspace"),
		provider: Schema.Literals(["slack", "discord"]),
		workspaceName: Schema.NullOr(Schema.String),
		linkedChannels: Schema.Finite,
	}),
	/**
	 * The channel's or its workspace's name named the account. No longer produced (names matched
	 * the org's own server and people's channels); kept so decided rows stored with it still read.
	 */
	Schema.Struct({
		kind: Schema.Literal("name"),
		where: Schema.Literals(["channel", "workspace"]),
		value: Schema.String,
		matchedOn: Schema.String,
	}),
])
export type SuggestionReason = typeof SuggestionReason.Type

export const SuggestionStrength = Schema.Literals(["strong", "possible"])
export type SuggestionStrength = typeof SuggestionStrength.Type

export const SuggestionStatus = Schema.Literals(["open", "dismissed", "accepted"])
export type SuggestionStatus = typeof SuggestionStatus.Type

/** One scored candidate for a channel. */
export interface ScoredSuggestion {
	readonly channelId: ChannelId
	readonly accountId: CustomerAccountId
	/** 0–100. */
	readonly score: number
	readonly strength: SuggestionStrength
	readonly reasons: ReadonlyArray<SuggestionReason>
	/**
	 * Linked without a click: a Connect channel where at least half the guests are this
	 * account's contacts, or any channel whose external members all have an email at its domain;
	 * either way every member was seen and no other account has a match.
	 */
	readonly autoLink: boolean
}

/** What the suggestions RPCs answer (open ones only). */
export const ChannelSuggestion = Schema.Struct({
	id: CustomerChannelSuggestionId,
	channelId: ChannelId,
	accountId: CustomerAccountId,
	accountName: Schema.String,
	score: Schema.Finite,
	strength: SuggestionStrength,
	reasons: Schema.Array(SuggestionReason),
	computedAt: JsonDate,
})
export type ChannelSuggestion = typeof ChannelSuggestion.Type

// ---------------------------------------------------------------------------
// The index the scorer matches against
// ---------------------------------------------------------------------------

export interface SuggestionAccount {
	readonly id: CustomerAccountId
	readonly name: string
	readonly domains: ReadonlyArray<string>
}

export interface SuggestionIndex {
	readonly accounts: ReadonlyMap<CustomerAccountId, SuggestionAccount>
	/** Lower-cased contact email → the accounts it is a contact of. */
	readonly contactEmails: ReadonlyMap<string, ReadonlyArray<CustomerAccountId>>
	/** Lower-cased domain → accounts. Free-mail domains are never here. */
	readonly domains: ReadonlyMap<string, ReadonlyArray<CustomerAccountId>>
	/** `${provider}:${workspaceId}` → the account each already linked channel of it belongs to. */
	readonly workspaceLinks: ReadonlyMap<string, ReadonlyArray<CustomerAccountId>>
}

export const workspaceKey = (provider: string, workspaceId: string) => `${provider}:${workspaceId}`

const domainOf = (email: string): string | null => {
	const at = email.lastIndexOf("@")
	return at < 0 ? null : email.slice(at + 1).toLowerCase()
}

const push = <K, V>(map: Map<K, Array<V>>, key: K, value: V) => {
	const list = map.get(key)
	if (list === undefined) map.set(key, [value])
	else if (!list.includes(value)) list.push(value)
}

export const buildSuggestionIndex = (input: {
	readonly accounts: ReadonlyArray<SuggestionAccount>
	readonly contacts: ReadonlyArray<{ readonly accountId: CustomerAccountId; readonly email: string | null }>
	/** Live links with the channel's workspaces (from its evidence). */
	readonly links: ReadonlyArray<{
		readonly accountId: CustomerAccountId
		readonly workspaces: ReadonlyArray<EvidenceWorkspace>
	}>
}): SuggestionIndex => {
	const accounts = new Map(input.accounts.map((account) => [account.id, account] as const))
	const contactEmails = new Map<string, Array<CustomerAccountId>>()
	for (const contact of input.contacts) {
		if (contact.email === null || !accounts.has(contact.accountId)) continue
		push(contactEmails, contact.email.trim().toLowerCase(), contact.accountId)
	}
	const domains = new Map<string, Array<CustomerAccountId>>()
	for (const account of input.accounts) {
		for (const domain of account.domains) {
			const normal = domain
				.trim()
				.toLowerCase()
				.replace(/^www\./, "")
			if (normal.length > 0 && !FREE_MAIL_DOMAINS.has(normal)) push(domains, normal, account.id)
		}
	}
	const workspaceLinks = new Map<string, Array<CustomerAccountId>>()
	for (const link of input.links) {
		if (!accounts.has(link.accountId)) continue
		for (const workspace of link.workspaces) {
			const key = workspaceKey(workspace.provider, workspace.id)
			// Keep one entry per linked channel: the count is the number of channels.
			const list = workspaceLinks.get(key)
			if (list === undefined) workspaceLinks.set(key, [link.accountId])
			else list.push(link.accountId)
		}
	}
	return { accounts, contactEmails, domains, workspaceLinks }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Below this nothing is suggested. */
export const MIN_SUGGESTION_SCORE = 30
/** At or above this a suggestion is `strong`. */
export const STRONG_SUGGESTION_SCORE = 75
/** At most this many suggestions per channel. */
export const MAX_SUGGESTIONS_PER_CHANNEL = 3

/** The weight (0–100) of one reason. */
const weightOf = (reason: SuggestionReason): number => {
	switch (reason.kind) {
		case "contacts":
			return 60 + 35 * (reason.matched / reason.total)
		case "domain":
			return 40 + 45 * (reason.matched / reason.total)
		case "workspace":
			// A Slack Connect team is another company's; a Discord guild is the org's own server, so
			// its sibling links say less until several agree.
			return reason.provider === "slack" ? 75 : Math.min(60, 35 + 10 * reason.linkedChannels)
		case "name":
			return reason.where === "workspace" ? 50 : 30
	}
}

/** Independent evidence compounds: 1 - Π(1 - w). */
const combine = (reasons: ReadonlyArray<SuggestionReason>) =>
	Math.round(100 * (1 - reasons.reduce((rest, reason) => rest * (1 - weightOf(reason) / 100), 1)))

/**
 * The suggestions for one channel, best first (at most `MAX_SUGGESTIONS_PER_CHANNEL`), never for
 * an account in `exclude` (dismissed for this channel). Callers skip channels already linked.
 */
export const scoreChannel = (
	evidence: ChannelEvidence,
	index: SuggestionIndex,
	exclude: ReadonlySet<CustomerAccountId> = new Set(),
): ReadonlyArray<ScoredSuggestion> => {
	const reasons = new Map<CustomerAccountId, Array<SuggestionReason>>()
	const add = (accountId: CustomerAccountId, reason: SuggestionReason) => {
		if (exclude.has(accountId) || !index.accounts.has(accountId)) return
		push(reasons, accountId, reason)
	}

	// Contacts and domains, over the external members whose email is known.
	const emails = [
		...new Set(
			evidence.externalMembers.flatMap((member) =>
				member.email === null ? [] : [member.email.trim().toLowerCase()],
			),
		),
	]
	const total = emails.length
	// The same unit as `total` (distinct emails), plus the members whose email is unknown.
	const members = total + evidence.externalMembers.filter((member) => member.email === null).length
	if (total > 0) {
		const contactHits = new Map<CustomerAccountId, Array<string>>()
		const domainHits = new Map<CustomerAccountId, Map<string, number>>()
		for (const email of emails) {
			for (const accountId of index.contactEmails.get(email) ?? []) push(contactHits, accountId, email)
			const domain = domainOf(email)
			if (domain === null) continue
			for (const accountId of index.domains.get(domain) ?? []) {
				const counts = domainHits.get(accountId) ?? new Map<string, number>()
				counts.set(domain, (counts.get(domain) ?? 0) + 1)
				domainHits.set(accountId, counts)
			}
		}
		for (const [accountId, hits] of contactHits) {
			add(accountId, {
				kind: "contacts",
				matched: hits.length,
				total,
				members,
				sample: hits.slice(0, 3),
			})
		}
		for (const [accountId, counts] of domainHits) {
			const top = [...counts].sort((a, b) => b[1] - a[1])[0]
			if (top !== undefined)
				add(accountId, { kind: "domain", domain: top[0], matched: top[1], total, members })
		}
	}

	// Sibling channels of the same workspace, when they all name one account.
	for (const workspace of evidence.workspaces) {
		// The org's own Slack workspace says nothing about a customer.
		if (workspace.provider === "slack" && !workspace.external) continue
		const linked = index.workspaceLinks.get(workspaceKey(workspace.provider, workspace.id)) ?? []
		const accountId = linked[0]
		if (accountId === undefined || linked.some((other) => other !== accountId)) continue
		// A Discord guild needs two agreeing channels: one could be a coincidence.
		if (workspace.provider === "discord" && linked.length < 2) continue
		add(accountId, {
			kind: "workspace",
			provider: workspace.provider,
			workspaceName: workspace.name,
			linkedChannels: linked.length,
		})
	}

	// Only email evidence makes a suggestion: a workspace's linked siblings add to an account the
	// channel's people already point at, never name one on their own.
	const byEmail = (list: ReadonlyArray<SuggestionReason>) =>
		list.some((reason) => reason.kind === "contacts" || reason.kind === "domain")

	const scored = [...reasons]
		.filter(([, list]) => byEmail(list))
		.map(([accountId, list]) => {
			const score = combine(list)
			return {
				channelId: evidence.channelId,
				accountId,
				score,
				strength: score >= STRONG_SUGGESTION_SCORE ? ("strong" as const) : ("possible" as const),
				reasons: list.sort((a, b) => weightOf(b) - weightOf(a)),
				autoLink: false,
			}
		})
	const ranked = scored
		.filter((suggestion) => suggestion.score >= MIN_SUGGESTION_SCORE)
		.sort((a, b) => b.score - a.score || (a.accountId < b.accountId ? -1 : 1))
		.slice(0, MAX_SUGGESTIONS_PER_CHANNEL)

	// Auto-link, when no other account has a match and every external member was seen, on either:
	// - contacts: a Connect channel, half its Connect guests or more are the account's contacts
	//   (members from a mirror of the same channel do not count);
	// - domain: any channel whose external members all have a known email at the account's domain.
	const best = ranked[0]
	if (best === undefined) return ranked
	// A sample of the members: the ones not seen could be another account's (or no one's contacts),
	// so neither the share nor the rival check can be trusted.
	const seen = evidence.externalMembers.length
	// The count decides when it is sent; without one, a full list may have been cut at the cap.
	const sampled =
		evidence.externalMemberCount === undefined
			? seen >= MAX_EVIDENCE_MEMBERS
			: seen < evidence.externalMemberCount
	if (sampled) return ranked
	const rivals = scored.some((other) => other.accountId !== best.accountId)
	if (rivals) return ranked
	const linked = [{ ...best, autoLink: true }, ...ranked.slice(1)]
	// Domain: every member's email is known and at the account's domain.
	const domainReason = best.reasons.find((reason) => reason.kind === "domain")
	if (
		domainReason !== undefined &&
		domainReason.matched === domainReason.total &&
		(domainReason.members ?? domainReason.total) === domainReason.total
	) {
		return linked
	}
	if (evidence.origin !== "connect") return ranked
	// Every Connect guest counts, its email known or not (only the known ones can match).
	const connectGuests = evidence.externalMembers.filter((member) => member.source === "connect")
	const guests = [
		...new Set(
			connectGuests.flatMap((member) =>
				member.email === null ? [] : [member.email.trim().toLowerCase()],
			),
		),
	]
	const guestCount = guests.length + connectGuests.filter((member) => member.email === null).length
	const guestContacts = guests.filter((email) =>
		(index.contactEmails.get(email) ?? []).includes(best.accountId),
	).length
	return guestContacts > 0 && guestContacts * 2 >= guestCount ? linked : ranked
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "an Acme" / "a Globex": the article before an account name. */
const a = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`)

const providerName = (provider: "slack" | "discord") => (provider === "slack" ? "Slack" : "Discord")

/** One sentence per reason, for the UI and timeline events. */
export const describeReason = (reason: SuggestionReason, accountName: string): string => {
	switch (reason.kind) {
		case "contacts":
		case "domain": {
			const what =
				reason.kind === "contacts"
					? { one: `is ${a(accountName)} contact`, many: `are ${accountName} contacts` }
					: {
							one: `has @${reason.domain}, ${accountName}'s domain`,
							many: `have @${reason.domain}, ${accountName}'s domain`,
						}
			// Only members whose email is known are counted: say so when some are not.
			const known =
				reason.members !== undefined && reason.members > reason.total ? " with a known email" : ""
			if (reason.matched === reason.total && known === "") {
				return reason.total === 1
					? `The external member ${what.one}`
					: `All ${reason.total} external members ${what.many}`
			}
			return reason.matched === 1 && reason.total === 1
				? `The one external member${known} ${what.one}`
				: `${reason.matched} of ${reason.total} external members${known} ${reason.matched === 1 ? what.one : what.many}`
		}
		case "workspace": {
			const where =
				reason.workspaceName === null
					? `this ${providerName(reason.provider)} ${reason.provider === "slack" ? "workspace" : "server"}`
					: `${reason.workspaceName} (${providerName(reason.provider)})`
			return `${reason.linkedChannels} other ${reason.linkedChannels === 1 ? "channel" : "channels"} from ${where} ${reason.linkedChannels === 1 ? "is" : "are"} linked to ${accountName}`
		}
		case "name":
			return reason.where === "channel"
				? `The channel name contains "${reason.matchedOn}"`
				: `The workspace name "${reason.value}" contains "${reason.matchedOn}"`
	}
}
