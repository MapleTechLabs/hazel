// @vitest-environment jsdom
import { routeOfPath } from "../../route"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { currentUser, makeShared, organizationId, storyUpdate } from "../../test/pages-fixtures"
import { PageOutMessage } from "../out-message"
import { ForgetReturnTo, init, ReadReturnTo, Reload, update } from "./index"
import { Message } from "./model"

/** `/` forwards once the user, their membership and the page sign-in started from are known. */

const membership = { organizationId, slug: "hazel" }
const signedIn = storyUpdate(update, makeShared())
const notOnboarded = storyUpdate(update, makeShared({ currentUser: { ...currentUser, isOnboarded: false } }))
const go = (href: string) =>
	expectOutMessage(PageOutMessage.RequestedNavigation({ route: routeOfPath(href), replace: true }))

describe("root redirect", () => {
	test("reads the remembered page first", () => {
		expect(init().commands?.map((command) => command.name)).toEqual([ReadReturnTo.name])
	})

	test("without a remembered page it goes to the user's organization", () => {
		story(
			signedIn,
			given(init().model),
			message(Message.UpdatedMembership({ membership })),
			Command.expectNone(),
			message(Message.ReadReturnTo({ returnTo: null })),
			go("/hazel"),
		)
	})

	test("back to the page sign-in started from, without waiting for the membership", () => {
		story(
			signedIn,
			given(init().model),
			message(Message.ReadReturnTo({ returnTo: "/join/acme" })),
			go("/join/acme"),
			// Only now, with the redirect going there, is the remembered page used up.
			Command.expectExact(ForgetReturnTo()),
			Command.resolve(ForgetReturnTo, Message.CompletedForgetReturnTo()),
		)
	})

	test("a stalled membership query offers a reload until it loads", () => {
		story(
			signedIn,
			given(init().model),
			message(Message.ReadReturnTo({ returnTo: null })),
			message(Message.StalledMembership()),
			model((m) => expect(m.isStalled).toBe(true)),
			message(Message.PressedReload()),
			Command.expectExact(Reload()),
			Command.resolve(Reload, Message.CompletedReload()),
			message(Message.UpdatedMembership({ membership })),
			model((m) => expect(m.isStalled).toBe(false)),
			go("/hazel"),
		)
	})

	test("onboarding comes before the remembered page", () => {
		story(
			notOnboarded,
			given(init().model),
			message(Message.ReadReturnTo({ returnTo: "/join/acme" })),
			message(Message.UpdatedMembership({ membership: null })),
			go("/onboarding"),
			// The remembered page stays for after onboarding, when `/` runs this redirect again.
			Command.expectNone(),
		)
	})
})
