import { CurrentUser } from "@hazel/domain"
import { UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { requireOrgCreationAllowed } from "./organizations"

const user = (email: string) =>
	new CurrentUser.Schema({
		id: UserId.make("00000000-0000-4000-8000-000000000001"),
		role: "member",
		email,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

/** `organization.create`'s ORG_CREATION check, as `email`, under `env`. */
const check = (env: Record<string, string>, email: string) =>
	Effect.runSync(
		requireOrgCreationAllowed.pipe(
			Effect.provideService(CurrentUser.Context, user(email)),
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
			Effect.exit,
		),
	)

describe("organization.create under ORG_CREATION", () => {
	it("lets anyone create an organization by default", () => {
		expect(Exit.isSuccess(check({}, "anyone@example.com"))).toBe(true)
		expect(Exit.isSuccess(check({ ORG_CREATION: "anyone" }, "anyone@example.com"))).toBe(true)
		expect(Exit.isSuccess(check({ ORG_CREATION: "bogus" }, "anyone@example.com"))).toBe(true)
	})

	it("lets only instance admins create one with `admins`", () => {
		const env = { ORG_CREATION: "admins", INSTANCE_ADMIN_EMAILS: "Admin@Acme.com, ops@acme.com" }
		expect(Exit.isSuccess(check(env, "admin@acme.com"))).toBe(true)
		expect(Exit.isSuccess(check(env, "OPS@acme.com"))).toBe(true)

		const refused = check(env, "member@acme.com")
		expect(refused).toMatchObject({
			_tag: "Failure",
			cause: {
				reasons: [
					{
						error: {
							_tag: "UnauthorizedError",
							message: "Only instance admins can create organizations on this Hazel instance",
						},
					},
				],
			},
		})
	})

	it("refuses everyone with `admins` and no admins listed", () => {
		expect(Exit.isFailure(check({ ORG_CREATION: "admins" }, "admin@acme.com"))).toBe(true)
	})
})
