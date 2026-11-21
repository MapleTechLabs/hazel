/**
 * The registry of Hazel's read-only tools (`./hazel-read-tools.ts`): every tool only reads, and the
 * registry becomes an `effect/ai` toolkit whose handlers act as the member through `MemberAccess`
 * (its refusals go back to the model as the tool's failure).
 */
import { CurrentUser } from "@hazel/domain"
import type { UserId } from "@hazel/schema"
import { Effect, Option, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { Directory } from "../services/directory"
import { hazelReadTools, toAiToolkit } from "./hazel-read-tools"
import { MemberAccess } from "./member-access"

const alice = new CurrentUser.Schema({
	id: "00000000-0000-4000-8000-000000000001" as UserId,
	role: "member",
	email: "alice@example.com",
	isOnboarded: true,
	timezone: null,
	settings: null,
})

describe("Hazel's read tools", () => {
	it("lists the MCP read tools, all read-only, each with a description and an object input", () => {
		expect(hazelReadTools.map((tool) => tool.name)).toEqual([
			"list_organizations",
			"list_channels",
			"read_messages",
			"search_messages",
			"list_notifications",
			"customers_overview",
			"list_customers",
			"get_customer",
			"list_customer_signals",
			"list_customer_contacts",
			"list_customer_events",
			"list_customer_invoices",
		])
		for (const tool of hazelReadTools) {
			expect(tool.readOnly).toBe(true)
			expect(tool.description.length).toBeGreaterThan(10)
			expect(tool.inputSchema).toMatchObject({ type: "object" })
		}
	})

	it("becomes a toolkit acting as the member; a refusal is the tool's failure", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const asked: Array<string> = []
				const access = MemberAccess.of({
					call: (call) => {
						asked.push(call.name)
						return Effect.fail({
							_tag: "ChannelNotFoundError",
							message: "No access to this channel",
						}) as never
					},
					rpc: () => Effect.die("unused"),
				})
				const toolkit = yield* toAiToolkit(hazelReadTools, { user: alice }).pipe(
					Effect.provideService(MemberAccess, access),
					Effect.provideService(Directory, {
						channel: () =>
							Effect.succeed(
								Option.some({ organizationId: "o", hostChannelId: null, deletedAt: null }),
							),
					} as never),
				)
				expect(Object.keys(toolkit.tools)).toHaveLength(hazelReadTools.length)
				// SAFETY: the handlers captured their services when the toolkit was built.
				const results = yield* toolkit
					.handle("read_messages", { channel_id: "00000000-0000-4000-8000-0000000000aa" })
					.pipe(Effect.flatMap(Stream.runCollect)) as unknown as Effect.Effect<
					ReadonlyArray<unknown>,
					unknown
				>
				// One call to the channel, as the member; refused there.
				expect(asked).toHaveLength(1)
				const [result] = results
				expect(result).toMatchObject({ isFailure: true, result: "No access to this channel" })
			}),
		))
})
