import { BrowserLogin } from "@yielded/auth"
import { Effect } from "effect"
import { afterEach, expect, it, vi } from "vitest"
import { desktopClient } from "@hazel/auth/contract"
import type { HostResponse } from "./desktop-auth"

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
	vi.doMock("./tauri", () => ({
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

it("sends auth calls through the host's `auth_http`, as a fetch would answer them", async () => {
	const { hostFetch } = await import("./desktop-auth")
	const calls: Array<{ command: string; args: unknown }> = []
	let answer: HostResponse = {
		status: 200,
		headers: [["content-type", "application/json"]],
		body: '{"ok":true}',
	}
	const core = {
		invoke: async (command: string, args: Record<string, unknown>) => {
			calls.push({ command, args })
			return answer
		},
	}
	const fetch = hostFetch(core)

	const response = await fetch("https://api.hazel.test/auth/browser-login/initiate", {
		method: "POST",
		headers: { "content-type": "application/json", "x-auth-mode": "native" },
		body: '{"payload":{}}',
	})
	expect(calls).toEqual([
		{
			command: "auth_http",
			args: {
				request: {
					method: "POST",
					url: "https://api.hazel.test/auth/browser-login/initiate",
					headers: [
						["content-type", "application/json"],
						["x-auth-mode", "native"],
					],
					body: '{"payload":{}}',
				},
			},
		},
	])
	expect(response.status).toBe(200)
	expect(response.headers.get("content-type")).toBe("application/json")
	expect(await response.json()).toEqual({ ok: true })

	answer = { status: 204, headers: [], body: "" }
	const empty = await fetch("https://api.hazel.test/auth/native/sign-out", { method: "POST" })
	expect(empty.status).toBe(204)
	expect(empty.body).toBeNull()

	answer = { status: 302, headers: [["location", "https://elsewhere.test/"]], body: "" }
	await expect(
		fetch("https://api.hazel.test/auth/x", { method: "POST", redirect: "error" }),
	).rejects.toThrow(TypeError)

	const aborted = new AbortController()
	aborted.abort()
	await expect(fetch("https://api.hazel.test/auth/x", { signal: aborted.signal })).rejects.toThrow()
	expect(calls).toHaveLength(3)
})
