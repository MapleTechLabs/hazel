// @vitest-environment jsdom
import { Command, Mount, Subscription, expect as sceneExpect, given, role, scene, text } from "foldkit/scene"
import { describe, test } from "vitest"
import { boot, rootScene, sessionMessages } from "../test/root-fixtures"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import { FetchCurrentUser } from "./command"
import { Message } from "./message"

/** What the root renders for each session state, and how a session arriving changes it. */

const loader = role("progressbar", { name: "Loading" })
const settingsNav = role("link", { name: "Settings" })

describe("session states", () => {
	test("an unknown path renders the not-found screen without the shell", () => {
		scene(
			rootScene,
			given(boot("/hazel/settings/team/nope/deeper")),
			sceneExpect(text("Not found: /hazel/settings/team/nope/deeper")).toExist(),
			sceneExpect(loader).toBeAbsent(),
		)
	})

	test("while Clerk loads, an app route shows only the loader", () => {
		scene(
			rootScene,
			given(boot("/hazel/settings/team")),
			sceneExpect(loader).toExist(),
			sceneExpect(settingsNav).toBeAbsent(),
		)
	})

	test("a failed user.me keeps the loader (no error screen)", () => {
		scene(
			rootScene,
			given(boot("/hazel/settings/team")),
			Subscription.emit(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.resolve(FetchCurrentUser, Message.FailedFetchCurrentUser({ reason: "offline" })),
			sceneExpect(loader).toExist(),
		)
	})

	test("the shell appears once the session, user and organization have loaded", () => {
		const [signedIn, user, organization, member] = sessionMessages()
		scene(
			rootScene,
			given(boot("/hazel/settings/team")),
			Subscription.emit(signedIn),
			sceneExpect(loader).toExist(),
			Command.resolve(FetchCurrentUser, user),
			sceneExpect(loader).toExist(),
			Subscription.emit(organization),
			Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
			Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
			Subscription.emit(member),
			sceneExpect(loader).toBeAbsent(),
			sceneExpect(settingsNav).toExist(),
		)
	})
})
