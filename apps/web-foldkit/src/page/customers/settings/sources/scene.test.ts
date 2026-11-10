// @vitest-environment jsdom
import { DEFAULT_CONNECTION_CONFIG, EMPTY_SYNC_STATS } from "@hazel/domain/customers"
import { CustomerConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import {
	makeShared,
	memberWithRole,
	pageScene,
	portalModalMounted,
	userId,
	uuid,
} from "../../../../test/pages-fixtures"
import { AppRoute } from "../../../../route"
import { Message } from "./message"
import type { ConnectionRow } from "./queries"
import { init, update } from "./update"
import { view } from "./view"

/** Data sources through the view: admins get the controls, members a read-only page. */

const clerk: ConnectionRow = {
	id: Schema.decodeSync(CustomerConnectionId)(uuid(500)),
	provider: "clerk",
	status: "active",
	externalAccountName: "Northwind",
	config: DEFAULT_CONNECTION_CONFIG.clerk,
	connectedBy: userId,
	connectedAtMs: 0,
	hasWebhookSecret: true,
	lastSyncAtMs: 0,
	lastSuccessAtMs: 0,
	lastErrorAtMs: null,
	lastError: null,
	consecutiveFailures: 0,
	nextSyncAtMs: null,
	stats: { ...EMPTY_SYNC_STATS, accounts: 12 },
	disconnectedAtMs: null,
}

const admin = makeShared({ member: memberWithRole("admin") })
const member = makeShared({ member: memberWithRole("member") })
const overview = AppRoute.CustomersSettingsSources({ orgSlug: "hazel" })
const clerkDetail = AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "clerk" })
const connections = Scene.Subscription.emit(Message.UpdatedConnections({ connections: [clerk] }))
const readOnly = Scene.text("Only admins and owners can change data sources.", { exact: false })

describe("read-only gating", () => {
	test("an admin can sync and open settings", () => {
		Scene.scene(
			pageScene(update, view, admin),
			Scene.given(init(overview, admin).model),
			connections,
			Scene.expect(Scene.role("button", { name: "Sync all" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Sync now" })).toExist(),
			Scene.expect(Scene.role("link", { name: "Settings" })).toExist(),
			Scene.expect(readOnly).toBeAbsent(),
		)
	})

	test("a member sees the sources without the controls", () => {
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(init(overview, member).model),
			connections,
			Scene.expect(readOnly).toExist(),
			Scene.expect(Scene.role("button", { name: "Sync all" })).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Sync now" })).toBeAbsent(),
			Scene.expect(Scene.role("link", { name: "Details" })).toExist(),
		)
	})

	test("a member's source detail has no keys, settings edits or disconnect", () => {
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(init(clerkDetail, member).model),
			connections,
			Scene.expect(Scene.role("button", { name: "Update keys" })).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Disconnect Clerk…" })).toBeAbsent(),
			Scene.expect(
				Scene.role("switch", { name: "Create accounts for new organizations" }),
			).toBeDisabled(),
		)
	})

	test("an admin's source detail offers keys and disconnect", () => {
		Scene.scene(
			pageScene(update, view, admin),
			Scene.given(init(clerkDetail, admin).model),
			connections,
			Scene.expect(Scene.role("button", { name: "Update keys" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Disconnect Clerk…" })).toExist(),
		)
	})
})

describe("connect modal", () => {
	const opened = [
		Message.PressedConnect({ provider: "stripe" }),
		Message.ChangedApiKey({ value: "rk_live_1" }),
	]
	const modelAfter = (messages: ReadonlyArray<Message>) =>
		messages.reduce((current, next) => update(current, next, admin).model, init(overview, admin).model)

	test("the form lists the key's permissions and the matching options", () => {
		Scene.scene(
			pageScene(update, view, admin),
			Scene.given(modelAfter(opened)),
			portalModalMounted,
			Scene.expect(Scene.role("heading", { name: "Connect Stripe" })).toExist(),
			Scene.expect(Scene.role("list", { name: "Required permissions" })).toExist(),
			Scene.expect(Scene.role("switch", { name: "Email domain" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Test and connect" })).toExist(),
		)
	})

	test("once connected it shows the webhook URL to copy", () => {
		Scene.scene(
			pageScene(update, view, admin),
			Scene.given(
				modelAfter([
					...opened,
					Message.SucceededConnect({ connectionId: clerk.id, accountName: "Northwind Inc." }),
				]),
			),
			portalModalMounted,
			Scene.expect(Scene.text("Connection works")).toExist(),
			Scene.expect(Scene.text(`/webhooks/customers/stripe/`, { exact: false })).toExist(),
			Scene.expect(Scene.role("button", { name: "Copy" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Done" })).toExist(),
		)
	})

	test("a refused key says so and offers to test again", () => {
		Scene.scene(
			pageScene(update, view, admin),
			Scene.given(modelAfter([...opened, Message.FailedConnect({ reason: "Refused" })])),
			portalModalMounted,
			Scene.expect(Scene.text("Key was refused")).toExist(),
			Scene.expect(Scene.role("button", { name: "Test again" })).toExist(),
		)
	})
})
