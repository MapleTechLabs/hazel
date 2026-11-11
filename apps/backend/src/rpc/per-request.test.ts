/**
 * workerd binds a request's timers and async context to that request; resuming a fiber that
 * another request created runs it in the wrong I/O context. Each "request" here gets its own
 * scheduler, standing in for its I/O context, and a task scheduled on a scheduler while another
 * request is current is recorded as a violation.
 */
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { CurrentUser } from "@hazel/domain"
import { AuthMiddleware } from "@hazel/domain/rpc"
import type { UserId } from "@hazel/schema"
import { Context, Effect, Exit, Layer, Scheduler } from "effect"
import { Etag, HttpRouter } from "effect/http"
import { RpcSerialization } from "effect/rpc"
import { describe, expect, it } from "vitest"
import { InvokePrincipal } from "../worker/objects/principal"
import { makeRpcDispatcher } from "./dispatch"
import { ScopeInjectionMiddlewareLive } from "./middleware/scope-injection"
import { layerRpcHttpPerRequest } from "./per-request"
import { AllRpcs } from "./server"

let current: string | undefined
const violations: Array<string> = []

/** A scheduler owned by one request: its tasks may only be scheduled while that request runs. */
const requestScheduler = (label: string): Scheduler.Scheduler => ({
	executionMode: "async",
	shouldYield: (fiber) => fiber.currentOpCount >= 2048,
	makeDispatcher: () => {
		const tasks: Array<() => void> = []
		let timer: ReturnType<typeof setTimeout> | undefined
		const flush = () => {
			timer = undefined
			while (tasks.length > 0) tasks.shift()!()
		}
		return {
			scheduleTask: (task) => {
				if (current !== label) violations.push(`${label}'s fiber woken during ${current}`)
				tasks.push(task)
				timer ??= setTimeout(flush, 0)
			},
			flush,
		}
	},
})

const user = new CurrentUser.Schema({
	id: "00000000-0000-4000-8000-000000000001" as UserId,
	role: "member",
	email: "me@example.com",
	isOnboarded: true,
	timezone: null,
	settings: null,
})

const Handlers = Layer.mergeAll(
	AllRpcs.toLayerHandler("user.me", () => Effect.succeed(user)) as Layer.Layer<never>,
	Layer.succeed(
		AuthMiddleware,
		AuthMiddleware.of((effect) => effect as never),
	),
	ScopeInjectionMiddlewareLive,
)

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe("per-request RPC servers", () => {
	it("POST /rpc never wakes a fiber another request (or the route build) created", async () => {
		violations.length = 0
		const web = HttpRouter.toWebHandler(
			layerRpcHttpPerRequest("/rpc").pipe(
				Layer.provide(RpcSerialization.layerNdjson),
				Layer.provide(Handlers),
				// What a server built with the route graph would schedule on.
				Layer.provide(Layer.succeed(Scheduler.Scheduler, requestScheduler("build"))),
				Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layer]),
			) as Layer.Layer<never, never, HttpRouter.HttpRouter>,
			{ disableLogger: true },
		)
		try {
			for (const label of ["A", "B", "C"]) {
				current = label
				const response = await (
					web.handler as (request: Request, context: Context.Context<never>) => Promise<Response>
				)(
					new Request("http://localhost/rpc", {
						method: "POST",
						headers: { "content-type": "application/ndjson" },
						body: `${JSON.stringify({ _tag: "Request", id: "1", tag: "user.me", payload: null, headers: [] })}\n`,
					}),
					Context.make(Scheduler.Scheduler, requestScheduler(label)),
				)
				const body = await response.text()
				expect(body).toContain("me@example.com")
				// The request's scope closes after the response; its finalizers still count as it.
				await settle()
			}
		} finally {
			current = undefined
			await web.dispose()
		}
		expect(violations).toEqual([])
	})

	// Already true before; guards the objects' and the directory path's dispatcher.
	it("an in-process dispatch runs on the caller's fibers, not the dispatcher's", async () => {
		violations.length = 0
		const principal: InvokePrincipal = { user, botScopes: null }
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const handlers = yield* Layer.build(Handlers)
					const dispatcher = yield* makeRpcDispatcher.pipe(
						Effect.provideContext(handlers as never),
						Effect.provideService(Scheduler.Scheduler, requestScheduler("build")),
					)
					for (const label of ["A", "B"]) {
						current = label
						const exit = yield* dispatcher
							.dispatch("user.me", undefined, principal)
							.pipe(Effect.provideService(Scheduler.Scheduler, requestScheduler(label)))
						expect(Exit.isSuccess(exit)).toBe(true)
						yield* Effect.promise(settle)
					}
					current = undefined
				}),
			),
		)
		expect(violations).toEqual([])
	})
})
