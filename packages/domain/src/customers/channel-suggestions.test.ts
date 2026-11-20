import type { ChannelId, CustomerAccountId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import {
	buildSuggestionIndex,
	type ChannelEvidence,
	describeReason,
	MAX_EVIDENCE_MEMBERS,
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

	it("never auto-links on a sample of the members", () => {
		const guests = [member("ana@acme.com"), member("cy@acme.com")]
		const whole = evidence({ origin: "connect", externalMembers: guests, externalMemberCount: 2 })
		expect(scoreChannel(whole, index())[0]).toMatchObject({ accountId: acme, autoLink: true })
		// More members than were seen: the unseen ones could be anyone's.
		const sampled = evidence({ origin: "connect", externalMembers: guests, externalMemberCount: 500 })
		expect(scoreChannel(sampled, index())[0]).toMatchObject({ accountId: acme, autoLink: false })
		// A full sample without a count is a sample too.
		const full = evidence({
			origin: "connect",
			externalMembers: Array.from({ length: MAX_EVIDENCE_MEMBERS }, (_, n) =>
				member(n === 0 ? "ana@acme.com" : `x${n}@acme.com`),
			),
		})
		expect(scoreChannel(full, index())[0]).toMatchObject({ accountId: acme, autoLink: false })
	})

	it("never suggests by name: a channel or server named after an account is not evidence", () => {
		expect(scoreChannel(evidence({ channelName: "brandon-acme" }), index())).toEqual([])
		const guild = { provider: "discord" as const, id: "G2", name: "Globex HQ", external: false }
		const team = { provider: "slack" as const, id: "T2", name: "Globex HQ", external: true }
		expect(scoreChannel(evidence({ workspaces: [guild, team] }), index())).toEqual([])
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

	it("auto-links any channel whose external members are all at the account's domain", () => {
		const slack = (...emails: ReadonlyArray<string | null>) =>
			scoreChannel(
				evidence({ origin: "slack", externalMembers: emails.map((email) => member(email, "slack")) }),
				index(),
			)[0]
		expect(slack("x@acme.com", "y@acme.com")).toMatchObject({ accountId: acme, autoLink: true })
		// Someone else in the room, or someone whose email is unknown: only suggested.
		expect(slack("x@acme.com", "w@other.dev")).toMatchObject({ accountId: acme, autoLink: false })
		expect(slack("x@acme.com", null)).toMatchObject({ accountId: acme, autoLink: false })
	})

	it("does not auto-link on a domain when another account matches, or on a sample", () => {
		// hank@gmail.com is a Globex contact: two accounts match, neither links itself.
		const rival = scoreChannel(
			evidence({ externalMembers: [member("x@acme.com", "slack"), member("hank@gmail.com", "slack")] }),
			index(),
		)
		expect(rival.map((suggestion) => suggestion.accountId).sort()).toEqual([acme, globex].sort())
		expect(rival.some((suggestion) => suggestion.autoLink)).toBe(false)
		const [sampled] = scoreChannel(
			evidence({ externalMembers: [member("x@acme.com", "slack")], externalMemberCount: 3 }),
			index(),
		)
		expect(sampled).toMatchObject({ accountId: acme, autoLink: false })
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

	it("sibling links of a Slack Connect team add to an email match, never of the org's own workspace", () => {
		const shared = { provider: "slack" as const, id: "T_ACME", name: null, external: true }
		const own = { provider: "slack" as const, id: "T_OWN", name: "Us", external: false }
		const links = [{ accountId: acme, workspaces: [shared, own] }]
		const people = [member("x@acme.com", "slack")]
		const [viaShared] = scoreChannel(
			evidence({ workspaces: [shared, own], externalMembers: people }),
			index(links),
		)
		expect(viaShared).toMatchObject({ accountId: acme, score: 96, strength: "strong" })
		expect(viaShared!.reasons.map((reason) => reason.kind)).toEqual(["domain", "workspace"])
		const [ownOnly] = scoreChannel(evidence({ workspaces: [own], externalMembers: people }), index(links))
		expect(ownOnly).toMatchObject({ score: 85 })
		expect(ownOnly!.reasons.map((reason) => reason.kind)).toEqual(["domain"])
	})

	it("sibling links alone suggest nothing", () => {
		const shared = { provider: "slack" as const, id: "T_ACME", name: null, external: true }
		const guild = { provider: "discord" as const, id: "G1", name: "Community", external: false }
		const links = [
			{ accountId: acme, workspaces: [shared, guild] },
			{ accountId: acme, workspaces: [guild] },
		]
		expect(scoreChannel(evidence({ workspaces: [shared, guild] }), index(links))).toEqual([])
	})

	it("needs two agreeing Discord channels, and ignores a guild split between accounts", () => {
		const guild = { provider: "discord" as const, id: "G1", name: "Community", external: false }
		const people = [member("x@acme.com", "discord")]
		const kinds = (links: Parameters<typeof index>[0]) =>
			scoreChannel(
				evidence({ workspaces: [guild], externalMembers: people }),
				index(links),
			)[0]!.reasons.map((reason) => reason.kind)
		expect(kinds([{ accountId: acme, workspaces: [guild] }])).toEqual(["domain"])
		const two = [
			{ accountId: acme, workspaces: [guild] },
			{ accountId: acme, workspaces: [guild] },
		]
		expect(kinds(two)).toEqual(["domain", "workspace"])
		expect(kinds([...two, { accountId: globex, workspaces: [guild] }])).toEqual(["domain"])
	})

	it("skips dismissed accounts", () => {
		expect(
			scoreChannel(evidence({ externalMembers: [member("x@acme.com")] }), index(), new Set([acme])),
		).toEqual([])
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

describe("member counts", () => {
	it("two members sharing an email are not reported as unknown emails", () => {
		const [best] = scoreChannel(
			evidence({ externalMembers: [member("x@acme.com", "slack"), member("x@acme.com", "slack")] }),
			index(),
		)
		const domain = best!.reasons.find((reason) => reason.kind === "domain")!
		expect(describeReason(domain, "Acme")).toBe("The external member has @acme.com, Acme's domain")
	})
})

describe("edge cases from review", () => {
	it("auto-links a Connect channel of exactly the cap when the count proves it is complete", () => {
		const members = Array.from({ length: 200 }, (_, i) =>
			member(i < 120 ? `p${i}@acme.com` : `q${i}@other.dev`),
		)
		const contacts = Array.from({ length: 120 }, (_, i) => ({ accountId: acme, email: `p${i}@acme.com` }))
		const full = buildSuggestionIndex({ accounts, contacts, links: [] })
		const complete = { origin: "connect" as const, externalMembers: members, externalMemberCount: 200 }
		expect(scoreChannel(evidence(complete), full)[0]).toMatchObject({ accountId: acme, autoLink: true })
		expect(scoreChannel(evidence({ ...complete, externalMemberCount: 250 }), full)[0]).toMatchObject({
			autoLink: false,
		})
	})

	it("never takes a free-mail domain written as www. or padded", () => {
		const padded = buildSuggestionIndex({
			accounts: [{ id: globex, name: "Globex", domains: [" www.Gmail.com "] }],
			contacts: [],
			links: [],
		})
		expect(scoreChannel(evidence({ externalMembers: [member("someone@gmail.com")] }), padded)).toEqual([])
	})
})

describe("auto-link denominator", () => {
	it("counts Connect guests whose email is unknown", () => {
		const result = scoreChannel(
			evidence({
				origin: "connect",
				externalMembers: [member("ana@acme.com"), member(null), member(null)],
			}),
			index(),
		)
		expect(result[0]).toMatchObject({ accountId: acme, autoLink: false })
		const half = scoreChannel(
			evidence({ origin: "connect", externalMembers: [member("ana@acme.com"), member(null)] }),
			index(),
		)
		expect(half[0]).toMatchObject({ accountId: acme, autoLink: true })
	})
})

describe("name reasons", () => {
	it("still read on rows stored before names stopped counting", () => {
		const reason = {
			kind: "name" as const,
			where: "workspace" as const,
			value: "Globex HQ",
			matchedOn: "globex",
		}
		expect(describeReason(reason, "Globex")).toBe('The workspace name "Globex HQ" contains "globex"')
	})
})
