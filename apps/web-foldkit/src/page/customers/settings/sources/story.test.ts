import { DEFAULT_CONNECTION_CONFIG } from "@hazel/customer-integrations"
import { EMPTY_SYNC_STATS } from "@hazel/domain/customers"
import {
	CustomerConnectionId,
	CustomerImpersonatorId,
	CustomerMetricDefinitionId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import { AppRoute } from "../../../../route"
import * as Menu from "../../../../ui/menu"
import type { Shared } from "../../../contract"
import { CustomerSourceConnect } from "../../../../overlay/modal/requests"
import { PageOutMessage } from "../../../out-message"
import { sharedDefaults } from "../../../test-shared"
import {
	DisconnectCustomerSource,
	GrantCustomerImpersonator,
	RevokeCustomerImpersonator,
	SaveCustomerSourceSettings,
	SyncCustomerSource,
} from "./commands"
import { Message } from "./message"
import { grantableMembers, isSettingsDirty, type Model } from "./model"
import type { ConnectionRow } from "./queries"
import { init, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/**
 * Update-loop tests for a source's detail: connect (the native modal), sync, disconnect, Maple
 * settings, who may impersonate.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const ada = Schema.decodeSync(UserId)(uuid(2))
const connectionId = Schema.decodeSync(CustomerConnectionId)
const NOW = Date.UTC(2026, 10, 10, 12)

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
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(3)), role: "admin" },
	nowMs: NOW,
	...sharedDefaults,
}

const connection = (
	n: number,
	fields: Partial<ConnectionRow> & Pick<ConnectionRow, "provider">,
): ConnectionRow => ({
	id: connectionId(uuid(100 + n)),
	status: "active",
	externalAccountName: null,
	config: DEFAULT_CONNECTION_CONFIG[fields.provider],
	connectedBy: ada,
	connectedAtMs: NOW - 86_400_000,
	hasWebhookSecret: false,
	lastSyncAtMs: NOW - 60_000,
	lastSuccessAtMs: NOW - 60_000,
	lastErrorAtMs: null,
	lastError: null,
	consecutiveFailures: 0,
	nextSyncAtMs: NOW + 3_600_000,
	stats: EMPTY_SYNC_STATS,
	disconnectedAtMs: null,
	...fields,
})
const clerk = connection(1, { provider: "clerk" })
const maple = connection(2, {
	provider: "maple",
	status: "error",
	lastError: { code: "auth", message: "revoked", httpStatus: 401 },
	config: { ...DEFAULT_CONNECTION_CONFIG.maple, activityEvents: ["query_run"] },
})
const stripe = connection(3, { provider: "stripe", status: "disconnected", disconnectedAtMs: NOW - 1_000 })

const clerkRoute = AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "clerk" })
const pageUpdate = (current: Model, next: Message) => update(current, next, shared)

const loaded = (route: Parameters<typeof init>[0] = clerkRoute): Model =>
	pageUpdate(init(route).model, Message.UpdatedConnections({ connections: [clerk, maple, stripe] })).model

describe("data sources: connect", () => {
	test("Connect and Reconnect open the native modal with the connection's config", () => {
		const detail = loaded(AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "stripe" }))
		expect(pageUpdate(detail, Message.PressedConnect({ provider: "stripe" })).outMessage).toEqual(
			PageOutMessage.RequestedModal({
				modal: CustomerSourceConnect.make({
					provider: "stripe",
					reconnectId: null,
					config: stripe.config,
				}),
			}),
		)
		expect(pageUpdate(detail, Message.PressedReconnect({ connectionId: maple.id })).outMessage).toEqual(
			PageOutMessage.RequestedModal({
				modal: CustomerSourceConnect.make({
					provider: "maple",
					reconnectId: maple.id,
					config: maple.config,
				}),
			}),
		)
	})
})

describe("data sources: sync and disconnect", () => {
	test("Sync now schedules a run once; a failure toasts", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedSyncNow({ connectionId: clerk.id })),
			Command.expectHas(SyncCustomerSource({ organizationId, connectionId: clerk.id })),
			model((current) => expect(current.syncing).toEqual([clerk.id])),
			Command.resolve(
				SyncCustomerSource,
				Message.FailedSyncNow({ connectionId: clerk.id, reason: "ComingSoon" }),
			),
			model((current) => expect(current.syncing).toEqual([])),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "The Clerk integration is coming soon",
						description: "Hazel can't sync from it yet.",
					},
				}),
			),
		)
	})

	test("Disconnect asks first, then disconnects", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedDisconnect()),
			model((current) => expect(current.disconnectModal.isOpen).toBe(true)),
			message(Message.ConfirmedDisconnect({ connectionId: clerk.id })),
			Command.expectHas(
				DisconnectCustomerSource({ organizationId, connectionId: clerk.id, provider: "clerk" }),
			),
			Command.resolve(DisconnectCustomerSource, Message.SucceededDisconnect({ provider: "clerk" })),
			model((current) => {
				expect(current.disconnectModal.isOpen).toBe(false)
				expect(current.isDisconnecting).toBe(false)
			}),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Clerk disconnected",
						description: "Its data stays, marked stale.",
					},
				}),
			),
		)
	})
})

describe("data sources: Maple settings", () => {
	const detail = () => loaded(AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "maple" }))

	test("edits build the update payload; the draft clears once the row syncs", () => {
		story(
			pageUpdate,
			given(detail()),
			message(Message.ChangedSettingsListInput({ key: "activityEvents", value: " trace_explored " })),
			message(Message.AddedSettingsListItem({ key: "activityEvents" })),
			message(Message.RemovedSettingsListItem({ key: "activityEvents", item: "query_run" })),
			message(Message.AddedSettingsRow({ key: "metricMappings" })),
			message(
				Message.ChangedSettingsCell({
					key: "metricMappings",
					index: 0,
					column: "event",
					value: "dashboard_created ",
				}),
			),
			message(
				Message.ChangedSettingsCell({
					key: "metricMappings",
					index: 0,
					column: "metricKey",
					value: "dashboards_created",
				}),
			),
			message(Message.ChangedConfigText({ key: "region", value: "eu" })),
			// The config's schema refuses a region of its own: the field keeps what it had.
			message(Message.ChangedConfigText({ key: "region", value: "apac" })),
			message(Message.ClickedSettingsNumber({ key: "lookbackDays", value: 180 })),
			model((current) => expect(current.settingsListInputs.activityEvents).toBe("")),
			message(Message.PressedSaveSettings()),
			Command.expectHas(
				SaveCustomerSourceSettings({
					organizationId,
					connectionId: maple.id,
					config: {
						...maple.config,
						_tag: "maple",
						region: "eu",
						activityEvents: ["trace_explored"],
						metricMappings: [{ event: "dashboard_created", metricKey: "dashboards_created" }],
						lookbackDays: 180,
					},
				}),
			),
			Command.resolve(SaveCustomerSourceSettings, Message.SucceededSaveSettings()),
			model((current) => {
				expect(current.isSavingSettings).toBe(false)
				expect(current.settingsDraft).not.toBeNull()
			}),
		)
		const saved = pageUpdate(
			detail(),
			Message.ClickedSettingsNumber({ key: "lookbackDays", value: 30 }),
		).model
		const synced = pageUpdate(
			saved,
			Message.UpdatedConnections({
				connections: [clerk, { ...maple, config: saved.settingsDraft ?? maple.config }, stripe],
			}),
		).model
		expect(synced.settingsDraft).toBeNull()
	})

	test("an empty metric row blocks the save; Discard drops the draft", () => {
		const draft = pageUpdate(detail(), Message.AddedSettingsRow({ key: "metricMappings" })).model
		expect(isSettingsDirty(draft, maple)).toBe(true)
		expect(pageUpdate(draft, Message.PressedSaveSettings()).commands ?? []).toHaveLength(0)
		const discarded = pageUpdate(draft, Message.PressedDiscardSettings()).model
		expect(discarded.settingsDraft).toBeNull()
	})

	test("a field value that does not fit the config is ignored", () => {
		const next = pageUpdate(
			detail(),
			Message.ToggledConfigField({ key: "region", isSelected: true }),
		).model
		expect(next.settingsDraft).toEqual(maple.config)
	})
})

describe("data sources: usage units", () => {
	const traces = {
		id: Schema.decodeSync(CustomerMetricDefinitionId)(uuid(200)),
		key: "autumn.traces",
		name: "Traces",
		provider: "autumn" as const,
		unit: null,
		customUnit: "GB",
	}
	const withMetrics = () => pageUpdate(loaded(), Message.UpdatedUnitMetrics({ metrics: [traces] })).model
	/** What submitting `value` sends: each Command's name and args. */
	const submit = (value: string) => {
		const result = pageUpdate(
			pageUpdate(withMetrics(), Message.ChangedUnit({ metricKey: traces.key, value })).model,
			Message.SubmittedUnit({ metricKey: traces.key }),
		)
		expect(result.model.unitDrafts).toEqual({})
		return (result.commands ?? []).map((command) => [command.name, command.args])
	}
	const saves = (unit: string | null) => [
		["SaveMetricUnit", { organizationId, metricId: traces.id, metricKey: traces.key, unit }],
	]

	test("Enter or blur saves the trimmed unit, blank clears it, the same one sends nothing", () => {
		expect(submit(" MB ")).toEqual(saves("MB"))
		expect(submit("  ")).toEqual(saves(null))
		expect(submit("GB")).toEqual([])
		// A blur after Enter finds no draft.
		expect(
			pageUpdate(withMetrics(), Message.SubmittedUnit({ metricKey: traces.key })).commands ?? [],
		).toEqual([])
	})
})

describe("data sources: impersonation", () => {
	const grace = Schema.decodeSync(UserId)(uuid(4))
	const members = [
		{ id: ada, name: "Ada Lovelace", email: "ada@hazel.test", avatarUrl: null },
		{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
	]
	const graceGrant = {
		id: Schema.decodeSync(CustomerImpersonatorId)(uuid(300)),
		userId: grace,
		grantedBy: ada,
		grantedAtMs: NOW - 86_400_000,
	}
	const clerkDetail = () =>
		pageUpdate(
			loaded(AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "clerk" })),
			Message.UpdatedMembers({ members }),
		).model
	const withGrace = () =>
		pageUpdate(clerkDetail(), Message.UpdatedImpersonators({ impersonators: [graceGrant] })).model
	const menu = (message: Menu.Message) => Message.GotImpersonatorMenuMessage({ message })

	test("Add member offers those without a grant and grants the picked one", () => {
		expect(grantableMembers(withGrace()).map((member) => member.id)).toEqual([ada])
		const opened = pageUpdate(clerkDetail(), menu(Menu.Message.PressedTrigger({ pointerType: "mouse" })))
		const picked = pageUpdate(
			opened.model,
			menu(Menu.Message.ClickedItem({ key: grace, entries: [Menu.item(ada), Menu.item(grace)] })),
		)
		expect(
			picked.commands?.find((command) => command.name === "GrantCustomerImpersonator")?.args,
		).toEqual(GrantCustomerImpersonator({ organizationId, userId: grace, grantedBy: ada }).args)
		// Its Remove waits for the answer: a revoke could reach the server before the grant.
		expect(picked.model.pendingGrants).toEqual([grace])
		expect(
			pageUpdate(picked.model, Message.SucceededImpersonatorAction({ userId: grace })).model
				.pendingGrants,
		).toEqual([])
	})

	test("a grant answers quietly; a failed one says so", () => {
		story(
			pageUpdate,
			given(clerkDetail()),
			message(Message.SucceededImpersonatorAction({ userId: grace })),
			model((current) => expect(current.impersonators).toEqual([])),
			message(Message.FailedImpersonatorAction({ userId: grace, reason: "NotMember" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Couldn't let them impersonate",
						description: "They are no longer a member of this organization.",
					},
				}),
			),
		)
	})

	test("Remove revokes the member's grant; a failure toasts", () => {
		story(
			pageUpdate,
			given(withGrace()),
			message(Message.PressedRevokeImpersonator({ userId: grace })),
			Command.expectHas(
				RevokeCustomerImpersonator({ organizationId, impersonatorId: graceGrant.id, userId: grace }),
			),
			Command.resolve(
				RevokeCustomerImpersonator,
				Message.FailedImpersonatorAction({ userId: grace, reason: "Offline" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			),
			// The page never patches its rows: the optimistic delete and its rollback arrive as synced rows.
			model((current) => expect(current.impersonators).toEqual([graceGrant])),
		)
		expect(
			pageUpdate(clerkDetail(), Message.PressedRevokeImpersonator({ userId: grace })).commands ?? [],
		).toEqual([])
	})
})
