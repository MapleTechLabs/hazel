// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Story } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { OrganizationId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { Reload } from "../../app/requests"
import type { Session } from "../../app/session"
import { ReadRootRemembered, RedirectFromRoot, RootMessage, RootPage } from "./RootPage"

/** `/`: where the app goes once it knows the user, the remembered page and the memberships. */

const hazel = { organizationId: OrganizationId.make("00000001-0000-4000-8000-000000000001"), slug: "hazel" }
const acme = { organizationId: OrganizationId.make("00000001-0000-4000-8000-000000000002"), slug: "acme" }

const session = (isOnboarded = true): Session => ({
	auth: "SignedIn",
	user: {
		id: UserId.make("00000002-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded,
	},
	organization: null,
	member: null,
	orgSlug: null,
})

const start = (isOnboarded = true) =>
	Effect.gen(function* () {
		const s = yield* Story.make(RootPage, { session: session(isOnboarded), isMobile: false })
		s.expectExact(ReadRootRemembered)
		return s
	})

const remembered = (returnTo: string | null, lastOrganizationId: OrganizationId | null) =>
	RootMessage.ReadRemembered({ returnTo, lastOrganizationId })

const redirect = (overrides: Partial<Parameters<typeof RedirectFromRoot.make>[0]> = {}) =>
	RedirectFromRoot.make({
		returnTo: null,
		isOnboarded: true,
		membership: hazel,
		isMobile: false,
		...overrides,
	})

describe("root page", () => {
	it.effect("without a remembered page it goes to the user's organization", () =>
		Effect.gen(function* () {
			const s = yield* start()
			s.resolve(ReadRootRemembered, remembered(null, null))
				.expectNone()
				.send(RootMessage.UpdatedMemberships({ memberships: [hazel, acme] }))
				.expectExact(redirect())
				.resolve(RedirectFromRoot, Component.noop)
				// Later emissions change nothing: the page is leaving.
				.send(RootMessage.UpdatedMemberships({ memberships: [acme] }))
				.expectNone()
		}),
	)

	it.effect("goes back to the organization last opened on this device", () =>
		Effect.gen(function* () {
			const s = yield* start()
			s.resolve(ReadRootRemembered, remembered(null, acme.organizationId))
				.send(RootMessage.UpdatedMemberships({ memberships: [hazel, acme] }))
				.expectExact(redirect({ membership: acme }))
				.resolve(RedirectFromRoot, Component.noop)
		}),
	)

	it.effect("waits for the last opened organization until every org source answered", () =>
		Effect.gen(function* () {
			const s = yield* start()
			s.resolve(ReadRootRemembered, remembered(null, acme.organizationId))
				.send(RootMessage.UpdatedMemberships({ memberships: [hazel] }))
				.expectNone()
				// Left: once every source has answered, any membership will do.
				.send(RootMessage.SettledOrgSources())
				.expectExact(redirect())
				.resolve(RedirectFromRoot, Component.noop)
		}),
	)

	it.effect("back to the page sign-in started from, without waiting for the membership", () =>
		Effect.gen(function* () {
			const s = yield* start()
			s.resolve(ReadRootRemembered, remembered("/hazel/chat", null))
				.expectExact(redirect({ returnTo: "/hazel/chat", membership: null }))
				.resolve(RedirectFromRoot, Component.noop)
		}),
	)

	it.effect("onboarding comes before the remembered page, so it waits for the membership", () =>
		Effect.gen(function* () {
			const s = yield* start(false)
			s.resolve(ReadRootRemembered, remembered("/hazel/chat", null))
				.expectNone()
				.send(RootMessage.UpdatedMemberships({ memberships: [] }))
				.expectExact(redirect({ returnTo: "/hazel/chat", isOnboarded: false, membership: null }))
				.resolve(RedirectFromRoot, Component.noop)
		}),
	)

	it.effect("a stalled membership query offers a reload until it loads", () =>
		Effect.gen(function* () {
			const s = yield* start()
			s.resolve(ReadRootRemembered, remembered(null, null)).send(RootMessage.StalledMemberships())
			assert.isTrue(s.model.isStalled)
			s.send(RootMessage.PressedReload())
				.expectExact(Reload.make({ href: "/" }))
				.resolve(Reload, Component.noop)
				.send(RootMessage.UpdatedMemberships({ memberships: [hazel] }))
				.expectExact(redirect())
			assert.isFalse(s.model.isStalled)
			s.resolve(RedirectFromRoot, Component.noop)
		}),
	)
})
