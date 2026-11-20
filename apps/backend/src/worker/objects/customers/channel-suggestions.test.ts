/**
 * Suggested channel links (`docs/customers/channels.md`): the `OrgObject` answers each channel's
 * evidence, the `CustomersObject` scores it and keeps `customer_channel_suggestions`, links the
 * clear Connect matches by itself (once: never after an unlink), and answers suggestions only for
 * channels the caller sees.
 */
import type { OrganizationId } from "@hazel/schema"
import { Cause, Effect, Exit, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { orgTarget } from "../kinds"
import { channelEvidence } from "../org/channel-evidence"
import { applySuggestions, refreshSuggestions } from "./channel-suggestions"
import { runCompute } from "./compute"
import { makeCustomersWorld, ok, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const OWN_TEAM = "T0HAZEL01"
const GLOBEX_TEAM = "T0GLOBEX01"

interface SuggestionRow {
	readonly id: string
	readonly channelId: string
	readonly accountId: string
	readonly score: number
	readonly status: string
	readonly decidedBy: string | null
	readonly reasons: string
}

const setup = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	const orgId = world.orgId as OrganizationId
	yield* world.ingest("clerk", [
		{ _tag: "account", externalId: "org_acme", name: "Acme", sameAs: [], onNoMatch: "create" },
		{ _tag: "account", externalId: "org_globex", name: "Globex", sameAs: [], onNoMatch: "create" },
	])
	const accountId = (name: string) =>
		world.rows<{ id: string }>(`SELECT id FROM customer_accounts WHERE name = ?`, name)[0]!.id
	world.rows(`UPDATE customer_accounts SET domains = '["acme.com"]' WHERE name = 'Acme'`)
	world.rows(`UPDATE customer_accounts SET domains = '["globex.com"]' WHERE name = 'Globex'`)
	const contact = (account: string, email: string) =>
		world.object.storage.db
			.prepare(`INSERT INTO customer_contacts (id, accountId, email) VALUES (?, ?, ?)`)
			.run(uuid(), accountId(account), email)

	const org = yield* world.objects.get(orgTarget(orgId))
	const exec = (query: string, ...params: Array<string | number | null>) =>
		org.storage.db.prepare(query).run(...params)
	const channel = (name: string, seenBy: ReadonlyArray<string>, type = "public") => {
		const id = uuid()
		exec(
			`INSERT INTO channels (id, name, type, organizationId) VALUES (?, ?, ?, ?)`,
			id,
			name,
			type,
			orgId,
		)
		for (const userId of seenBy) {
			exec(
				`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`,
				userId,
				id,
				orgId,
			)
		}
		return id
	}
	/** A Connect share of `channelId` hosted here, with guests from another org. */
	const connect = (channelId: string, guestEmails: ReadonlyArray<string>) => {
		const conversationId = uuid()
		const guestOrg = uuid()
		exec(
			`INSERT INTO connect_conversation_channels (conversationId, organizationId, channelId, role) VALUES (?, ?, ?, 'host')`,
			conversationId,
			orgId,
			channelId,
		)
		for (const email of guestEmails) {
			const userId = uuid()
			exec(
				`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'Guest', 'User')`,
				userId,
				`ext-${userId}`,
				email,
			)
			exec(
				`INSERT INTO connect_participants (conversationId, channelId, userId, homeOrganizationId, isExternal) VALUES (?, ?, ?, ?, 1)`,
				conversationId,
				uuid(),
				userId,
				guestOrg,
			)
		}
	}
	const connection = uuid()
	exec(
		`INSERT INTO chat_sync_connections (id, organizationId, provider, externalWorkspaceId, externalWorkspaceName, createdBy)
		 VALUES (?, ?, 'slack', ?, 'Hazel HQ', ?)`,
		connection,
		orgId,
		OWN_TEAM,
		world.owner,
	)
	/** A Slack-mirrored channel with authors: `[team, email]`. */
	const slack = (channelId: string, authors: ReadonlyArray<readonly [string, string | null]>) => {
		exec(
			`INSERT INTO chat_sync_channel_links (syncConnectionId, hazelChannelId, externalChannelId) VALUES (?, ?, ?)`,
			connection,
			channelId,
			`C${channelId.slice(0, 8)}`,
		)
		authors.forEach(([team, email], index) =>
			exec(
				`INSERT INTO chat_sync_channel_authors (hazelChannelId, provider, externalUserId, externalWorkspaceId, email)
				 VALUES (?, 'slack', ?, ?, ?)`,
				channelId,
				`U${index}${channelId.slice(0, 6)}`,
				team,
				email,
			),
		)
	}
	const refresh = (channelIds?: ReadonlyArray<string>) =>
		world.object.run(refreshSuggestions(orgId, channelIds as never)).pipe(Effect.orDie)
	const suggestions = (channelId?: string) =>
		world.rows<SuggestionRow>(
			channelId === undefined
				? `SELECT * FROM customer_channel_suggestions ORDER BY score DESC`
				: `SELECT * FROM customer_channel_suggestions WHERE channelId = ? ORDER BY score DESC`,
			...(channelId === undefined ? [] : [channelId]),
		)
	const links = () =>
		world.rows<{
			channelId: string
			accountId: string
			linkedBy: string | null
			deletedAt: string | null
		}>(`SELECT channelId, accountId, linkedBy, deletedAt FROM customer_channel_links ORDER BY createdAt`)
	const projected = () =>
		org.storage.db.prepare(`SELECT channelId, accountName FROM channel_customers`).all() as Array<{
			channelId: string
			accountName: string
		}>
	const list = (payload: Record<string, unknown>, user = world.member) =>
		world.call("customers.channel.suggestions", payload, user)
	const evidence = (channelIds?: ReadonlyArray<string>) =>
		org
			.run(
				channelEvidence(
					channelIds === undefined
						? { organizationId: orgId }
						: { organizationId: orgId, channelIds: channelIds as never },
				),
			)
			.pipe(Effect.orDie)
	const events = (type: string) =>
		world
			.rows<{ data: string }>(`SELECT data FROM customer_events WHERE type = ?`, type)
			.map((row) => row.data)
	return {
		evidence,
		events,
		world,
		orgId,
		org,
		accountId,
		contact,
		channel,
		connect,
		slack,
		refresh,
		suggestions,
		links,
		projected,
		list,
	}
})

describe("Suggested channel links", () => {
	it("links a Connect channel of contacts by itself, and never again after an unlink", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				t.contact("Acme", "ana@acme.com")
				// Stored with a tab and a newline around it: still the same address.
				t.contact("Acme", "\tBen@Acme.com\n")
				const shared = t.channel("shared-ops", [t.world.member])
				t.connect(shared, ["ana@acme.com", "ben@acme.com"])

				const result = yield* t.refresh()
				expect(result.autoLinked).toBe(1)
				expect(t.links()).toEqual([
					{ channelId: shared, accountId: t.accountId("Acme"), linkedBy: null, deletedAt: null },
				])
				const [suggestion] = t.suggestions(shared)
				expect(suggestion).toMatchObject({ status: "accepted", decidedBy: null })
				const [event] = t.world.rows<{ title: string; data: string; actorUserId: string | null }>(
					`SELECT title, data, actorUserId FROM customer_events WHERE type = 'channel.linked'`,
				)
				expect(event?.title).toBe("Channel linked automatically")
				expect(event?.actorUserId).toBeNull()
				// SAFETY: the auto-link event's data is written by `autoLink` with these fields.
				const data = JSON.parse(event?.data ?? "{}") as { automatic: boolean; reasons: unknown }
				expect(data.automatic).toBe(true)
				expect(data.reasons).toContainEqual({ kind: "contacts", matched: 2, total: 2 })
				yield* t.world.object.alarm.pipe(Effect.orDie)
				expect(t.projected()).toEqual([{ channelId: shared, accountName: "Acme" }])

				// Someone unlinks it: it stays manual, whatever the next refreshes find.
				expect(
					tagOf(
						yield* t.world.call(
							"customers.channel.unlink",
							{ channelId: shared },
							t.world.member,
						),
					),
				).toBe("Success")
				yield* t.refresh()
				yield* t.world.object.run(runCompute(new Date())).pipe(Effect.orDie)
				expect(t.links().filter((link) => link.deletedAt === null)).toEqual([])
				expect(t.suggestions(shared).filter((row) => row.status === "open")).toEqual([])
			}),
		))

	it("never auto-links a channel that was linked before", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				t.contact("Acme", "ana@acme.com")
				const shared = t.channel("shared", [t.world.member])
				t.connect(shared, ["ana@acme.com"])
				yield* t.world.call(
					"customers.channel.link",
					{ accountId: t.accountId("Globex"), channelId: shared },
					t.world.member,
				)
				yield* t.world.call("customers.channel.unlink", { channelId: shared }, t.world.member)
				const result = yield* t.refresh()
				expect(result.autoLinked).toBe(0)
				expect(t.suggestions(shared)).toMatchObject([
					{ accountId: t.accountId("Acme"), status: "open" },
				])
			}),
		))

	it("suggests a Slack channel from its Slack Connect authors' domain, without linking it", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const mirrored = t.channel("ext-partners", [t.world.member])
				t.slack(mirrored, [
					[GLOBEX_TEAM, "gina@globex.com"],
					[GLOBEX_TEAM, "gus@globex.com"],
					[OWN_TEAM, "me@hazel.example"],
				])
				const result = yield* t.refresh()
				expect(result.autoLinked).toBe(0)
				expect(t.links()).toEqual([])
				const rows = t.suggestions(mirrored)
				expect(rows).toHaveLength(1)
				expect(rows[0]).toMatchObject({ accountId: t.accountId("Globex"), status: "open" })
				expect(JSON.parse(rows[0]!.reasons)).toEqual([
					{ kind: "domain", domain: "globex.com", matched: 2, total: 2, members: 2 },
				])

				const listed = ok(yield* t.list({}))
				expect(listed.items).toMatchObject([
					{ channelId: mirrored, accountName: "Globex", strength: "strong", score: rows[0]!.score },
				])
				// Filtered by account: another customer has none.
				expect(ok(yield* t.list({ accountId: t.accountId("Acme") })).items).toEqual([])
			}),
		))

	it("remembers a dismissal across refreshes", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const mirrored = t.channel("partners", [t.world.member])
				t.slack(mirrored, [[GLOBEX_TEAM, "gina@globex.com"]])
				yield* t.refresh()
				const [row] = t.suggestions(mirrored)
				const dismissed = yield* t.world.call(
					"customers.channel.suggestion.dismiss",
					{ suggestionId: row!.id },
					t.world.member,
				)
				expect(tagOf(dismissed)).toBe("Success")
				yield* t.refresh()
				yield* t.refresh([mirrored])
				expect(t.suggestions(mirrored)).toMatchObject([
					{ id: row!.id, status: "dismissed", decidedBy: t.world.member },
				])
				expect(ok(yield* t.list({ channelId: mirrored })).items).toEqual([])
				// Dismissed is not open any more.
				const again = yield* t.world.call(
					"customers.channel.suggestion.dismiss",
					{ suggestionId: row!.id },
					t.world.member,
				)
				expect(tagOf(again)).toBe("CustomersNotFoundError")
			}),
		))

	it("accepting links the channel and marks the suggestion accepted", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const mirrored = t.channel("partners", [t.world.member])
				t.slack(mirrored, [[GLOBEX_TEAM, "gina@globex.com"]])
				// The suggestions read scores a channel it names.
				const listed = ok(yield* t.list({ channelId: mirrored }))
				expect(listed.items).toHaveLength(1)
				const accepted = yield* t.world.call(
					"customers.channel.suggestion.accept",
					{ suggestionId: listed.items[0].id },
					t.world.member,
				)
				expect(ok(accepted).data).toMatchObject({
					channelId: mirrored,
					accountId: t.accountId("Globex"),
					linkedBy: t.world.member,
				})
				expect(t.suggestions(mirrored)).toMatchObject([
					{ status: "accepted", decidedBy: t.world.member },
				])
				expect(ok(yield* t.list({})).items).toEqual([])
			}),
		))

	it("hides suggestions for channels the caller cannot see", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const secret = t.channel("globex-private", [t.world.owner], "private")
				t.slack(secret, [[GLOBEX_TEAM, "gina@globex.com"]])
				yield* t.refresh()
				const [row] = t.suggestions(secret)
				expect(row?.status).toBe("open")
				expect(ok(yield* t.list({})).items).toEqual([])
				expect(tagOf(yield* t.list({ channelId: secret }))).toBe("CustomersNotFoundError")
				for (const tag of [
					"customers.channel.suggestion.accept",
					"customers.channel.suggestion.dismiss",
				]) {
					const exit = yield* t.world.call(tag as never, { suggestionId: row!.id }, t.world.member)
					expect([tag, tagOf(exit)]).toEqual([tag, "CustomersNotFoundError"])
					// Named by the suggestion, never by the private channel behind it.
					const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined
					expect(error?._tag === "Some" ? error.value : undefined).toMatchObject({
						entity: "suggestion",
						id: row!.id,
					})
				}
				expect(t.suggestions(secret)).toMatchObject([{ status: "open" }])
				expect(ok(yield* t.list({}, t.world.owner)).items).toHaveLength(1)
			}),
		))

	it("a manual link accepts that pair and drops the channel's other open suggestions", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const mixed = t.channel("vendors", [t.world.member])
				t.slack(mixed, [
					[GLOBEX_TEAM, "gina@globex.com"],
					["T0ACME0001", "ana@acme.com"],
				])
				yield* t.refresh()
				expect(t.suggestions(mixed).map((row) => row.status)).toEqual(["open", "open"])
				yield* t.world.call(
					"customers.channel.link",
					{ accountId: t.accountId("Acme"), channelId: mixed },
					t.world.member,
				)
				expect(t.suggestions(mixed)).toMatchObject([
					{ accountId: t.accountId("Acme"), status: "accepted", decidedBy: t.world.member },
				])
				yield* t.refresh()
				expect(t.suggestions(mixed)).toHaveLength(1)
			}),
		))

	it("refreshes at the end of every compute", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const mirrored = t.channel("globex", [t.world.member])
				t.slack(mirrored, [[GLOBEX_TEAM, "gina@globex.com"]])
				yield* t.world.object.run(runCompute(new Date())).pipe(Effect.orDie)
				expect(t.suggestions(mirrored)).toMatchObject([
					{ accountId: t.accountId("Globex"), status: "open" },
				])
			}),
		))

	it("answers each channel's origin, workspaces and external members", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const plain = t.channel("general", [])
				const shared = t.channel("shared", [])
				const mirrored = t.channel("mirrored", [])
				t.channel("a-thread", [], "thread")
				t.connect(shared, ["Ana@Acme.com"])
				t.slack(mirrored, [
					[GLOBEX_TEAM, "gina@globex.com"],
					[GLOBEX_TEAM, null],
					[OWN_TEAM, "me@hazel.example"],
				])
				const evidence = yield* t.org
					.run(channelEvidence({ organizationId: t.orgId }))
					.pipe(Effect.orDie)
				const byId = new Map(evidence.map((entry) => [entry.channelId as string, entry]))
				expect(evidence).toHaveLength(3)
				expect(byId.get(plain)).toMatchObject({
					origin: "hazel",
					workspaces: [],
					externalMembers: [],
				})
				expect(byId.get(shared)).toMatchObject({
					origin: "connect",
					workspaces: [],
					externalMembers: [{ source: "connect", email: "ana@acme.com" }],
				})
				const slack = byId.get(mirrored)!
				expect(slack.origin).toBe("slack")
				expect(slack.workspaces).toEqual([
					{ provider: "slack", id: OWN_TEAM, name: "Hazel HQ", external: false },
					{ provider: "slack", id: GLOBEX_TEAM, name: null, external: true },
				])
				expect(
					[...slack.externalMembers].sort((a, b) => String(a.email).localeCompare(String(b.email))),
				).toEqual([
					{ source: "slack", email: "gina@globex.com" },
					{ source: "slack", email: null },
				])
				// Only the listed channels.
				const one = yield* t.org
					.run(channelEvidence({ organizationId: t.orgId, channelIds: [plain as never] }))
					.pipe(Effect.orDie)
				expect(one.map((entry) => entry.channelId)).toEqual([plain])
			}),
		))

	it("keeps channel and workspace names, and contact emails, out of the events", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				t.contact("Acme", "ana@acme.com")
				// The channel name names the account (a `name` reason), and is private.
				const secret = t.channel("acme-merger-talks", [t.world.member], "private")
				t.connect(secret, ["ana@acme.com"])
				yield* t.refresh()
				expect(t.links()).toHaveLength(1)
				// SAFETY: `reasons` is the JSON array of `SuggestionReason` the refresh wrote.
				const reasons = JSON.parse(t.suggestions(secret)[0]?.reasons ?? "[]") as Array<{
					kind: string
				}>
				expect(reasons.map((reason) => reason.kind)).toContain("name")

				const mirrored = t.channel("globex-war-room", [t.world.member], "private")
				t.slack(mirrored, [[GLOBEX_TEAM, "gina@globex.com"]])
				const [suggestion] = ok(yield* t.list({ channelId: mirrored })).items
				expect(suggestion?.reasons.map((reason: { kind: string }) => reason.kind)).toContain("name")
				ok(
					yield* t.world.call(
						"customers.channel.suggestion.accept",
						{ suggestionId: suggestion!.id },
						t.world.member,
					),
				)

				const all = t.events("channel.linked").join("\n")
				expect(t.events("channel.linked")).toHaveLength(2)
				for (const text of [
					"merger",
					"acme-merger-talks",
					"war-room",
					"ana@acme.com",
					"gina@globex.com",
					"matchedOn",
				]) {
					expect([text, all.includes(text)]).toEqual([text, false])
				}
			}),
		))

	it("does not act on evidence a link or a dismissal made stale while the org was asked", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				t.contact("Acme", "ana@acme.com")
				const linkedMeanwhile = t.channel("shared-a", [t.world.member])
				const dismissedMeanwhile = t.channel("shared-b", [t.world.member])
				t.connect(linkedMeanwhile, ["ana@acme.com"])
				t.connect(dismissedMeanwhile, ["ana@acme.com"])
				// A first refresh before the dismissal: the second channel has an open suggestion to dismiss.
				// Its auto-link is stopped by a link made by hand first.
				yield* t.world.call(
					"customers.channel.link",
					{ accountId: t.accountId("Globex"), channelId: dismissedMeanwhile },
					t.world.member,
				)
				yield* t.world.call(
					"customers.channel.unlink",
					{ channelId: dismissedMeanwhile },
					t.world.member,
				)
				yield* t.refresh([dismissedMeanwhile])
				const [open] = t.suggestions(dismissedMeanwhile)
				expect(open?.status).toBe("open")

				// The evidence is asked for; then, before the transaction, a link and a dismissal land.
				const stale = yield* t.evidence()
				yield* t.world.call(
					"customers.channel.link",
					{ accountId: t.accountId("Globex"), channelId: linkedMeanwhile },
					t.world.member,
				)
				ok(
					yield* t.world.call(
						"customers.channel.suggestion.dismiss",
						{ suggestionId: open!.id },
						t.world.member,
					),
				)
				const result = yield* t.world.object
					.run(applySuggestions(t.orgId, stale, undefined))
					.pipe(Effect.orDie)
				expect(result.autoLinked).toBe(0)
				expect(t.links().filter((link) => link.deletedAt === null)).toEqual([
					{
						channelId: linkedMeanwhile,
						accountId: t.accountId("Globex"),
						linkedBy: t.world.member,
						deletedAt: null,
					},
				])
				expect(t.suggestions(linkedMeanwhile)).toEqual([])
				expect(t.suggestions(dismissedMeanwhile)).toMatchObject([
					{ id: open!.id, status: "dismissed" },
				])
			}),
		))

	it("leaves a channel to a refresh that asked the org later", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				t.contact("Acme", "ana@acme.com")
				const shared = t.channel("shared", [t.world.member])
				const stale = yield* t.evidence()
				const asked = new Date(Date.now() - 60_000)
				// A later refresh wrote the channel before this one applies; no contact matched then.
				t.world.rows(
					`INSERT INTO customer_channel_suggestions (id, organizationId, channelId, accountId, score) VALUES (?, ?, ?, ?, 40)`,
					uuid(),
					t.orgId,
					shared,
					t.accountId("Globex"),
				)
				t.connect(shared, ["ana@acme.com"])
				const late = yield* t.evidence()
				expect(stale.find((entry) => entry.channelId === shared)?.externalMembers).toEqual([])
				const result = yield* t.world.object
					.run(applySuggestions(t.orgId, late, undefined, asked))
					.pipe(Effect.orDie)
				expect(result.autoLinked).toBe(0)
				expect(t.links()).toEqual([])
				expect(t.suggestions(shared)).toMatchObject([{ accountId: t.accountId("Globex"), score: 40 }])
			}),
		))

	it("keeps a dismissal after the account joins another's group", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const mirrored = t.channel("partners", [t.world.member])
				t.slack(mirrored, [[GLOBEX_TEAM, "gina@globex.com"]])
				yield* t.refresh()
				const [row] = t.suggestions(mirrored)
				ok(
					yield* t.world.call(
						"customers.channel.suggestion.dismiss",
						{ suggestionId: row!.id },
						t.world.member,
					),
				)
				// Globex becomes an environment of Acme: the customer is Acme, with Globex's domain.
				ok(
					yield* t.world.call(
						"customers.account.link",
						{ accountId: t.accountId("Globex"), primaryAccountId: t.accountId("Acme") },
						t.world.owner,
					),
				)
				yield* t.refresh()
				expect(t.suggestions(mirrored).filter((r) => r.status === "open")).toEqual([])
				expect(ok(yield* t.list({})).items).toEqual([])
			}),
		))

	it("a channel-scoped refresh finds sibling channels of the same Slack Connect team", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const first = t.channel("partners-1", [t.world.member])
				t.slack(first, [[GLOBEX_TEAM, null]])
				ok(
					yield* t.world.call(
						"customers.channel.link",
						{ accountId: t.accountId("Globex"), channelId: first },
						t.world.member,
					),
				)
				// An unrelated linked channel in no shared workspace is not asked for.
				const other = t.channel("hq", [t.world.member])
				ok(
					yield* t.world.call(
						"customers.channel.link",
						{ accountId: t.accountId("Acme"), channelId: other },
						t.world.member,
					),
				)
				const second = t.channel("ops-2", [t.world.member])
				t.slack(second, [[GLOBEX_TEAM, null]])
				const listed = ok(yield* t.list({ channelId: second }))
				expect(listed.items).toMatchObject([{ accountName: "Globex" }])
				expect(listed.items[0]?.reasons).toEqual([
					{ kind: "workspace", provider: "slack", workspaceName: null, linkedChannels: 1 },
				])
			}),
		))
})
