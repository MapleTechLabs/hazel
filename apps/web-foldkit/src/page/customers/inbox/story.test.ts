import { ChannelId, CustomerAccountId, CustomerIssueId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import type { IssueRow } from "../../../customers/issues"
import type { AccountRow } from "../../../customers/queries"
import { AppRoute } from "../../../route"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { sharedDefaults } from "../../test-shared"
import { UpdateInboxIssue } from "./commands"
import { Message } from "./message"
import { isNarrowed, type Model, rowIds, statusEntries, tabCounts, toggleFilter, visibleIssues } from "./model"
import { inboxKeyOf } from "./subscription"
import { init, update, viewerOf } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the Support inbox: tabs, filters, order, keys and the optimistic changes. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const grace = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(3))
const channelId = Schema.decodeSync(ChannelId)(uuid(4))
const threadId = Schema.decodeSync(ChannelId)(uuid(5))

const NOW = Date.UTC(2026, 10, 10, 12)
const HOUR = 3_600_000

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: NOW,
	...sharedDefaults,
}
const viewer = viewerOf(shared)

const acmeId = Schema.decodeSync(CustomerAccountId)(uuid(100))
const acme: AccountRow = {
	id: acmeId,
	name: "Acme Robotics",
	domain: null,
	logoUrl: null,
	ownerUserId: ada,
	lifecycleStage: "active",
	planName: "Growth",
	mrrMinor: 215_000,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	healthScore: 54,
	healthStatus: "at_risk",
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 10,
	activeUsers30d: 5,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW - 400 * 24 * HOUR,
	lastActiveAtMs: NOW - 24 * HOUR,
	customerSinceMs: NOW - 300 * 24 * HOUR,
	churnedAtMs: null,
	tags: [],
	featureFlags: {},
	primaryAccountId: null,
	environment: null,
	attentionMutedAtMs: null,
	attentionMutedUntilMs: null,
	attentionMutedByUserId: null,
}

const issue = (n: number, overrides: Partial<IssueRow>): IssueRow => ({
	id: Schema.decodeSync(CustomerIssueId)(uuid(200 + n)),
	accountId: acmeId,
	sourceChannelId: channelId,
	rootMessageId: Schema.decodeSync(MessageId)(uuid(300 + n)),
	threadChannelId: null,
	openedByUserId: Schema.decodeSync(UserId)(uuid(400 + n)),
	createdByUserId: null,
	title: `Issue ${n}`,
	status: "new",
	priority: "none",
	assigneeUserId: null,
	tags: [],
	openedAtMs: NOW - 10 * HOUR,
	firstCustomerMessageAtMs: NOW - 10 * HOUR,
	lastCustomerMessageAtMs: NOW - 10 * HOUR,
	firstTeamReplyAtMs: null,
	lastTeamReplyAtMs: null,
	lastMessageAtMs: NOW - 10 * HOUR,
	closedAtMs: null,
	reopenCount: 0,
	messageCount: 1,
	...overrides,
})

/** Waiting on us, unassigned, oldest. */
const sso = issue(1, { title: "SSO login fails", status: "waiting_on_us", lastCustomerMessageAtMs: NOW - 20 * HOUR })
/** Waiting on us, urgent, mine: sorts first. */
const outage = issue(2, { title: "Dashboard down", status: "new", priority: "urgent", assigneeUserId: ada, threadChannelId: threadId })
/** Answered, waiting on the customer. */
const billing = issue(3, { title: "Invoice question", status: "waiting_on_customer", lastMessageAtMs: NOW - HOUR })
/** Grace's: hidden by the default filter. */
const graces = issue(4, { title: "Export is slow", status: "waiting_on_us", assigneeUserId: grace })
const held = issue(5, { title: "Feature request", status: "on_hold" })
const done = issue(6, { title: "Fixed already", status: "closed", closedAtMs: NOW - 2 * HOUR })

const pageUpdate = (current: Model, next: Message) => update(current, next, shared)
const loaded = (): Model =>
	[
		Message.UpdatedAccounts({ accounts: [acme] }),
		Message.UpdatedIssues({ issues: [sso, outage, billing, graces, held, done] }),
		Message.UpdatedMembers({
			members: [
				{ id: ada, name: "Ada Lovelace", email: "ada@hazel.test", avatarUrl: null },
				{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
			],
		}),
	].reduce((current, step) => pageUpdate(current, step).model, init().model)
const key = (inboxKey: Parameters<typeof Message.PressedInboxKey>[0]["key"]) =>
	Message.PressedInboxKey({ key: inboxKey })
const titles = (current: Model) => visibleIssues(current, viewer).map((row) => row.title)

describe("support inbox: what shows", () => {
	test("Open lists mine and unassigned: waiting on us first, by priority, then longest waiting", () => {
		expect(titles(loaded())).toEqual(["Dashboard down", "SSO login fails", "Invoice question"])
		expect(tabCounts(loaded(), viewer)).toEqual({ open: 3, on_hold: 1, closed: 1 })
	})

	test("the filters narrow: anyone, waiting on us, priority", () => {
		const anyone = { ...loaded(), filters: toggleFilter(loaded().filters, "assignee:mine_or_unassigned") }
		expect(titles(anyone)).toContain("Export is slow")
		const waiting = { ...anyone, filters: toggleFilter(anyone.filters, "waitingOnUs:true") }
		expect(titles(waiting)).toEqual(["Dashboard down", "SSO login fails", "Export is slow"])
		expect(isNarrowed(waiting)).toBe(true)
		const urgent = { ...waiting, filters: toggleFilter(waiting.filters, "priority:urgent") }
		expect(titles(urgent)).toEqual(["Dashboard down"])
		const mine = { ...loaded(), filters: toggleFilter(loaded().filters, "assignee:mine") }
		expect(titles(mine)).toEqual(["Dashboard down"])
		const unassigned = { ...loaded(), filters: toggleFilter(loaded().filters, "assignee:unassigned") }
		expect(titles(unassigned)).toEqual(["SSO login fails", "Invoice question"])
	})

	test("search matches the title or the customer", () => {
		expect(titles(pageUpdate(loaded(), Message.ChangedSearch({ value: "sso" })).model)).toEqual(["SSO login fails"])
		expect(titles(pageUpdate(loaded(), Message.ChangedSearch({ value: "acme" })).model)).toHaveLength(3)
	})

	test("the tabs show on hold and closed", () => {
		expect(titles(pageUpdate(loaded(), Message.ClickedTab({ tab: "on_hold" })).model)).toEqual(["Feature request"])
		expect(titles(pageUpdate(loaded(), Message.ClickedTab({ tab: "closed" })).model)).toEqual(["Fixed already"])
	})
})

describe("support inbox: keyboard", () => {
	test("k and j walk the rows; an action key on no selection picks the first row", () => {
		const first = pageUpdate(loaded(), key("next")).model
		expect(first.selectedId).toBe(outage.id)
		expect(pageUpdate(first, key("next")).model.selectedId).toBe(sso.id)
		expect(pageUpdate(first, key("previous")).model.selectedId).toBe(outage.id)
		expect(pageUpdate(loaded(), key("status")).model.selectedId).toBe(outage.id)
	})

	test("a, s and p open their menus on the selected row", () => {
		const selected = { ...loaded(), selectedId: sso.id }
		expect(pageUpdate(selected, key("assign")).model.assignMenu.popup._tag).toBe("Open")
		expect(pageUpdate(selected, key("status")).model.statusMenu.popup._tag).toBe("Open")
		expect(pageUpdate(selected, key("priority")).model.priorityMenu.popup._tag).toBe("Open")
	})

	test("Enter opens the issue's thread, or its channel before a thread exists", () => {
		story(
			pageUpdate,
			given({ ...loaded(), selectedId: outage.id }),
			message(key("open")),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: AppRoute.ChatChannel({ orgSlug: "hazel", channelId: threadId }),
					replace: false,
				}),
			),
		)
		story(
			pageUpdate,
			given({ ...loaded(), selectedId: sso.id }),
			message(key("open")),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: AppRoute.ChatChannel({ orgSlug: "hazel", channelId }),
					replace: false,
				}),
			),
		)
	})

	test("i assigns to me at once; the row stays (mine is in the default filter)", () => {
		story(
			pageUpdate,
			given({ ...loaded(), selectedId: sso.id }),
			message(key("assignToMe")),
			model((next) => {
				expect(next.issues?.find((row) => row.id === sso.id)?.assigneeUserId).toBe(ada)
				expect(next.selectedId).toBe(sso.id)
			}),
			Command.resolve(UpdateInboxIssue, Message.SucceededIssueAction({ issueId: sso.id, action: "assign" })),
		)
	})

	test("c closes the selected issue: it leaves Open and the next row is selected", () => {
		story(
			pageUpdate,
			given({ ...loaded(), selectedId: sso.id }),
			message(key("close")),
			model((next) => {
				expect(next.issues?.find((row) => row.id === sso.id)?.status).toBe("closed")
				expect(next.selectedId).toBe(billing.id)
				expect(rowIds(next, viewer)).not.toContain(sso.id)
			}),
			Command.resolve(UpdateInboxIssue, Message.SucceededIssueAction({ issueId: sso.id, action: "status" })),
		)
	})

	test("picking a status from the menu changes it", () => {
		const opened = pageUpdate({ ...loaded(), selectedId: billing.id }, key("status")).model
		story(
			pageUpdate,
			given(opened),
			message(
				Message.GotStatusMenuMessage({
					message: Menu.Message.ClickedItem({ key: "on_hold", entries: statusEntries }),
				}),
			),
			model((next) => expect(next.issues?.find((row) => row.id === billing.id)?.status).toBe("on_hold")),
			Command.resolve(UpdateInboxIssue, Message.SucceededIssueAction({ issueId: billing.id, action: "status" })),
		)
	})

	test("a failed change toasts", () => {
		const failed = pageUpdate(
			loaded(),
			Message.FailedIssueAction({ issueId: sso.id, action: "assign", reason: "Stale" }),
		)
		expect(failed.outMessage?._tag).toBe("RequestedToast")
	})

	test("keys: letters, Enter, and nothing while typing", () => {
		const event = (keyName: string, target: EventTarget | null = null) => ({
			key: keyName,
			target,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			repeat: false,
		})
		expect(inboxKeyOf(event("s"))).toBe("status")
		expect(inboxKeyOf(event("P"))).toBe("priority")
		expect(inboxKeyOf(event("Enter"))).toBe("open")
		expect(inboxKeyOf({ ...event("a"), metaKey: true })).toBeNull()
		expect(inboxKeyOf({ ...event("c"), repeat: true })).toBeNull()
	})
})
