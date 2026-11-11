import { BrowserLogin } from "@yielded/auth"
import { Effect } from "effect"
import { afterEach, expect, it, vi } from "vitest"
import { desktopClient } from "@hazel/auth/contract"

const native = {
	record: "",
	callback: undefined as ((urls: readonly string[]) => void) | undefined,
	initial: [] as string[],
	opened: 0,
}
afterEach(() => {
	native.initial = []
	native.opened = 0
	native.callback = undefined
})

const state = "a".repeat(43)
const callback = (value: string) => `${desktopClient.returnUrl}?state=${value}&code=${"c".repeat(43)}`
const record = () =>
	JSON.stringify({
		credentials: {},
		attempt: {
			attemptId: "d".repeat(43),
			clientId: desktopClient.clientId,
			returnUrl: desktopClient.returnUrl,
			state,
			verifier: "b".repeat(43),
			expiresAtMillis: Date.now() + 60000,
			phase: "Waiting",
		},
	})

it("ignores a stale queued callback and waits for this attempt's state", async () => {
	vi.doMock("@hazel/desktop/bridge", () => ({
		getTauriCore: () => ({ invoke: async () => native.record }),
		getTauriDeepLink: () => ({
			onOpenUrl: async (capture: typeof native.callback) => {
				native.callback = capture
				return () => {}
			},
			getCurrent: async () => native.initial,
		}),
		getTauriOpener: () => ({
			openUrl: async () => {
				native.opened++
			},
		}),
	}))
	const { BrowserLive } = await import("./desktop-auth")
	native.record = record()
	native.initial = [callback("z".repeat(43))]
	const opened = Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const browser = yield* BrowserLogin.Browser
				return yield* browser.open({
					url: "https://app.hazel.test/auth/desktop",
					returnUrl: desktopClient.returnUrl,
					ephemeral: false,
				})
			}).pipe(Effect.provide(BrowserLive)),
		),
	)
	await vi.waitFor(() => expect(native.opened).toBe(1))
	native.callback?.([callback("z".repeat(43))])
	native.callback?.([callback(state)])
	expect(await opened).toBe(callback(state))
})
