import { DEFAULT_CONNECTION_CONFIG, EMPTY_SYNC_STATS } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Redacted, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import { AppRoute } from "../../../../route"
import type { Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { sharedDefaults } from "../../../test-shared"
import {
	ConnectCustomerSource,
	DisconnectCustomerSource,
	SaveCustomerSourceSettings,
	SaveCustomerWebhookSecret,
	SyncCustomerSource,
} from "./commands"
import { Message } from "./message"
import { isSettingsDirty, type Model } from "./model"
import type { ConnectionRow } from "./queries"
import { init, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for Data sources: connect, webhook secret, sync, disconnect, Maple settings. */

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
	config: { ...DEFAULT_CONNECTION_CONFIG.maple, mapleOrgId: "org_1", activityEvents: ["query_run"] },
})
const stripe = connection(3, { provider: "stripe", status: "disconnected", disconnectedAtMs: NOW - 1_000 })

const overviewRoute = AppRoute.CustomersSettingsSources({ orgSlug: "hazel" })
const pageUpdate = (current: Model, next: Message) => update(current, next, shared)

const loaded = (route: Parameters<typeof init>[0] = overviewRoute): Model =>
	pageUpdate(init(route, shared).model, Message.UpdatedConnections({ connections: [clerk, maple, stripe] }))
		.model

describe("data sources: the unmatched count", () => {
	test("admins ask for it; members, whom the RPC refuses, do not", () => {
		expect((init(overviewRoute, shared).commands ?? []).map((command) => command.name)).toEqual([
			"FetchUnmatchedCount",
		])
		const member = { ...shared, member: shared.member && { ...shared.member, role: "member" as const } }
		expect(init(overviewRoute, member).commands ?? []).toEqual([])
	})
})

describe("data sources: connect", () => {
	test("Test and connect sends the key and the form's config, then shows the webhook step", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedConnect({ provider: "stripe" })),
			model((current) => {
				expect(current.connectModal.isOpen).toBe(true)
				// A disconnected source starts from its kept config.
				expect(current.connectForm?.config).toEqual(stripe.config)
			}),
			message(Message.ChangedApiKey({ value: " rk_live_1 " })),
			message(
				Message.ToggledConfigField({ target: "connect", key: "matchByDomain", isSelected: false }),
			),
			message(
				Message.ChangedConfigText({ target: "connect", key: "clerkOrgMetadataKey", value: "org_id" }),
			),
			message(Message.SubmittedConnect()),
			Command.expectHas(
				ConnectCustomerSource({
					organizationId,
					provider: "stripe",
					reconnectId: null,
					apiKey: Redacted.make("rk_live_1"),
					config: {
						_tag: "stripe",
						clerkOrgMetadataKey: "org_id",
						matchByDomain: false,
						accountId: "",
					},
				}),
			),
			Command.resolve(
				ConnectCustomerSource,
				Message.SucceededConnect({
					provider: "stripe",
					connectionId: stripe.id,
					accountName: "Northwind Inc.",
				}),
			),
			model((current) => {
				expect(current.connectForm?.connected).toEqual({
					connectionId: stripe.id,
					accountName: "Northwind Inc.",
				})
				expect(current.connectForm?.isPending).toBe(false)
			}),
			message(Message.ChangedWebhookSecret({ value: "whsec_1" })),
			message(Message.SubmittedWebhookSecret()),
			Command.expectHas(
				SaveCustomerWebhookSecret({
					organizationId,
					connectionId: stripe.id,
					webhookSecret: Redacted.make("whsec_1"),
				}),
			),
			Command.resolve(
				SaveCustomerWebhookSecret,
				Message.SucceededSaveWebhookSecret({ connectionId: stripe.id }),
			),
			model((current) => {
				expect(current.connectModal.isOpen).toBe(false)
				expect(current.connectForm).toBeNull()
			}),
		)
	})

	test("a refused key keeps the form with the failure; editing clears it", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedConnect({ provider: "stripe" })),
			message(Message.ChangedApiKey({ value: "rk_live_1" })),
			message(Message.SubmittedConnect()),
			Command.resolve(
				ConnectCustomerSource,
				Message.FailedConnect({ provider: "stripe", reason: "Refused" }),
			),
			model((current) => {
				expect(current.connectForm?.failure).toBe("Refused")
				expect(current.connectForm?.connected).toBeNull()
				expect(current.connectModal.isOpen).toBe(true)
			}),
			message(Message.ChangedApiKey({ value: "rk_live_2" })),
			model((current) => expect(current.connectForm?.failure).toBeNull()),
		)
	})

	test("a provider with no integration answers coming soon", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedConnect({ provider: "maple" })),
			message(Message.ChangedApiKey({ value: "mpl_live_1" })),
			message(Message.SubmittedConnect()),
			Command.resolve(
				ConnectCustomerSource,
				Message.FailedConnect({ provider: "maple", reason: "ComingSoon" }),
			),
			model((current) => expect(current.connectForm?.failure).toBe("ComingSoon")),
		)
	})

	test("an answer for another provider's form is dropped", () => {
		const opened = pageUpdate(loaded(), Message.PressedConnect({ provider: "autumn" })).model
		const stale = pageUpdate(
			opened,
			Message.SucceededConnect({ provider: "stripe", connectionId: stripe.id, accountName: null }),
		).model
		expect(stale.connectForm?.connected).toBeNull()
		expect(
			pageUpdate(opened, Message.FailedConnect({ provider: "stripe", reason: "Refused" })).model
				.connectForm?.failure,
		).toBeNull()
	})

	test("Reconnect rotates the failing connection's key", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedReconnect({ connectionId: maple.id })),
			message(Message.ChangedApiKey({ value: "mpl_live_2" })),
			message(Message.SubmittedConnect()),
			Command.expectHas(
				ConnectCustomerSource({
					organizationId,
					provider: "maple",
					reconnectId: maple.id,
					apiKey: Redacted.make("mpl_live_2"),
					config: maple.config,
				}),
			),
			Command.resolve(
				ConnectCustomerSource,
				Message.SucceededConnect({
					provider: "maple",
					connectionId: maple.id,
					accountName: "Northwind",
				}),
			),
			// Maple has no webhooks: Done closes.
			message(Message.SubmittedWebhookSecret()),
			model((current) => expect(current.connectForm).toBeNull()),
		)
	})

	test("an empty key sends nothing", () => {
		const opened = pageUpdate(loaded(), Message.PressedConnect({ provider: "clerk" })).model
		expect(pageUpdate(opened, Message.SubmittedConnect()).commands ?? []).toHaveLength(0)
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

	test("Sync all syncs every connection that is not disconnected", () => {
		const next = pageUpdate(loaded(), Message.PressedSyncAll())
		expect(next.model.syncing).toEqual([clerk.id, maple.id])
		expect(next.commands).toHaveLength(2)
	})

	test("Disconnect asks first, then disconnects", () => {
		story(
			pageUpdate,
			given(loaded(AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "clerk" }))),
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
			message(Message.ChangedActivityEventInput({ value: " trace_explored " })),
			message(Message.AddedActivityEvent()),
			message(Message.RemovedActivityEvent({ event: "query_run" })),
			message(Message.AddedMetricMapping()),
			message(Message.ChangedMetricMapping({ index: 0, field: "event", value: "dashboard_created " })),
			message(
				Message.ChangedMetricMapping({ index: 0, field: "metricKey", value: "dashboards_created" }),
			),
			message(Message.ChangedConfigText({ target: "settings", key: "accountKey", value: "OrgId" })),
			message(Message.ClickedLookback({ days: 180 })),
			model((current) => expect(current.activityEventInput).toBe("")),
			message(Message.PressedSaveSettings()),
			Command.expectHas(
				SaveCustomerSourceSettings({
					organizationId,
					connectionId: maple.id,
					config: {
						...maple.config,
						_tag: "maple",
						mapleOrgId: "org_1",
						activityEvents: ["trace_explored"],
						metricMappings: [{ event: "dashboard_created", metricKey: "dashboards_created" }],
						accountKey: "OrgId",
						userKey: "UserId",
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
		const saved = pageUpdate(detail(), Message.ClickedLookback({ days: 30 })).model
		const synced = pageUpdate(
			saved,
			Message.UpdatedConnections({
				connections: [clerk, { ...maple, config: saved.settingsDraft ?? maple.config }, stripe],
			}),
		).model
		expect(synced.settingsDraft).toBeNull()
	})

	test("an empty metric row blocks the save; Discard drops the draft", () => {
		const draft = pageUpdate(detail(), Message.AddedMetricMapping()).model
		expect(isSettingsDirty(draft, maple)).toBe(true)
		expect(pageUpdate(draft, Message.PressedSaveSettings()).commands ?? []).toHaveLength(0)
		const discarded = pageUpdate(draft, Message.PressedDiscardSettings()).model
		expect(discarded.settingsDraft).toBeNull()
	})

	test("a field value that does not fit the config is ignored", () => {
		const next = pageUpdate(
			detail(),
			Message.ToggledConfigField({ target: "settings", key: "accountKey", isSelected: true }),
		).model
		expect(next.settingsDraft).toEqual(maple.config)
	})
})
