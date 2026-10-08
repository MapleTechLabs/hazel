import { describe, expect, test, vi } from "vitest"
import { sharedDefaults } from "../../test-shared"
import { ClearChannelNotifications, clearNotificationsOnMount } from "./clear-notifications"
import { channelId, loadedModel, shared } from "./fixtures.test-support"

/** `ChatRouteContent`'s mount effect: once per visit, inside the loaded org layout. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const commandNames = (result: ReturnType<typeof clearNotificationsOnMount>) =>
	(result.commands ?? []).map((command) => [command.name, command.args])

describe("channelMember.clearNotifications on channel entry", () => {
	test("is sent once the signed-in org layout has loaded", () => {
		const result = clearNotificationsOnMount(loadedModel(), shared)
		expect(commandNames(result)).toEqual([[ClearChannelNotifications.name, { channelId }]])
		expect(clearNotificationsOnMount(result.model, shared).commands ?? []).toEqual([])
	})

	test("waits while auth, the user or the organization is still loading", () => {
		expect(clearNotificationsOnMount(loadedModel(), { ...shared, auth: "Loading" }).commands ?? []).toEqual([])
		expect(clearNotificationsOnMount(loadedModel(), { ...shared, currentUser: null }).commands ?? []).toEqual([])
		expect(clearNotificationsOnMount(loadedModel(), { ...sharedDefaults, ...shared, organization: null }).commands ?? []).toEqual([])
	})
})
