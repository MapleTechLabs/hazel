// @vitest-environment jsdom
import { Effect, Option, Stream } from "effect"
import { Mount } from "foldkit"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ClerkMountMessage, MountClerkComponent } from "./clerk-mount"

/** The Clerk component Mount waits for Clerk to load and reports a throwing mount as a failure. */

const firstMessage = (element: Element) =>
	Effect.runPromise(
		Stream.runHead(MountClerkComponent({ component: "SignIn", props: {} }).f(element, Mount.liveViewStateChanges)),
	)

afterEach(() => {
	Reflect.deleteProperty(window, "Clerk")
})

describe("MountClerkComponent", () => {
	test("an element mounted before Clerk loads gets the form once Clerk is ready", async () => {
		const mountSignIn = vi.fn()
		const element = document.createElement("div")
		const pending = firstMessage(element)
		Reflect.set(window, "Clerk", { loaded: false, mountSignIn })
		setTimeout(() => Reflect.set(window, "Clerk", { loaded: true, mountSignIn, unmountSignIn: vi.fn() }), 120)
		expect(await pending).toEqual(Option.some(ClerkMountMessage.MountedClerkComponent({ component: "SignIn" })))
		expect(mountSignIn).toHaveBeenCalledWith(element, {})
	})

	test("a mount that throws is a failure Message, not a defect", async () => {
		Reflect.set(window, "Clerk", {
			loaded: true,
			mountSignIn: () => {
				throw new TypeError("boom")
			},
		})
		expect(await firstMessage(document.createElement("div"))).toEqual(
			Option.some(ClerkMountMessage.FailedMountClerkComponent({ component: "SignIn" })),
		)
	})
})
