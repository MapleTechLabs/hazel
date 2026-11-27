// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import {
	ada,
	callsOf,
	hazelOrg,
	namesOf,
	shellAfter,
	shellBoot,
	shellBootReturn,
} from "../test/root-fixtures"
import { currentUserOf, isShellReady, MAX_AUTO_RETRIES, update } from "./logic"
import { AppMessage } from "./message"

/** A load that starts as the last session's user, before the API has said anything. */

const remembered = () => shellBoot("/hazel/settings/team", { rememberedUser: ada })

describe("a remembered user", () => {
	test("is signed in from the first frame, while the session check and user.me still run", () => {
		const result = shellBootReturn("/hazel/settings/team", { rememberedUser: ada })
		expect(currentUserOf(result.model)).toEqual(ada)
		const names = namesOf(result.commands)
		expect(names).toContain("shell/CheckSession")
		expect(names).toContain("shell/FetchCurrentUser")
	})

	// The gate's view of these states is in `gate.scene.test.ts`.
	test("has the loader only until the organization arrives from the cache", () => {
		const model = remembered()
		expect(isShellReady(model)).toBe(false)
		const withOrg = shellAfter(model, [
			AppMessage.UpdatedOrganization({ orgSlug: "hazel", organization: hazelOrg }),
		])
		expect(withOrg.org._tag).toBe("Loaded")
		expect(currentUserOf(withOrg)).toEqual(ada)
		expect(isShellReady(withOrg)).toBe(true)
	})

	test("is not assumed on a public route", () => {
		expect(shellBoot("/sign-in", { rememberedUser: ada }).session._tag).toBe("Loading")
	})

	test("stays on screen when the API does not answer", () => {
		const model = shellAfter(remembered(), [
			AppMessage.FailedCheckSession({ reason: "Offline" }),
			AppMessage.FailedFetchCurrentUser({ reason: "Offline" }),
		])
		expect(currentUserOf(model)).toEqual(ada)
	})

	test("is confirmed by retrying user.me behind them, a bounded number of times", () => {
		const offline = AppMessage.FailedFetchCurrentUser({ reason: "Offline" })
		let result = update(remembered(), offline)
		for (let retry = 1; retry <= MAX_AUTO_RETRIES; retry++) {
			expect(callsOf(result.commands)).toEqual([
				{ name: "shell/FetchCurrentUser", args: { delayed: true } },
			])
			expect(currentUserOf(result.model)).toEqual(ada)
			result = update(result.model, offline)
		}
		// Out of retries: still Ada's rows, and nothing more is asked.
		expect(result.commands).toEqual([])
		expect(currentUserOf(result.model)).toEqual(ada)
	})

	test("goes to sign-in once the session check says the session has ended", () => {
		const model = shellAfter(remembered(), [AppMessage.ChangedAuth({ auth: "SignedOut" })])
		expect(model.session._tag).toBe("SignedOut")
		expect(currentUserOf(model)).toBeNull()
	})

	test("is replaced by what user.me answers", () => {
		const renamed = { ...ada, firstName: "Augusta" }
		const model = shellAfter(remembered(), [AppMessage.SucceededFetchCurrentUser({ user: renamed })])
		expect(currentUserOf(model)).toEqual(renamed)
	})
})
