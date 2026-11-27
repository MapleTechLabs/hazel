// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { describe, test } from "vitest"
import { Navigate } from "../../../app/requests"
import { DebugPage } from "./DebugPage"

describe("debug settings", () => {
	test("a production build goes on to the general settings", () => {
		Scene.start(DebugPage, { production: true, generalHref: "/hazel/settings" })
			.expectExact(Navigate.make({ href: "/hazel/settings", replace: true }))
			.resolve(Navigate, Component.noop)
	})

	test("a dev build stays and asks for nothing", () => {
		Scene.start(DebugPage, { production: false, generalHref: "/hazel/settings" }).expectNone()
	})
})
