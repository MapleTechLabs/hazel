// @vitest-environment jsdom
import { given, role, scene, expect as sceneExpect } from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { MAX_AUTO_RETRIES, update } from "../main"
import { ada, after, boot, bootReturn, hazelOrg, rootScene } from "../test/root-fixtures"
import { CheckSession, FetchCurrentUser, RetryFetchCurrentUser } from "./command"
import { Message } from "./message"
import { currentUserOf } from "./model"

/** A load that starts as the last session's user, before the API has said anything. */

const loader = role("progressbar", { name: "Loading" })

describe("a remembered user", () => {
	test("is signed in from the first frame, while the session check and user.me still run", () => {
		const result = bootReturn("/hazel/settings/team", { rememberedUser: ada })
		expect(currentUserOf(result.model)).toEqual(ada)
		const names = (result.commands ?? []).map((command) => command.name)
		expect(names).toContain(CheckSession.name)
		expect(names).toContain(FetchCurrentUser.name)
	})

	test("has the loader only until the organization arrives from the cache", () => {
		const model = boot("/hazel/settings/team", { rememberedUser: ada })
		scene(rootScene, given(model), sceneExpect(loader).toExist())
		const withOrg = after(model, [
			Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazelOrg }),
		])
		expect(withOrg.org._tag).toBe("Loaded")
		expect(currentUserOf(withOrg)).toEqual(ada)
	})

	test("is not assumed on a public route", () => {
		expect(boot("/sign-in", { rememberedUser: ada }).session._tag).toBe("Loading")
	})

	test("stays on screen when the API does not answer", () => {
		const model = after(boot("/hazel/settings/team", { rememberedUser: ada }), [
			Message.FailedCheckSession({ reason: "Offline" }),
			Message.FailedFetchCurrentUser({ reason: "Offline" }),
		])
		expect(currentUserOf(model)).toEqual(ada)
	})

	test("is confirmed by retrying user.me behind them, a bounded number of times", () => {
		const offline = Message.FailedFetchCurrentUser({ reason: "Offline" })
		let result = update(boot("/hazel/settings/team", { rememberedUser: ada }), offline)
		for (let retry = 1; retry <= MAX_AUTO_RETRIES; retry++) {
			expect((result.commands ?? []).map((command) => command.name)).toEqual([
				RetryFetchCurrentUser.name,
			])
			expect(currentUserOf(result.model)).toEqual(ada)
			result = update(result.model, offline)
		}
		// Out of retries: still Ada's rows, and nothing more is asked.
		expect(result.commands ?? []).toEqual([])
		expect(currentUserOf(result.model)).toEqual(ada)
	})

	test("goes to sign-in once the session check says the session has ended", () => {
		const model = after(boot("/hazel/settings/team", { rememberedUser: ada }), [
			Message.ChangedAuth({ auth: "SignedOut" }),
		])
		expect(model.session._tag).toBe("SignedOut")
		expect(currentUserOf(model)).toBeNull()
	})

	test("is replaced by what user.me answers", () => {
		const renamed = { ...ada, firstName: "Augusta" }
		const model = after(boot("/hazel/settings/team", { rememberedUser: ada }), [
			Message.SucceededFetchCurrentUser({ user: renamed }),
		])
		expect(currentUserOf(model)).toEqual(renamed)
	})
})
