import { ConfigProvider, Effect, Result } from "effect"
import { describe, expect, it } from "vitest"
import { InviteMailer, renderInviteEmail } from "./invite-mailer"

describe("renderInviteEmail", () => {
	it("escapes names in the HTML and keeps the plain text readable", () => {
		const email = renderInviteEmail({
			to: "ada@hazel.test",
			organizationName: `<script>alert("x")</script> & Co`,
			inviterName: "Grace",
			acceptUrl: "https://app.hazel.sh/invite/abc",
		})
		expect(email.subject).toBe(`Grace invited you to <script>alert("x")</script> & Co on Hazel`)
		expect(email.html).not.toContain("<script>")
		expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co")
		expect(email.html).toContain('href="https://app.hazel.sh/invite/abc"')
		expect(email.text).toContain("Accept the invitation: https://app.hazel.sh/invite/abc")
	})
})

it("fails closed when the email binding is absent outside development", async () => {
	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const mailer = yield* InviteMailer
			return yield* Effect.result(
				mailer.send({
					to: "ada@hazel.test",
					organizationName: "Hazel",
					inviterName: "Grace",
					acceptUrl: "https://app.hazel.test/invite/example",
				}),
			)
		}).pipe(
			Effect.provide(InviteMailer.layerLog),
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ IS_DEV: false }))),
		),
	)
	expect(Result.isFailure(result) && result.failure._tag).toBe("InviteEmailError")
})
