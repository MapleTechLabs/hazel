/**
 * `POST /webhooks/customers/:provider/:organizationId/:connectionId`: what reaches the org's
 * customers object (a known org, a body under the cap) and how the route answers otherwise.
 */
import { Database } from "@hazel/db"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Exit, Layer, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { describe, expect, it } from "vitest"
import { Directory } from "../services/directory"
import { exitCodec } from "../worker/objects/calls"
import { CustomersWebhookCall, CustomerWebhookFailedError } from "../worker/objects/customers/jobs"
import { ObjectStubs } from "../worker/objects/protocol"
import { handleCustomersWebhook } from "./customers-webhooks.http"

const orgId = crypto.randomUUID() as OrganizationId
const connectionId = crypto.randomUUID()

type Answer = Exit.Exit<{ readonly applied: number }, CustomerWebhookFailedError> | "unreachable"

const build = (options: {
	readonly org?: "live" | "deleted" | "unknown" | "down"
	readonly answer?: Answer
}) => {
	const woken: Array<string> = []
	const directory = Layer.succeed(Directory, {
		org: () =>
			options.org === "down"
				? Effect.fail(
						new Database.DatabaseError({
							type: "connection_error",
							message: "D1 down",
							cause: null,
						}),
					)
				: Effect.succeed(
						options.org === "unknown"
							? Option.none()
							: Option.some({ deletedAt: options.org === "deleted" ? new Date() : null }),
					),
	} as never)
	const encode = Schema.encodeSync(exitCodec(CustomersWebhookCall) as never)
	const stubs = Layer.succeed(ObjectStubs, {
		get: (target) =>
			({
				call: () => {
					woken.push(target.id)
					const answer = options.answer ?? Exit.succeed({ applied: 2 })
					return answer === "unreachable"
						? Effect.fail("reset")
						: Effect.succeed({ exit: encode(answer as never) })
				},
			}) as never,
	})
	const services = Layer.mergeAll(directory, stubs)
	const send = (path: string, init: RequestInit = {}) =>
		Effect.runPromise(
			handleCustomersWebhook.pipe(
				Effect.provideService(
					HttpServerRequest.HttpServerRequest,
					HttpServerRequest.fromWeb(
						new Request(`http://api.test${path}`, { method: "POST", body: "{}", ...init }),
					),
				),
				Effect.provide(services),
				Effect.map((response) => HttpServerResponse.toWeb(response)),
			),
		)
	return { send, woken }
}

const path = `/webhooks/customers/stripe/${orgId}/${connectionId}`

describe("POST /webhooks/customers", () => {
	it("answers 404 for a bad path, or an unknown or deleted org, without waking anything", async () => {
		const unknown = build({ org: "unknown" })
		expect((await unknown.send(`/webhooks/customers/nope/${orgId}/${connectionId}`)).status).toBe(404)
		expect((await unknown.send(`/webhooks/customers/stripe/not-a-uuid/${connectionId}`)).status).toBe(404)
		expect((await unknown.send(path)).status).toBe(404)
		const deleted = build({ org: "deleted" })
		expect((await deleted.send(path)).status).toBe(404)
		expect([...unknown.woken, ...deleted.woken]).toEqual([])
	})

	it("refuses a body over 1 MB, whatever its content-length says", async () => {
		const route = build({ org: "live" })
		const big = "x".repeat(1_000_001)
		expect((await route.send(path, { body: big })).status).toBe(413)
		// A streamed body has no content-length: counted while reading.
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(big))
				controller.close()
			},
		})
		expect((await route.send(path, { body: stream, duplex: "half" } as RequestInit)).status).toBe(413)
		expect(route.woken).toEqual([])
	})

	it("answers 400 for an unreadable body", async () => {
		const route = build({ org: "live" })
		const stream = new ReadableStream({
			start(controller) {
				controller.error(new Error("reset"))
			},
		})
		expect((await route.send(path, { body: stream, duplex: "half" } as RequestInit)).status).toBe(400)
	})

	it("passes the object's answer through, and 503 when it or the directory is unreachable", async () => {
		const applied = await build({ org: "live" }).send(path)
		expect(applied.status).toBe(200)
		expect(await applied.json()).toEqual({ received: true, applied: 2 })

		const refused = await build({
			org: "live",
			answer: Exit.fail(new CustomerWebhookFailedError({ status: 400, message: "Bad signature" })),
		}).send(path)
		expect([refused.status, await refused.text()]).toEqual([400, "Bad signature"])

		expect((await build({ org: "live", answer: "unreachable" }).send(path)).status).toBe(503)
		expect((await build({ org: "down" }).send(path)).status).toBe(503)
	})
})
