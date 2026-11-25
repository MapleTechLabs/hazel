import { ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Effect, Layer } from "effect"
import { describe, expect, test } from "vitest"
import { HazelRpc } from "../../../rpc"
import { ResetOverride } from "./command"

const organizationId = OrganizationId.make("00000000-0000-4000-8000-0000000000a1")
const sectionId = ChannelSectionId.make("00000000-0000-4000-8000-0000000000a3")

/** The RPC client, answering every call with `answer` and keeping what was sent. */
const rpcAnswering = (answer: Effect.Effect<unknown, unknown>) => {
	const calls: Array<[string, unknown]> = []
	const layer = Layer.succeed(HazelRpc, ((name: string, payload: unknown) =>
		Effect.suspend(() => {
			calls.push([name, payload])
			return answer
		})) as never)
	return { calls, layer }
}

const resetSection = (layer: Layer.Layer<HazelRpc>) =>
	Effect.runPromise(
		// SAFETY: a command's effect needs only the services it yields, here the RPC client.
		(
			ResetOverride({
				organizationId,
				override: {
					_tag: "Section",
					sectionId,
					name: "Projects",
					level: "all",
					isMuted: false,
					mutedUntilMs: null,
				},
			}).effect as Effect.Effect<unknown, never, HazelRpc>
		).pipe(Effect.provide(layer)),
	)

// The channel branch writes through the synced channel-member collection; its payload is
// `channelResetOf`, tested in `overrides.test.ts`.
describe("ResetOverride for a section", () => {
	test("drops the section's own settings", async () => {
		const { calls, layer } = rpcAnswering(Effect.void)
		expect(await resetSection(layer)).toMatchObject({ _tag: "CompletedResetOverride", isSuccess: true })
		expect(calls).toEqual([
			[
				"channelMember.resetScopeNotifications",
				{ organizationId, scope: "section", scopeId: sectionId },
			],
		])
	})

	test("a refused reset says so", async () => {
		const { layer } = rpcAnswering(Effect.fail({ _tag: "UnauthorizedError", message: "no" }))
		expect(await resetSection(layer)).toMatchObject({ _tag: "CompletedResetOverride", isSuccess: false })
	})
})
