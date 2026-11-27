// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { Navigate, OpenModal, ShowToast } from "../../../app/requests"
import { byProp, organizationId, session, subscriptionKey } from "../../../modals/test-support"
import { account, ada, DAY, grace, members, NOW, signal, signalId } from "../../queue/test-rows"
import {
	AssignSignal,
	AttentionMessage as M,
	AttentionPageNoDeps,
	FocusSearch,
	MuteCustomer,
	ReopenSignal,
	SnoozeSignal,
} from "./AttentionPage"

/** Needs attention (`/:org/customers/attention`): tabs, rows, the preview, actions and keys. */

const SIGNALS = subscriptionKey("signals", organizationId)
const ACCOUNTS = subscriptionKey("accounts", organizationId)
const MEMBERS = subscriptionKey("members", organizationId)
const KEYS = subscriptionKey("queueKeys", true)

const accounts = [account(1, { ownerUserId: ada }), account(2), account(3, { ownerUserId: grace })]
const signals = [
	signal(1, 2, { severity: "high" }),
	signal(2, 1),
	signal(3, 1),
	signal(4, 3),
	signal(5, 2, { status: "snoozed", snoozedUntilMs: NOW + DAY, snoozedByUserId: grace }),
	signal(6, 1, { status: "done", resolvedAtMs: NOW - DAY, outcome: "fixed", resolvedByUserId: ada }),
]

const row = (title: string) => byProp("tableRow", "title", title)
const button = (label: string) => byProp("button", "label", label)
const current = (s: { readonly all: (locator: Locator.Locator) => ReadonlyArray<Locator.Node> }) =>
	s.all(Locator.tag("hz:tableRow")).find((node) => node.props?.["current"] === true)?.props?.["title"]

const loaded = () =>
	Scene.start(AttentionPageNoDeps, { session, nowMs: NOW })
		.subscription(SIGNALS, M.UpdatedSignals({ signals }))
		.subscription(ACCOUNTS, M.UpdatedAccounts({ accounts }))
		.subscription(MEMBERS, M.UpdatedMembers({ members }))

describe("Needs attention", () => {
	test("waits for its rows, then ranks mine or unowned open signals with counts on the tabs", () => {
		const s = Scene.start(AttentionPageNoDeps, { session, nowMs: NOW })
		expect(s.get(byProp("screen", "title", "Needs attention")).props?.["subtitle"]).toBe("Loading...")
		s.subscription(SIGNALS, M.UpdatedSignals({ signals }))
			.subscription(ACCOUNTS, M.UpdatedAccounts({ accounts }))
			.expect(row("Account 2: Signal 1"))
			.toExist()
			.expect(row("Account 3: Signal 4"))
			.toBeAbsent()
		expect(s.get(Locator.tag("hz:tabBar")).props?.["tabs"]).toEqual([
			{ id: "open", label: "Open", badge: 3 },
			{ id: "snoozed", label: "Snoozed", badge: 1 },
			{ id: "done", label: "Done", badge: 1 },
		])
		expect(s.get(byProp("screen", "title", "Needs attention")).props?.["subtitle"]).toBe(
			"3 open signals on your or unowned accounts · 3 risk, 0 opportunity · $2,000 MRR with a high-severity risk",
		)
	})

	test("removing the owner chip shows every owner; a search that matches nothing offers to clear", () => {
		const s = loaded().fire(byProp("button", "label", "Mine or unowned"), "remove")
		s.expect(row("Account 3: Signal 4")).toExist()
		s.fire(Locator.tag("hz:searchField"), "change", { value: "zzz", rev: 1, edit: 0 })
			.expect(byProp("emptyState", "title", "No matches"))
			.toExist()
			.fire(button("Clear search and filters"), "press")
			.expect(row("Account 2: Signal 1"))
			.toExist()
	})

	test("j/k walk the rows; a row that leaves hands the selection to its neighbour", () => {
		const s = loaded().subscription(KEYS, M.PressedQueueKey({ key: "next" }))
		expect(current(s)).toBe("Account 2: Signal 1")
		s.subscription(KEYS, M.PressedQueueKey({ key: "next" }))
		expect(current(s)).toBe("Account 1: Signal 2")
		s.subscription(
			SIGNALS,
			M.UpdatedSignals({
				signals: signals.map((each) =>
					each.id === signalId(2) ? { ...each, status: "done" as const } : each,
				),
			}),
		)
		expect(current(s)).toBe("Account 1: Signal 3")
	})

	test("a row opens its preview with the account's detail; Escape closes it, then clears the selection", () => {
		const s = loaded().fire(row("Account 2: Signal 1"), "press")
		s.expect(button("Close preview"))
			.toExist()
			.expect(Locator.text("Signal 1 of 3"))
			.toExist()
			.loadFailed("detail", "Failed")
			.expect(button("Try again"))
			.toExist()
			.fire(button("Try again"), "press")
			.loaded("detail", {
				account: {} as never,
				refs: [],
				subscriptions: [],
				upcomingInvoice: null,
				openInvoices: [],
				activeUsersSeries: [],
				contactsToReach: [],
				recentEvents: [],
			})
			.expect(Locator.text("No contacts yet."))
			.toExist()
		s.subscription(KEYS, M.PressedQueueKey({ key: "close" }))
			.expect(button("Close preview"))
			.toBeAbsent()
		expect(current(s)).toBe("Account 2: Signal 1")
		s.subscription(KEYS, M.PressedQueueKey({ key: "close" }))
		expect(current(s)).toBeUndefined()
	})

	test("d asks the app for the done dialog; Enter opens the customer; / focuses the search", () => {
		loaded()
			.subscription(KEYS, M.PressedQueueKey({ key: "done" }))
			.expectExact(
				OpenModal.make({
					modal: {
						_tag: "MarkSignalDone",
						signalId: signalId(1),
						accountName: "Account 2",
						accountLogoUrl: null,
						title: "Signal 1",
						reason: "Reason 1",
						severity: "high",
					},
				}),
			)
			.resolve(OpenModal, Component.noop)
			.subscription(KEYS, M.PressedQueueKey({ key: "open" }))
			.expectExact(Navigate.make({ href: `/hazel/customers/${account(2).id}`, replace: false }))
			.resolve(Navigate, Component.noop)
			.subscription(KEYS, M.PressedQueueKey({ key: "search" }))
			.expectExact(FocusSearch.make({}))
			.resolve(FocusSearch, Component.noop)
	})

	test("i assigns to me; a refused write toasts why", () => {
		loaded()
			.subscription(KEYS, M.PressedQueueKey({ key: "assignToMe" }))
			.expectExact(AssignSignal.make({ organizationId, signalId: signalId(1), assigneeUserId: ada }))
			.resolve(AssignSignal, M.FailedSignalAction({ action: "assign", reason: "Stale" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Couldn't assign the signal",
						description: "Someone else acted on it first.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("the snooze menu snoozes, picks a date in a dialog, or mutes the customer", () => {
		const s = loaded().subscription(KEYS, M.PressedQueueKey({ key: "next" }))
		s.fire(byProp("menu", "label", "Snooze"), "select", { id: "tomorrow" })
			.expectExact(
				SnoozeSignal.make({
					organizationId,
					userId: ada,
					signalId: signalId(1),
					untilMs: new Date(2026, 10, 27, 9).getTime(),
				}),
			)
			.resolve(SnoozeSignal, M.SucceededSignalAction())
			.fire(byProp("menu", "label", "Snooze"), "select", { id: "pick_date" })
			.expectExact(
				OpenModal.make({
					modal: { _tag: "SnoozeSignalUntil", signalId: signalId(1), title: "Signal 1" },
				}),
			)
			.resolve(OpenModal, Component.noop)
			.fire(byProp("menu", "label", "Snooze"), "select", { id: "mute:forever" })
			.expectExact(
				MuteCustomer.make({ organizationId, userId: ada, accountId: account(2).id, untilMs: null }),
				ShowToast.make({
					toast: {
						intent: "success",
						title: "Muted Account 2 until unmuted",
						description: "Unmute it from the customer's page.",
					},
				}),
			)
			.resolve(MuteCustomer, M.SucceededSignalAction())
			.resolve(ShowToast, Component.noop)
	})

	test("the snoozed and done tabs show their own rows; done reopens", () => {
		const s = loaded().fire(Locator.tag("hz:tabBar"), "change", { id: "snoozed" })
		s.expect(row("Account 2: Signal 5")).toExist().expect(button("Wake now")).toBeAbsent()
		s.fire(Locator.tag("hz:tabBar"), "change", { id: "done" })
			.expect(row("Account 1: Signal 6"))
			.toExist()
			.subscription(KEYS, M.PressedQueueKey({ key: "reopen" }))
			.expectExact(ReopenSignal.make({ organizationId, signalId: signalId(6) }))
			.resolve(ReopenSignal, M.SucceededSignalAction())
	})

	test("nothing open says all clear and offers the snoozed tab", () => {
		Scene.start(AttentionPageNoDeps, { session, nowMs: NOW })
			.subscription(
				SIGNALS,
				M.UpdatedSignals({ signals: signals.filter((each) => each.status !== "open") }),
			)
			.subscription(ACCOUNTS, M.UpdatedAccounts({ accounts }))
			.expect(byProp("emptyState", "title", "All clear"))
			.toExist()
			.fire(button("View 1 snoozed"), "press")
			.expect(row("Account 2: Signal 5"))
			.toExist()
	})
})
