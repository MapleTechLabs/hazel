// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { DEFAULT_CONNECTION_CONFIG } from "@hazel/customer-integrations"
import { EMPTY_SYNC_STATS } from "@hazel/domain/customers"
import {
	CustomerConnectionId,
	CustomerSyncRunId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate, OpenModal } from "../../../../app/requests"
import type { Session } from "../../../../app/session"
import type { ConnectionRow, SyncRunRow } from "../../../settings/sources/rows"
import { SourcesMessage, SourcesPageNoDeps, SyncCustomerSource } from "./SourcesPage"

/** The Data sources overview: coverage, connected sources with their state, the rest to connect. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = OrganizationId.make(uuid(1))
const ada = UserId.make(uuid(2))
const NOW = Date.UTC(2026, 10, 10, 12)

const session = (role: "owner" | "member" = "owner"): Session => ({
	auth: "SignedIn",
	user: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make(uuid(3)), role },
	orgSlug: "hazel",
})

const connection = (
	n: number,
	fields: Partial<ConnectionRow> & Pick<ConnectionRow, "provider">,
): ConnectionRow => ({
	id: CustomerConnectionId.make(uuid(100 + n)),
	status: "active",
	externalAccountName: null,
	config: DEFAULT_CONNECTION_CONFIG[fields.provider],
	connectedBy: ada,
	connectedAtMs: NOW - 86_400_000,
	hasWebhookSecret: true,
	lastSyncAtMs: NOW - 120_000,
	lastSuccessAtMs: NOW - 120_000,
	lastErrorAtMs: null,
	lastError: null,
	consecutiveFailures: 0,
	nextSyncAtMs: NOW + 3_600_000,
	stats: { ...EMPTY_SYNC_STATS, accounts: 412, contacts: 3180 },
	disconnectedAtMs: null,
	...fields,
})
const clerk = connection(1, { provider: "clerk" })
const maple = connection(2, {
	provider: "maple",
	status: "error",
	consecutiveFailures: 3,
	lastError: { code: "auth", message: "revoked", httpStatus: 401 },
})
const stripe = connection(3, { provider: "stripe" })
const run: SyncRunRow = {
	id: CustomerSyncRunId.make(uuid(200)),
	connectionId: stripe.id,
	trigger: "backfill",
	status: "running",
	startedAtMs: NOW - 60_000,
	finishedAtMs: null,
	progress: { step: "invoices", done: 40, total: 160 },
	stats: EMPTY_SYNC_STATS,
	error: null,
}

const CONNECTIONS = `connections:"${organizationId}"`
const RUNS = `syncRuns:"${organizationId}"`
const ACCOUNTS = `accounts:"${organizationId}"`

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
/** The first match: Clerk's card comes first. */
const first = (locator: Locator.Locator): Locator.Locator => ({
	description: `first ${locator.description}`,
	all: (root) => locator.all(root).slice(0, 1),
})
const heading = (text: string): Locator.Locator => ({
	description: `<hz:heading>${text}`,
	all: (root) =>
		Locator.all(root, Locator.tag("hz:heading")).filter((node) => Locator.textOf(node) === text),
})

const start = (role: "owner" | "member" = "owner") =>
	Scene.start(SourcesPageNoDeps, { session: session(role), nowMs: NOW, canSeedDemo: false })

const loaded = (role: "owner" | "member" = "owner") =>
	(role === "owner" ? start(role).loaded("unmatched", 3) : start(role))
		.subscription(CONNECTIONS, SourcesMessage.UpdatedConnections({ connections: [clerk, maple, stripe] }))
		.subscription(RUNS, SourcesMessage.UpdatedSyncRuns({ runs: [run] }))
		.subscription(ACCOUNTS, SourcesMessage.UpdatedAccountCount({ count: 412 }))

describe("data sources overview", () => {
	test("waits for the connections, then groups the sources", () => {
		start()
			.keepPending("unmatched")
			.expect(heading("Data sources"))
			.toExist()
			.expect(Locator.text("Loading data sources..."))
			.toExist()
		const s = loaded()
		s.expect(heading("Connected")).toExist().expect(heading("Not connected")).toExist()
		s.expect(heading("Clerk")).toExist().expect(heading("Autumn")).toExist()
		expect(s.get(byProp("badge", "label", "Sync failing")).props?.["tone"]).toBe("danger")
		expect(s.get(byProp("badge", "label", "Syncing")).props?.["tone"]).toBe("accent")
		s.expect(Locator.text("Backfill · invoices 40 of 160"))
			.toExist()
			.expect(Locator.text("25%"))
			.toExist()
		expect(s.get(byProp("progress", "label", "Syncing invoices")).props?.["value"]).toBe(0.25)
		s.expect(Locator.text("3 unmatched records")).toExist()
	})

	test("a failing source explains itself and offers Reconnect when the key was refused", () => {
		const s = loaded()
		const banner = s.get(byProp("banner", "title", "API key revoked or invalid"))
		expect(banner.props?.["tone"]).toBe("danger")
		s.fire(button("Reconnect"), "press").expectExact(
			OpenModal.make({
				modal: {
					_tag: "CustomerSourceConnect",
					provider: "maple",
					reconnectId: maple.id,
					config: maple.config,
				},
			}),
		)
	})

	test("Connect opens the connect modal with the provider's defaults", () => {
		loaded()
			.fire(button("Connect Autumn"), "press")
			.expectExact(
				OpenModal.make({
					modal: {
						_tag: "CustomerSourceConnect",
						provider: "autumn",
						reconnectId: null,
						config: DEFAULT_CONNECTION_CONFIG.autumn,
					},
				}),
			)
			.resolve(OpenModal, Component.noop)
	})

	test("Sync now runs once until it settles; Settings opens the detail", () => {
		const s = loaded()
			.fire(first(button("Sync now")), "press")
			.expectExact(SyncCustomerSource.make({ organizationId, connectionId: clerk.id, name: "Clerk" }))
		expect(s.get(first(button("Sync now"))).props?.["loading"]).toBe(true)
		s.resolve(SyncCustomerSource, SourcesMessage.SettledSyncNow({ connectionId: clerk.id }))
		expect(s.get(first(button("Sync now"))).props?.["loading"]).toBeUndefined()
		loaded()
			.fire(first(button("Settings")), "press")
			.expectExact(Navigate.make({ href: "/hazel/customers/settings/sources/clerk", replace: false }))
	})

	test("a member looks around: no sync, connect or unmatched count", () => {
		const s = start("member").subscription(
			CONNECTIONS,
			SourcesMessage.UpdatedConnections({ connections: [clerk] }),
		)
		s.expect(
			byProp(
				"banner",
				"description",
				"Only admins and owners can change data sources. You can look around.",
			),
		)
			.toExist()
			.expect(button("Sync all"))
			.toBeAbsent()
			.expect(button("Sync now"))
			.toBeAbsent()
			.expect(button("Connect Autumn"))
			.toBeAbsent()
			.expect(button("Details"))
			.toExist()
	})
})
