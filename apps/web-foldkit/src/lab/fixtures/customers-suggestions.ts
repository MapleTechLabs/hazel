import { ChannelId, CustomerChannelSuggestionId } from "@hazel/schema"
import { Schema } from "effect"
import type { ChannelOption } from "../../customers/channels"
import type { SuggestionRow } from "../../customers/suggestions"
import { ACCOUNTS_BY_KEY } from "./customers"

/**
 * Suggested channel links over the named accounts: one strong (a domain match), several partial
 * ones, and one with long names. The channels are the org's (`channelOptionsStream`'s rows).
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(900_000 + n).padStart(12, "0")}`
const channelId = (n: number) => Schema.decodeSync(ChannelId)(uuid(n))
const suggestionId = (n: number) => Schema.decodeSync(CustomerChannelSuggestionId)(uuid(100 + n))

export const SUGGESTION_CHANNELS = {
	acme: { id: channelId(1), name: "acme-shared", isPrivate: false, origin: "slack" },
	kestrel: { id: channelId(2), name: "kestrel-support", isPrivate: false, origin: "connect" },
	northwind: { id: channelId(3), name: "nw-integration", isPrivate: true, origin: "discord" },
	long: {
		id: channelId(4),
		name: "ext-brightfield-analytics-enterprise-rollout-and-migration-war-room",
		isPrivate: false,
		origin: "slack",
	},
	/** A channel the user does not see locally: its suggestion is never shown. */
	unseen: { id: channelId(5), name: "hidden", isPrivate: true, origin: "hazel" },
} as const satisfies Record<string, ChannelOption>

export const SUGGESTION_CHANNEL_OPTIONS: ReadonlyArray<ChannelOption> = [
	SUGGESTION_CHANNELS.acme,
	SUGGESTION_CHANNELS.kestrel,
	SUGGESTION_CHANNELS.northwind,
	SUGGESTION_CHANNELS.long,
]

/** When the fixtures were scored (any fixed time). */
const COMPUTED_AT = new Date(Date.UTC(2026, 10, 10, 12))

const acme = ACCOUNTS_BY_KEY.acme
const kestrel = ACCOUNTS_BY_KEY.kestrel
const northwind = ACCOUNTS_BY_KEY.northwind
const brightfield = ACCOUNTS_BY_KEY.brightfield

/** Strong: three of four external members are at Acme's domain, and the workspace says so too. */
export const STRONG_SUGGESTION: SuggestionRow = {
	id: suggestionId(1),
	channelId: SUGGESTION_CHANNELS.acme.id,
	accountId: acme.id,
	accountName: acme.name,
	score: 88,
	strength: "strong",
	computedAt: COMPUTED_AT,
	reasons: [
		{ kind: "domain", domain: "acmerobotics.io", matched: 3, total: 4 },
		{ kind: "name", where: "workspace", value: "Acme Robotics", matchedOn: "acme" },
	],
}

/** Possible: one contact among five guests, nothing else. */
export const CONTACT_SUGGESTION: SuggestionRow = {
	id: suggestionId(2),
	channelId: SUGGESTION_CHANNELS.kestrel.id,
	accountId: kestrel.id,
	accountName: kestrel.name,
	score: 46,
	strength: "possible",
	computedAt: COMPUTED_AT,
	reasons: [{ kind: "contacts", matched: 1, total: 5, sample: ["mara@kestrel.so"] }],
}

/** Possible: sibling channels of the Discord server, and the channel's name. */
export const WORKSPACE_SUGGESTION: SuggestionRow = {
	id: suggestionId(3),
	channelId: SUGGESTION_CHANNELS.northwind.id,
	accountId: northwind.id,
	accountName: northwind.name,
	score: 46,
	strength: "possible",
	computedAt: COMPUTED_AT,
	reasons: [
		{ kind: "workspace", provider: "discord", workspaceName: "Northwind Partners", linkedChannels: 2 },
		{ kind: "name", where: "channel", value: "nw-integration", matchedOn: "northwind" },
	],
}

/** Long names on both sides. */
export const LONG_SUGGESTION: SuggestionRow = {
	id: suggestionId(4),
	channelId: SUGGESTION_CHANNELS.long.id,
	accountId: brightfield.id,
	accountName: `${brightfield.name} International Holdings and Subsidiaries (EMEA)`,
	score: 88,
	strength: "strong",
	computedAt: COMPUTED_AT,
	reasons: [
		{ kind: "contacts", matched: 6, total: 6, sample: ["a@brightfield.ai", "b@brightfield.ai"] },
		{ kind: "domain", domain: "brightfield.ai", matched: 6, total: 6 },
		{ kind: "name", where: "channel", value: SUGGESTION_CHANNELS.long.name, matchedOn: "brightfield" },
	],
}

/** For a channel the user cannot see locally. */
export const UNSEEN_SUGGESTION: SuggestionRow = {
	id: suggestionId(5),
	channelId: SUGGESTION_CHANNELS.unseen.id,
	accountId: acme.id,
	accountName: acme.name,
	score: 46,
	strength: "possible",
	computedAt: COMPUTED_AT,
	reasons: [{ kind: "name", where: "channel", value: "hidden-acme", matchedOn: "acme" }],
}

export const SUGGESTIONS: ReadonlyArray<SuggestionRow> = [
	STRONG_SUGGESTION,
	LONG_SUGGESTION,
	WORKSPACE_SUGGESTION,
	CONTACT_SUGGESTION,
	UNSEEN_SUGGESTION,
]

/** The same suggestion for another channel (a page's own channel id). */
export const suggestionFor = (
	channel: ChannelId,
	base: SuggestionRow = STRONG_SUGGESTION,
): SuggestionRow => ({
	...base,
	channelId: channel,
})
