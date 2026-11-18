import type { UserId } from "@hazel/schema"
import { Effect, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { describe, expect, it } from "vitest"
import { createActorToken } from "./impersonate"

const actorUserId = "00000000-0000-4000-8000-000000000001" as UserId

/** Answers every request with `status`/`body`, recording what was sent. */
const fakeClient = (status: number, body: unknown) => {
	const sent: Array<{ url: string; auth: string; body: unknown }> = []
	const client = HttpClient.make((request, url) =>
		Effect.sync(() => {
			const raw = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
			sent.push({
				url: url.toString(),
				auth: request.headers["authorization"] ?? "",
				body: JSON.parse(raw),
			})
			return HttpClientResponse.fromWeb(request, Response.json(body, { status }))
		}),
	)
	return { client, sent }
}

const create = (status: number, body: unknown) => {
	const fake = fakeClient(status, body)
	return Effect.runPromise(
		createActorToken(fake.client, Redacted.make("sk_test_1"), {
			clerkUserId: "user_1",
			actorUserId,
		}).pipe(
			Effect.result,
			Effect.map((result) => ({ result, sent: fake.sent })),
		),
	)
}

describe("Clerk actor tokens", () => {
	it("asks for a one-minute token acted by the Hazel member, and answers its url", async () => {
		const { result, sent } = await create(200, {
			id: "act_1",
			object: "actor_token",
			url: "https://clerk.acme.dev/v1/tickets/accept?ticket=t",
			status: "pending",
		})
		expect(result).toMatchObject({ _tag: "Success", success: { id: "act_1" } })
		expect(sent).toEqual([
			{
				url: "https://api.clerk.com/v1/actor_tokens",
				auth: "Bearer sk_test_1",
				body: { user_id: "user_1", actor: { sub: actorUserId }, expires_in_seconds: 60 },
			},
		])
	})

	it("tells impersonation switched off in Clerk from Clerk's other refusals", async () => {
		const disabled = await create(403, {
			errors: [{ code: "feature_not_enabled", message: "not enabled" }],
		})
		expect(disabled.result).toMatchObject({ _tag: "Failure", failure: { reason: "disabled" } })
		const refused = await create(402, {
			errors: [
				{ code: "quota", message: "limit", long_message: "Monthly impersonation limit reached" },
			],
		})
		expect(refused.result).toMatchObject({
			_tag: "Failure",
			failure: { reason: "provider", message: "Clerk: Monthly impersonation limit reached" },
		})
	})
})
