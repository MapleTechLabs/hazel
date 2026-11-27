// @vitest-environment jsdom
import { DEFAULT_CONNECTION_CONFIG } from "@hazel/customer-integrations"
import { EMPTY_SYNC_STATS } from "@hazel/domain/customers"
import { CustomerConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, memberWithRole, pageScene, userId, uuid } from "../../../../test/pages-fixtures"
import { AppRoute } from "../../../../route"
import { Message } from "./message"
import type { ConnectionRow } from "./queries"
import { init, update } from "./update"
import { view } from "./view"

/** A source's detail through the view: admins get the controls, members a read-only page. */

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
const clerkDetail = AppRoute.CustomersSourceDetail({ orgSlug: "hazel", provider: "clerk" })
const connections = Scene.Subscription.emit(Message.UpdatedConnections({ connections: [clerk] }))

describe("read-only gating", () => {
	test("a member's source detail has no keys, settings edits or disconnect", () => {
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(init(clerkDetail).model),
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
			Scene.given(init(clerkDetail).model),
			connections,
			Scene.expect(Scene.role("button", { name: "Update keys" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Disconnect Clerk…" })).toExist(),
		)
	})
})
