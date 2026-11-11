import {
	CustomerAccountId,
	CustomerIgnoreRuleId,
	CustomerUnmatchedRecordId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import type { AccountRow } from "../../../../customers/queries"
import { errorToast, successToast } from "../../../../data/actions"
import * as Menu from "../../../../ui/menu"
import * as Popover from "../../../../ui/popover"
import type { Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { sharedDefaults } from "../../../test-shared"
import {
	CreateAccountFromUnmatched,
	DeleteUnmatchedIgnoreRule,
	FetchUnmatchedIgnoreRules,
	FetchUnmatchedRecords,
	IgnoreUnmatchedRecord,
	LinkUnmatchedRecord,
	LinkUnmatchedRecords,
} from "./commands"
import { Message } from "./message"
import {
	groupsOf,
	highConfidenceRecords,
	type IgnoreRuleRow,
	ignorePatternsOf,
	itemsOf,
	type Model,
	type RecordRow,
	rowMenuEntries,
	sourceTabs,
	visibleRecords,
} from "./model"
import { init, initialModel, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the resolver: lists, tabs, search, and the optimistic link / create / ignore. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const recordId = Schema.decodeSync(CustomerUnmatchedRecordId)
const accountId = Schema.decodeSync(CustomerAccountId)
const NOW = Date.UTC(2026, 10, 10, 12)

const sharedAs = (role: "admin" | "member"): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: Schema.decodeSync(UserId)(uuid(2)),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(3)), role },
	nowMs: NOW,
	...sharedDefaults,
})
const admin = sharedAs("admin")

const account = (n: number, name: string, domain: string): AccountRow => ({
	id: accountId(uuid(100 + n)),
	name,
	domain,
	logoUrl: null,
	ownerUserId: null,
	lifecycleStage: "active",
	planName: null,
	mrrMinor: 0,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	healthScore: null,
	healthStatus: "unknown",
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 0,
	activeUsers30d: 0,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW,
	lastActiveAtMs: null,
	customerSinceMs: null,
	churnedAtMs: null,
	tags: [],
})
const northwind = account(1, "Northwind Labs", "northwind.io")
const acme = account(2, "Acme Robotics", "acme.com")
const brightfield = account(3, "Brightfield Analytics", "brightfield.co")
const brightline = account(4, "Brightline Media", "brightline.tv")

const record = (
	n: number,
	fields: Partial<RecordRow> & Pick<RecordRow, "provider" | "label">,
): RecordRow => ({
	id: recordId(uuid(200 + n)),
	entityType: "account",
	externalId: `ext_${n}`,
	email: null,
	domain: null,
	valueMinor: null,
	currency: null,
	eventCount30d: null,
	suggestedAccountId: null,
	confidence: null,
	reason: "No customer matches its ids or domain",
	updatedAtMs: NOW - n * 60_000,
	...fields,
})

const northwindBilling = record(1, {
	provider: "stripe",
	label: "billing@northwind.io",
	externalId: "cus_Q8f2Lk",
	email: "billing@northwind.io",
	domain: "northwind.io",
	valueMinor: 49_000,
	currency: "usd",
	suggestedAccountId: northwind.id,
	confidence: 0.92,
})
const acmeAp = record(2, {
	provider: "stripe",
	label: "ap@acmerobotics.com",
	externalId: "cus_P1x9Wd",
	valueMinor: 62_000,
	currency: "usd",
	suggestedAccountId: acme.id,
	confidence: 0.5,
})
const tally = record(3, {
	provider: "stripe",
	label: "ops@tallyhq.com",
	domain: "tallyhq.com",
	valueMinor: 5_000,
})
const stagingAcme = record(4, {
	provider: "maple",
	label: "staging-acme",
	externalId: "staging-acme",
	eventCount30d: 3_410,
	suggestedAccountId: acme.id,
	confidence: 0.35,
})
/** A user active in a known customer: the suggestion carries no score. */
const mapleUser = record(5, {
	provider: "maple",
	entityType: "contact",
	label: "user_9x",
	externalId: "user_9x",
	eventCount30d: 58,
	suggestedAccountId: brightfield.id,
})
const ignoredRecord = record(9, { provider: "maple", label: "internal-tools" })
const rule: IgnoreRuleRow = {
	id: Schema.decodeSync(CustomerIgnoreRuleId)(uuid(300)),
	provider: "maple",
	entityType: "account",
	field: "external_id",
	pattern: "internal-*",
	createdAtMs: NOW,
}

const open = [northwindBilling, acmeAp, tally, stagingAcme, mapleUser]

const loaded = (nextCursor: string | null = null): Model => ({
	...initialModel,
	open: AsyncData.Success({ data: { items: open, nextCursor } }),
	ignored: AsyncData.Success({ data: { items: [ignoredRecord], nextCursor: null } }),
	rules: AsyncData.Success({ data: [rule] }),
	openCount: open.length,
	accounts: [acme, brightfield, brightline, northwind],
})

const pageUpdate = (current: Model, next: Message) => update(current, next, admin)
const ids = (rows: ReadonlyArray<RecordRow>) => rows.map((row) => row.id)
const openIds = (current: Model) => ids(itemsOf(current.open))
const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

describe("unmatched: loading", () => {
	test("admins load the open and ignored records and the rules; members load nothing", () => {
		const opened = init(undefined, admin)
		const requests = opened.commands?.map((command) => ({ name: command.name, args: command.args }))
		expect(requests).toContainEqual({
			name: FetchUnmatchedRecords.name,
			args: { organizationId, status: "open", cursor: null },
		})
		expect(requests).toContainEqual({
			name: FetchUnmatchedRecords.name,
			args: { organizationId, status: "ignored", cursor: null },
		})
		expect(requests).toContainEqual({ name: FetchUnmatchedIgnoreRules.name, args: { organizationId } })
		expect(opened.model.open._tag).toBe("Loading")
		const member = init(undefined, sharedAs("member"))
		expect(member.commands ?? []).toEqual([])
		expect(member.model.open._tag).toBe("Idle")
	})

	test("Load more asks for the next page and appends only new rows", () => {
		const extra = record(6, { provider: "stripe", label: "extra@corp.io" })
		story(
			pageUpdate,
			given(loaded("50")),
			message(Message.PressedLoadMore({ status: "open" })),
			model((current) => expect(current.loadingMore).toBe("open")),
			Command.expectExact(FetchUnmatchedRecords({ organizationId, status: "open", cursor: "50" })),
			Command.resolve(
				FetchUnmatchedRecords,
				Message.SucceededFetchRecords({
					status: "open",
					isMore: true,
					items: [tally, extra],
					nextCursor: null,
					openCount: 6,
				}),
			),
			model((current) => {
				expect(openIds(current)).toEqual([...ids(open), extra.id])
				expect(current.openCount).toBe(6)
				expect(current.loadingMore).toBeNull()
			}),
		)
	})

	test("Load more starts earlier by the records resolved since: the cursor is an offset", () => {
		const resolved = pageUpdate(
			pageUpdate(loaded("50"), Message.PressedLinkSuggested({ recordId: northwindBilling.id })).model,
			Message.SucceededRecordAction({ recordId: northwindBilling.id, action: "link" }),
		).model
		const more = pageUpdate(resolved, Message.PressedLoadMore({ status: "open" }))
		expect(more.commands?.[0]?.args).toMatchObject({ cursor: "49" })
		expect(more.model.resolvedSincePage).toBe(0)
	})

	test("Load more while an action is in flight starts earlier by it too: rows repeat, none are skipped", () => {
		const linking = pageUpdate(
			loaded("50"),
			Message.PressedLinkSuggested({ recordId: northwindBilling.id }),
		).model
		const more = pageUpdate(linking, Message.PressedLoadMore({ status: "open" }))
		expect(more.commands?.[0]?.args).toMatchObject({ cursor: "49" })
	})

	test("the last page has no Load more", () => {
		expect(pageUpdate(loaded(), Message.PressedLoadMore({ status: "open" })).commands ?? []).toEqual([])
	})
})

describe("unmatched: what shows", () => {
	test("tabs per source, groups by source and kind", () => {
		const current = loaded()
		expect(sourceTabs(current)).toEqual([
			{ provider: "stripe", count: 3 },
			{ provider: "maple", count: 2 },
		])
		expect(groupsOf(visibleRecords(current)).map((group) => [group.provider, group.entityType])).toEqual([
			["stripe", "account"],
			["maple", "account"],
			["maple", "contact"],
		])
		const maple = pageUpdate(current, Message.ClickedTab({ tab: "maple" })).model
		expect(ids(visibleRecords(maple))).toEqual(ids([mapleUser, stagingAcme]))
		const ignored = pageUpdate(current, Message.ClickedTab({ tab: "ignored" })).model
		expect(ids(visibleRecords(ignored))).toEqual([ignoredRecord.id])
	})

	test("search matches label, email, domain and source id", () => {
		const search = (value: string) =>
			ids(visibleRecords(pageUpdate(loaded(), Message.ChangedSearch({ value })).model))
		expect(search("northwind.io")).toEqual([northwindBilling.id])
		expect(search("TALLYHQ")).toEqual([tally.id])
		expect(search("cus_P1")).toEqual([acmeAp.id])
	})

	test("sorting by value puts money first, then events", () => {
		const current = { ...loaded(), sort: "value" as const }
		expect(ids(visibleRecords(current))).toEqual(
			ids([acmeAp, northwindBilling, tally, stagingAcme, mapleUser]),
		)
	})

	test("high confidence: a score of 0.8 or more, or the account the record names", () => {
		expect(ids(highConfidenceRecords(loaded()))).toEqual(ids([northwindBilling, mapleUser]))
	})

	test("ignore patterns: the domain, and a dashed prefix but never an id prefix", () => {
		expect(ignorePatternsOf(tally)).toEqual([
			{ key: "ignore_domain", field: "domain", pattern: "tallyhq.com" },
		])
		expect(ignorePatternsOf(stagingAcme)).toEqual([
			{ key: "ignore_prefix", field: "external_id", pattern: "staging-*" },
		])
		expect(ignorePatternsOf(acmeAp)).toEqual([])
	})
})

describe("unmatched: one record", () => {
	test("Link takes the row off at once and links it to the suggestion", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedLinkSuggested({ recordId: northwindBilling.id })),
			model((current) => {
				expect(openIds(current)).not.toContain(northwindBilling.id)
				expect(current.openCount).toBe(4)
			}),
			Command.expectExact(
				LinkUnmatchedRecord({
					organizationId,
					recordId: northwindBilling.id,
					accountId: northwind.id,
				}),
			),
			Command.resolve(
				LinkUnmatchedRecord,
				Message.SucceededRecordAction({ recordId: northwindBilling.id, action: "link" }),
			),
			model((current) => {
				expect(openIds(current)).not.toContain(northwindBilling.id)
				expect(current.inFlight).toEqual([])
			}),
			expectNoOutMessage(),
		)
	})

	test("a failed link puts the row back and says why", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedLinkSuggested({ recordId: northwindBilling.id })),
			Command.resolve(
				LinkUnmatchedRecord,
				Message.FailedRecordAction({
					recordId: northwindBilling.id,
					action: "link",
					reason: "Invalid",
				}),
			),
			model((current) => {
				expect(openIds(current)).toContain(northwindBilling.id)
				expect(current.openCount).toBe(5)
				expect(current.inFlight).toEqual([])
			}),
			expectOutMessage(
				toast(
					errorToast(
						"Couldn't link billing@northwind.io",
						"The account was deleted, or the record was resolved in the meantime.",
					),
				),
			),
		)
	})

	test("Link to… links to the searched account", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(
				Message.GotLinkPopoverMessage({
					recordId: tally.id,
					message: Popover.Message.RequestedOpen(),
				}),
			),
			message(Message.ChangedLinkQuery({ value: "bright" })),
			model((current) => expect(current.linkSearch?.query).toBe("bright")),
			message(Message.SubmittedLinkQuery({ recordId: tally.id })),
			model((current) => {
				expect(current.linkSearch).toBeNull()
				expect(openIds(current)).not.toContain(tally.id)
			}),
			Command.expectExact(
				LinkUnmatchedRecord({ organizationId, recordId: tally.id, accountId: brightfield.id }),
			),
			Command.resolve(
				LinkUnmatchedRecord,
				Message.SucceededRecordAction({ recordId: tally.id, action: "link" }),
			),
		)
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PickedLinkAccount({ recordId: tally.id, accountId: brightline.id })),
			Command.expectExact(
				LinkUnmatchedRecord({ organizationId, recordId: tally.id, accountId: brightline.id }),
			),
			Command.resolve(
				LinkUnmatchedRecord,
				Message.SucceededRecordAction({ recordId: tally.id, action: "link" }),
			),
		)
	})

	test("Create makes an account from account records only", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedCreateAccount({ recordId: tally.id })),
			model((current) => expect(openIds(current)).not.toContain(tally.id)),
			Command.expectExact(CreateAccountFromUnmatched({ organizationId, recordId: tally.id })),
			Command.resolve(
				CreateAccountFromUnmatched,
				Message.SucceededRecordAction({ recordId: tally.id, action: "create" }),
			),
		)
		const contact = pageUpdate(loaded(), Message.PressedCreateAccount({ recordId: mapleUser.id }))
		expect(contact.commands ?? []).toEqual([])
		expect(openIds(contact.model)).toContain(mapleUser.id)
		expect(
			rowMenuEntries(mapleUser).some((entry) => entry._tag === "Item" && entry.item.key === "create"),
		).toBe(false)
	})

	const pick = (target: RecordRow, key: string): ReadonlyArray<Message> => [
		Message.GotRowMenuMessage({
			recordId: target.id,
			message: Menu.Message.PressedTrigger({ pointerType: "mouse" }),
		}),
		Message.GotRowMenuMessage({
			recordId: target.id,
			message: Menu.Message.ClickedItem({ key, entries: rowMenuEntries(target) }),
		}),
	]

	test("Ignore this record moves it to the ignored list", () => {
		const [openMenu, clickItem] = pick(tally, "ignore")
		story(
			pageUpdate,
			given(pageUpdate(loaded(), openMenu!).model),
			message(clickItem!),
			model((current) => {
				expect(openIds(current)).not.toContain(tally.id)
				expect(ids(itemsOf(current.ignored))).toEqual([tally.id, ignoredRecord.id])
			}),
			Command.expectHas(IgnoreUnmatchedRecord({ organizationId, recordId: tally.id, rule: null })),
			Command.resolve(
				IgnoreUnmatchedRecord,
				Message.SucceededRecordAction({ recordId: tally.id, action: "ignore" }),
			),
		)
	})

	test("Ignore all matching a pattern sends the rule", () => {
		const [openMenu, clickItem] = pick(stagingAcme, "ignore_prefix")
		story(
			pageUpdate,
			given(pageUpdate(loaded(), openMenu!).model),
			message(clickItem!),
			Command.expectHas(
				IgnoreUnmatchedRecord({
					organizationId,
					recordId: stagingAcme.id,
					rule: { field: "external_id", pattern: "staging-*" },
				}),
			),
			Command.resolve(
				IgnoreUnmatchedRecord,
				Message.FailedRecordAction({ recordId: stagingAcme.id, action: "ignore", reason: "Offline" }),
			),
			model((current) => {
				expect(openIds(current)).toContain(stagingAcme.id)
				expect(ids(itemsOf(current.ignored))).toEqual([ignoredRecord.id])
			}),
		)
	})

	test("Ignore all from a domain ignores every open record it covers, then reloads the rules", () => {
		const sameDomain = record(7, {
			provider: "stripe",
			label: "billing@tallyhq.com",
			domain: "TallyHQ.com",
		})
		const otherSource = record(8, { provider: "clerk", label: "ops@tallyhq.com", domain: "tallyhq.com" })
		const withMore: Model = {
			...loaded(),
			open: AsyncData.Success({
				data: { items: [...open, sameDomain, otherSource], nextCursor: null },
			}),
		}
		const [openMenu, clickItem] = pick(tally, "ignore_domain")
		const result = pageUpdate(pageUpdate(withMore, openMenu!).model, clickItem!)
		// One call: the server sweeps the records the rule covers, so they leave when it answers.
		expect(result.commands?.map((command) => command.name)).toEqual(["IgnoreUnmatchedRecord"])
		expect(openIds(result.model)).not.toContain(tally.id)
		expect(openIds(result.model)).toContain(sameDomain.id)
		const done = pageUpdate(
			result.model,
			// The server's answer, not a guess here: the ids it ignored, this record's included.
			Message.SucceededIgnoreWithRule({
				recordId: tally.id,
				ignoredRecordIds: [tally.id, sameDomain.id],
			}),
		)
		expect(openIds(done.model)).not.toContain(sameDomain.id)
		expect(openIds(done.model)).toContain(otherSource.id)
		expect(done.model.inFlight).toEqual([])
		expect(done.model.resolvedSincePage).toBe(2)
		expect((done.commands ?? []).map((command) => command.name)).toEqual(["FetchUnmatchedIgnoreRules"])
	})

	test("members cannot act", () => {
		const result = update(
			loaded(),
			Message.PressedLinkSuggested({ recordId: northwindBilling.id }),
			sharedAs("member"),
		)
		expect(result.commands ?? []).toEqual([])
		expect(openIds(result.model)).toEqual(ids(open))
	})
})

describe("unmatched: bulk", () => {
	test("Link N high-confidence links each to its suggestion and reports partial failures", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedLinkHighConfidence()),
			model((current) => {
				expect(openIds(current)).toEqual(ids([acmeAp, tally, stagingAcme]))
				expect(current.openCount).toBe(3)
			}),
			Command.expectExact(
				LinkUnmatchedRecords({
					organizationId,
					links: [
						{ recordId: northwindBilling.id, accountId: northwind.id },
						{ recordId: mapleUser.id, accountId: brightfield.id },
					],
				}),
			),
			Command.resolve(
				LinkUnmatchedRecords,
				Message.CompletedBulkAction({
					action: "link",
					succeeded: [northwindBilling.id],
					failed: [{ recordId: mapleUser.id, reason: "NotFound" }],
				}),
			),
			model((current) => {
				expect(openIds(current)).toEqual(ids([acmeAp, tally, stagingAcme, mapleUser]))
				expect(current.openCount).toBe(4)
				expect(current.inFlight).toEqual([])
			}),
			expectOutMessage(
				toast(
					errorToast(
						"Couldn't link 1 of 2 records",
						"They're back in the list. Try them one at a time.",
					),
				),
			),
		)
	})

	test("selected rows: Link links only those with a suggestion", () => {
		const selected = [tally, acmeAp].reduce(
			(current, row) =>
				pageUpdate(current, Message.ToggledRecord({ recordId: row.id, isSelected: true })).model,
			loaded(),
		)
		story(
			pageUpdate,
			given(selected),
			message(Message.PressedLinkSelected()),
			model((current) => {
				expect(openIds(current)).toContain(tally.id)
				expect(current.selected).toEqual([tally.id])
			}),
			Command.expectExact(
				LinkUnmatchedRecords({
					organizationId,
					links: [{ recordId: acmeAp.id, accountId: acme.id }],
				}),
			),
			Command.resolve(
				LinkUnmatchedRecords,
				Message.CompletedBulkAction({ action: "link", succeeded: [acmeAp.id], failed: [] }),
			),
			expectOutMessage(toast(successToast("Linked 1 record"))),
		)
	})

	test("select all takes the tab's visible rows", () => {
		const maple = pageUpdate(loaded(), Message.ClickedTab({ tab: "maple" })).model
		expect(pageUpdate(maple, Message.ToggledAllRecords({ isSelected: true })).model.selected).toEqual(
			ids([mapleUser, stagingAcme]),
		)
	})
})

describe("unmatched: ignore rules", () => {
	test("deleting a rule removes it at once and restores it on failure", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedDeleteRule({ ruleId: rule.id })),
			model((current) => expect(current.rules).toEqual(AsyncData.Success({ data: [] }))),
			Command.expectExact(DeleteUnmatchedIgnoreRule({ organizationId, ruleId: rule.id })),
			Command.resolve(
				DeleteUnmatchedIgnoreRule,
				Message.FailedDeleteRule({ ruleId: rule.id, reason: "Offline" }),
			),
			model((current) => {
				expect(current.rules).toEqual(AsyncData.Success({ data: [rule] }))
				expect(current.deletedRules).toEqual([])
			}),
		)
	})
})
