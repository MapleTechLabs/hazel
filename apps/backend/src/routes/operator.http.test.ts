/**
 * `/internal/operator/*`: off without `OPERATOR_TOKEN`, 404 for a missing or wrong bearer, and with
 * the right one a dry run only looks up the bookmark while a restore arms it and resets the object.
 */
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { describe, expect, it } from "vitest"
import type { BookmarkRequest } from "../worker/objects/protocol"
import { ObjectStubs } from "../worker/objects/protocol"
import { OperatorRoutes, parseRestoreTarget, PITR_WINDOW_MS } from "./operator.http"

const api = "http://api.test"
const TOKEN = "operator-secret-token"
const orgId = "0b7c8f8e-4a71-4d2e-9a43-0c7c4b0f8a11"

const setup = (config: Record<string, string>) => {
	const calls: Array<string> = []
	const stubs = Layer.succeed(ObjectStubs, {
		get: (target) =>
			({
				bookmark: (request: BookmarkRequest) =>
					Effect.sync(() => {
						calls.push(`bookmark ${target.kind}:${target.id} ${request.at} ${request.apply}`)
						return { bookmark: `bm-${request.at}`, current: "bm-now" }
					}),
				reset: () =>
					Effect.suspend(() => {
						calls.push(`reset ${target.kind}:${target.id}`)
						// `ctx.abort()` fails the call that runs it.
						return Effect.fail("aborted")
					}),
			}) as never,
	})
	const web = HttpRouter.toWebHandler(
		OperatorRoutes.pipe(
			Layer.provide(stubs),
			Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
		),
		{ disableLogger: true },
	)
	const fetch = (path: string, init: RequestInit = {}) =>
		(web.handler as (request: Request) => Promise<Response>)(new Request(`${api}${path}`, init))
	return { fetch, calls }
}

const at = new Date(Date.now() - 60 * 60 * 1000).toISOString()
const restoreBody = JSON.stringify({ kind: "org", id: orgId, timestamp: at })

describe("operator endpoints", () => {
	it("are not mounted without OPERATOR_TOKEN", async () => {
		const { fetch, calls } = setup({})
		const restore = await fetch("/internal/operator/restore", {
			method: "POST",
			headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
			body: restoreBody,
		})
		expect(restore.status).toBe(404)
		const bookmark = await fetch(`/internal/operator/bookmark?kind=org&id=${orgId}&timestamp=${at}`, {
			headers: { authorization: `Bearer ${TOKEN}` },
		})
		expect(bookmark.status).toBe(404)
		expect(calls).toEqual([])
	})

	it("treat an empty OPERATOR_TOKEN as unset", async () => {
		const { fetch } = setup({ OPERATOR_TOKEN: "  " })
		const response = await fetch("/internal/operator/restore", {
			method: "POST",
			headers: { authorization: "Bearer ", "content-type": "application/json" },
			body: restoreBody,
		})
		expect(response.status).toBe(404)
	})

	it("refuse a missing or wrong token like an unknown route", async () => {
		const { fetch, calls } = setup({ OPERATOR_TOKEN: TOKEN })
		for (const authorization of [undefined, "Bearer wrong", `Basic ${TOKEN}`, `Bearer ${TOKEN}x`]) {
			const headers = new Headers({ "content-type": "application/json" })
			if (authorization !== undefined) headers.set("authorization", authorization)
			const restore = await fetch("/internal/operator/restore", {
				method: "POST",
				headers,
				body: restoreBody,
			})
			expect(restore.status).toBe(404)
			const bookmark = await fetch(`/internal/operator/bookmark?kind=org&id=${orgId}&timestamp=${at}`, {
				headers,
			})
			expect(bookmark.status).toBe(404)
		}
		expect(calls).toEqual([])
	})

	it("look up a bookmark without arming it on a dry run", async () => {
		const { fetch, calls } = setup({ OPERATOR_TOKEN: TOKEN })
		const response = await fetch(`/internal/operator/bookmark?kind=org&id=${orgId}&timestamp=${at}`, {
			headers: { authorization: `Bearer ${TOKEN}` },
		})
		expect(response.status).toBe(200)
		const ms = Date.parse(at)
		expect(await response.json()).toEqual({
			kind: "org",
			id: orgId,
			at,
			bookmark: `bm-${ms}`,
			current: "bm-now",
			applied: false,
		})
		expect(calls).toEqual([`bookmark org:${orgId} ${ms} false`])
	})

	it("arm the restore and reset the object", async () => {
		const { fetch, calls } = setup({ OPERATOR_TOKEN: TOKEN })
		const response = await fetch("/internal/operator/restore", {
			method: "POST",
			headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
			body: restoreBody,
		})
		expect(response.status).toBe(200)
		const ms = Date.parse(at)
		expect(await response.json()).toMatchObject({
			bookmark: `bm-${ms}`,
			current: "bm-now",
			applied: true,
		})
		expect(calls).toEqual([`bookmark org:${orgId} ${ms} true`, `reset org:${orgId}`])
	})

	it("refuse an invalid target", async () => {
		const { fetch, calls } = setup({ OPERATOR_TOKEN: TOKEN })
		for (const body of [
			{ kind: "directory", id: orgId, timestamp: at },
			{ kind: "org", id: "not-an-id", timestamp: at },
			{ kind: "org", id: orgId, timestamp: "yesterday" },
			{ kind: "org", id: orgId },
		]) {
			const response = await fetch("/internal/operator/restore", {
				method: "POST",
				headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
				body: JSON.stringify(body),
			})
			expect(response.status).toBe(400)
		}
		expect(calls).toEqual([])
	})
})

describe("parseRestoreTarget", () => {
	const now = Date.parse("2026-11-23T12:00:00.000Z")
	it("accepts ISO times and epoch milliseconds inside the window", () => {
		expect(
			parseRestoreTarget(
				{ kind: "channel", id: orgId.toUpperCase(), timestamp: "2026-11-22T12:00:00Z" },
				now,
			),
		).toEqual({
			_tag: "Ok",
			target: { kind: "channel", id: orgId, at: Date.parse("2026-11-22T12:00:00Z") },
		})
		expect(
			parseRestoreTarget({ kind: "user", id: orgId, timestamp: String(now - 1000) }, now),
		).toMatchObject({
			_tag: "Ok",
			target: { at: now - 1000 },
		})
	})

	it("refuses times in the future or past the 30-day window", () => {
		expect(parseRestoreTarget({ kind: "org", id: orgId, timestamp: now + 60_000 }, now)._tag).toBe(
			"Invalid",
		)
		expect(
			parseRestoreTarget({ kind: "org", id: orgId, timestamp: now - PITR_WINDOW_MS - 1 }, now)._tag,
		).toBe("Invalid")
	})
})
