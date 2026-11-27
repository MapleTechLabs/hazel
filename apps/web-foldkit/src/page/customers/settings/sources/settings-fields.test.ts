import {
	DEFAULT_CONNECTION_CONFIG,
	integrationOf,
	type SettingsField,
	type SettingsFields,
} from "@hazel/customer-integrations"
import { EMPTY_SYNC_STATS } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { AppRoute } from "../../../../route"
import type { Shared } from "../../../contract"
import { sharedDefaults } from "../../../test-shared"
import { Message } from "./message"
import { type Model, settingsProblemOf } from "./model"
import type { ConnectionRow } from "./queries"
import { init, update } from "./update"

/** The settings form holds any number of fields of each kind, each edited by its own config key. */

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** A second field of each kind, beside the ones the integration declares. */
const SECOND_OF_EACH: SettingsFields = {
	secondList: {
		key: "otherEvents",
		title: "Other events",
		description: "",
		emptyText: "",
		placeholder: "",
		addLabel: "Add another",
	},
	secondRows: {
		key: "otherMappings",
		title: "Other mappings",
		description: "",
		emptyText: "",
		columns: [
			{ key: "event", label: "Event", placeholder: "" },
			{ key: "metricKey", label: "Key", placeholder: "" },
		],
		itemNoun: "row",
		note: "",
		incompleteProblem: "otherMappings has a blank cell",
	},
	secondNumber: {
		key: "otherDays",
		title: "Other days",
		description: "",
		ariaLabel: "Other days",
		options: [{ value: 30, label: "30d" }],
		unit: "days",
	},
}

const declared: Record<string, SettingsField> = integrationOf("maple")?.presentation.settings ?? {}
beforeAll(() => {
	Object.assign(declared, SECOND_OF_EACH)
})
afterAll(() => {
	for (const name of Object.keys(SECOND_OF_EACH)) delete declared[name]
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const userId = Schema.decodeSync(UserId)(uuid(2))
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: userId,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: {
		id: Schema.decodeSync(OrganizationId)(uuid(1)),
		name: "Hazel",
		slug: "hazel",
		logoUrl: null,
	},
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(3)), role: "admin" },
	nowMs: 0,
	...sharedDefaults,
}

const connection: ConnectionRow = {
	id: Schema.decodeSync(CustomerConnectionId)(uuid(100)),
	provider: "maple",
	status: "active",
	externalAccountName: null,
	config: DEFAULT_CONNECTION_CONFIG.maple,
	connectedBy: userId,
	connectedAtMs: 0,
	hasWebhookSecret: false,
	lastSyncAtMs: 0,
	lastSuccessAtMs: 0,
	lastErrorAtMs: null,
	lastError: null,
	consecutiveFailures: 0,
	nextSyncAtMs: null,
	stats: EMPTY_SYNC_STATS,
	disconnectedAtMs: null,
}

const route = AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "maple" })
const run = (messages: ReadonlyArray<Message>): Model =>
	messages.reduce(
		(current, next) => update(current, next, shared).model,
		update(init(route).model, Message.UpdatedConnections({ connections: [connection] }), shared).model,
	)
const addItem = (key: string, value: string) => [
	Message.ChangedSettingsListInput({ key, value }),
	Message.AddedSettingsListItem({ key }),
]
const addRow = (key: string, event: string, metricKey: string) => [
	Message.AddedSettingsRow({ key }),
	Message.ChangedSettingsCell({ key, index: 0, column: "event", value: event }),
	Message.ChangedSettingsCell({ key, index: 0, column: "metricKey", value: metricKey }),
]

describe("settings with several fields of each kind", () => {
	test("each field edits its own key, and the save trims them all", () => {
		const draft = run([
			...addItem("activityEvents", " one "),
			...addItem("otherEvents", " two "),
			...addRow("metricMappings", " a ", "b"),
			...addRow("otherMappings", "c", " d "),
			Message.ClickedSettingsNumber({ key: "lookbackDays", value: 30 }),
			Message.ClickedSettingsNumber({ key: "otherDays", value: 30 }),
		])
		const [save] = update(draft, Message.PressedSaveSettings(), shared).commands ?? []
		expect(save?.args).toMatchObject({
			config: {
				activityEvents: ["one"],
				otherEvents: ["two"],
				metricMappings: [{ event: "a", metricKey: "b" }],
				otherMappings: [{ event: "c", metricKey: "d" }],
				lookbackDays: 30,
				otherDays: 30,
			},
		})
	})

	test("what is typed in one list's field stays out of the other's", () => {
		const typed = run([Message.ChangedSettingsListInput({ key: "otherEvents", value: "draft" })])
		expect(typed.settingsListInputs).toEqual({ otherEvents: "draft" })
		const added = update(typed, Message.AddedSettingsListItem({ key: "activityEvents" }), shared).model
		expect(added.settingsDraft).toBeNull()
	})

	test("a blank cell in any key-value list blocks the save with that list's problem", () => {
		const draft = run([Message.AddedSettingsRow({ key: "otherMappings" })])
		expect(draft.settingsDraft && settingsProblemOf(draft.settingsDraft)).toBe(
			"otherMappings has a blank cell",
		)
	})
})
