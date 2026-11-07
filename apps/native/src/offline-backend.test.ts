import { describe, expect, it } from "vitest"

import { makeFixtureServer } from "./fixture/fixture-socket"
import { designChannelId, orgId, snapshotFor } from "./fixture/snapshot"
import { makeOfflineFetch } from "./offline-backend"
import { currentUser } from "./offline-session"

const backendUrl = "http://offline.hazel.test"

const callRpc = (fetch: typeof globalThis.fetch, tag: string, payload: unknown) =>
	fetch(`${backendUrl}/rpc`, {
		method: "POST",
		body: `${JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })}\n`,
	}).then((response) => response.text())

const rowsOf = (tables: Record<string, ReadonlyArray<unknown>> | undefined, table: string) =>
	(tables?.[table] ?? []).filter(
		(row): row is Record<string, unknown> => typeof row === "object" && row !== null,
	)

describe("makeOfflineFetch", () => {
	it("clears a read channel's notifications and keeps them cleared for a reconnecting client", async () => {
		const server = makeFixtureServer()
		const fetch = makeOfflineFetch({ backendUrl, user: currentUser, server })
		const notificationsFor = () =>
			rowsOf(
				server.withWrites("user", currentUser.id, snapshotFor("user", currentUser.id) ?? {}),
				"notifications",
			).filter((row) => row.targetedResourceId === designChannelId)
		const designMember = () =>
			rowsOf(server.withWrites("org", orgId, snapshotFor("org", orgId) ?? {}), "channel_members").find(
				(row) => row.channelId === designChannelId && row.userId === currentUser.id,
			)
		expect(notificationsFor()).toHaveLength(3)
		expect(designMember()?.notificationCount).toBe(3)

		const answer = await callRpc(fetch, "channelMember.clearNotifications", {
			channelId: designChannelId,
		})

		expect(answer).toContain('"_tag":"Success"')
		expect(notificationsFor()).toEqual([])
		expect(designMember()?.notificationCount).toBe(0)
	})

	it("sends nothing to a URL outside the backend", async () => {
		const fetch = makeOfflineFetch({ backendUrl, user: currentUser })
		const response = await fetch("http://offline.hazel.test.evil.example/auth/token")
		expect(response.status).toBe(404)
	})
})
