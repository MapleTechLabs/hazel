import type { ChannelId, CustomerAccountId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import {
	buildSuggestionIndex,
	type ChannelEvidence,
	describeReason,
	normalizeName,
	scoreChannel,
	type SuggestionAccount,
} from "./channel-suggestions"

const acme = "00000000-0000-4000-8000-00000000000a" as CustomerAccountId
const globex = "00000000-0000-4000-8000-00000000000b" as CustomerAccountId
const channel = "00000000-0000-4000-8000-0000000000c1" as ChannelId

const accounts: ReadonlyArray<SuggestionAccount> = [
	{ id: acme, name: "Acme, Inc.", domains: ["acme.com"] },
	{ id: globex, name: "Globex Corporation", domains: ["globex.io", "gmail.com"] },
]

const evidence = (over: Partial<ChannelEvidence>): ChannelEvidence => ({
	channelId: channel,
	channelName: "general",
	origin: "hazel",
	workspaces: [],
	externalMembers: [],
	...over,
})

const member = (email: string | null, source: "connect" | "slack" | "discord" = "connect") => ({
	source,
	email,
})

const index = (links: Parameters<typeof buildSuggestionIndex>[0]["links"] = []) =>
	buildSuggestionIndex({
		accounts,
		contacts: [
			{ accountId: acme, email: "Ana@acme.com" },
			{ accountId: acme, email: "bo@acme.com" },
			{ accountId: globex, email: "hank@gmail.com" },
		],
		links,
	})

describe("scoreChannel", () => {
	it("counts only Connect guests for auto-linking a channel that is also mirrored from Slack", () => {
		const mirrored = (slackEmails: ReadonlyArray<string>) =>
			evidence({
				origin: "connect",
				externalMembers: [
					member("ana@acme.com"),
					...slackEmails.map((email) => member(email, "slack")),
				],
			})
		// One Connect guest, a contact: half or more of the guests, whatever Slack adds.
		const [linked] = scoreChannel(
			mirrored(["x1@other.example", "x2@other.example", "x3@other.example"]),
			index(),
		)
		expect(linked).toMatchObject({ accountId: acme, autoLink: true })
		// The contact seen only through Slack: no Connect guest is a contact.
		const [notLinked] = scoreChannel(
			evidence({
				origin: "connect",
				externalMembers: [member("zed@elsewhere.example"), member("ana@acme.com", "slack")],
			}),
			index(),
		)
		expect(notLinked).toMatchObject({ accountId: acme, autoLink: false })
	})

	it("suggests nothing without evidence", () => {
		expect(scoreChannel(evidence({}), index())).toEqual([])
	})

	it("auto-links a Connect channel whose guests are one account's contacts", () => {
		const [best, ...rest] = scoreChannel(
			evidence({ origin: "connect", externalMembers: [member("ana@acme.com"), member("cy@acme.com")] }),
			index(),
		)
		expect(rest).toEqual([])
		expect(best).toMatchObject({ accountId: acme, strength: "strong", autoLink: true })
		expect(best!.reasons.map((reason) => reason.kind)).toEqual(["domain", "contacts"])
		expect(describeReason(best!.reasons[1]!, "Acme")).toBe("1 of 2 external members is an Acme contact")
		expect(describeReason(best!.reasons[0]!, "Acme")).toBe(
			"All 2 external members have @acme.com, Acme's domain",
		)
	})

	it("does not auto-link when another account matches by email", () => {
		const [best] = scoreChannel(
			evidence({
				origin: "connect",
				externalMembers: [member("ana@acme.com"), member("hank@gmail.com")],
			}),
			index(),
		)
		expect(best).toMatchObject({ accountId: acme, autoLink: false })
	})

	it("does not auto-link outside Connect", () => {
		const [best] = scoreChannel(evidence({ externalMembers: [member("ana@acme.com", "slack")] }), index())
		expect(best).toMatchObject({ accountId: acme, autoLink: false })
	})

	it("never counts free-mail domains", () => {
		const result = scoreChannel(evidence({ externalMembers: [member("someone@gmail.com")] }), index())
		expect(result).toEqual([])
	})

	it("explains a partial domain match", () => {
		const [best] = scoreChannel(
			evidence({
				externalMembers: [
					member("x@acme.com", "slack"),
					member("y@acme.com", "slack"),
					member("z@acme.com", "slack"),
					member(null, "slack"),
					member("w@other.dev", "slack"),
				],
			}),
			index(),
		)
		const domain = best!.reasons.find((reason) => reason.kind === "domain")!
		expect(describeReason(domain, "Acme")).toBe(
			"3 of 4 external members with a known email have @acme.com, Acme's domain",
		)
	})

	it("uses sibling links of a Slack Connect team, never of the org's own workspace", () => {
		const shared = { provider: "slack" as const, id: "T_ACME", name: null, external: true }
		const own = { provider: "slack" as const, id: "T_OWN", name: "Us", external: false }
		const links = [{ accountId: acme, workspaces: [shared, own] }]
		const [viaShared] = scoreChannel(evidence({ workspaces: [shared, own] }), index(links))
		expect(viaShared).toMatchObject({ accountId: acme, score: 75, strength: "strong" })
		expect(scoreChannel(evidence({ workspaces: [own] }), index(links))).toEqual([])
	})

	it("needs two agreeing Discord channels, and ignores a guild split between accounts", () => {
		const guild = { provider: "discord" as const, id: "G1", name: "Community", external: false }
		expect(
			scoreChannel(
				evidence({ workspaces: [guild] }),
				index([{ accountId: acme, workspaces: [guild] }]),
			),
		).toEqual([])
		const two = [
			{ accountId: acme, workspaces: [guild] },
			{ accountId: acme, workspaces: [guild] },
		]
		expect(scoreChannel(evidence({ workspaces: [guild] }), index(two))[0]).toMatchObject({
			accountId: acme,
			score: 55,
		})
		const split = [...two, { accountId: globex, workspaces: [guild] }]
		expect(scoreChannel(evidence({ workspaces: [guild] }), index(split))).toEqual([])
	})

	it("matches names: the channel's weakly, a Discord guild's more", () => {
		const [byChannel] = scoreChannel(evidence({ channelName: "ext-acme-support" }), index())
		expect(byChannel).toMatchObject({ accountId: acme, score: 30, strength: "possible" })
		const guild = { provider: "discord" as const, id: "G2", name: "Globex HQ", external: false }
		const [byGuild] = scoreChannel(evidence({ workspaces: [guild] }), index())
		expect(byGuild).toMatchObject({ accountId: globex, score: 50 })
	})

	it("skips dismissed accounts", () => {
		expect(scoreChannel(evidence({ channelName: "acme" }), index(), new Set([acme]))).toEqual([])
	})
})

describe("normalizeName", () => {
	it("drops punctuation and company suffixes", () => {
		expect(normalizeName("Acme, Inc.")).toBe("acme")
		expect(normalizeName("The Big Bird Labs GmbH")).toBe("bigbirdlabs")
	})
})

describe("describeReason", () => {
	it("says the count is of known emails when some members have none", () => {
		const reason = { kind: "domain" as const, domain: "acme.com", matched: 2, total: 2, members: 5 }
		expect(describeReason(reason, "Acme")).toBe(
			"2 of 2 external members with a known email have @acme.com, Acme's domain",
		)
		expect(describeReason({ ...reason, members: 2 }, "Acme")).toBe(
			"All 2 external members have @acme.com, Acme's domain",
		)
	})

	it("words one contact in the singular, and reasons stored without a member count", () => {
		expect(
			describeReason({ kind: "contacts", matched: 1, total: 3, sample: ["a@acme.com"] }, "Acme"),
		).toBe("1 of 3 external members is an Acme contact")
		expect(
			describeReason({ kind: "contacts", matched: 1, total: 1, members: 4, sample: [] }, "Globex"),
		).toBe("The one external member with a known email is a Globex contact")
	})
})
