import { describe, expect, it } from "vitest"
import { makePushRegistration, type PushApi, type PushHost, type PushToken } from "./push"

const TOKEN: PushToken = { token: "abcdef0123456789", bundleId: "hazel.app", environment: "production" }
const ACCOUNT = { api: "https://api.hazel.sh", userId: "00000000-0000-4000-8000-000000000001" }

const make = (options: { signedIn?: boolean; host?: Partial<PushHost> } = {}) => {
	const calls: Array<string> = []
	let signedIn = options.signedIn ?? true
	const host: PushHost = {
		register: async (account) => {
			calls.push(`host.register ${account.api} ${account.userId}`)
			return TOKEN
		},
		forget: async () => {
			calls.push("host.forget")
		},
		...options.host,
	}
	const api: PushApi = {
		account: async () => (signedIn ? ACCOUNT : null),
		register: async (token) => {
			calls.push(`api.register ${token.token}`)
		},
		unregister: async (token) => {
			calls.push(`api.unregister ${token}`)
		},
	}
	const registration = makePushRegistration({ host, api, log: () => undefined })
	return { calls, registration, signIn: () => (signedIn = true) }
}

describe("push registration", () => {
	it("hands the shell the API and the user, and registers its token once", async () => {
		const { calls, registration } = make()
		await Promise.all([registration.ensure(), registration.ensure()])
		await registration.ensure()
		await registration.retry()
		expect(calls).toEqual([
			`host.register ${ACCOUNT.api} ${ACCOUNT.userId}`,
			`api.register ${TOKEN.token}`,
		])
		expect(registration.isRegistered()).toBe(true)
	})

	it("does nothing while signed out, and registers on a retry once signed in", async () => {
		const { calls, registration, signIn } = make({ signedIn: false })
		await registration.ensure()
		expect(calls).toEqual([])
		signIn()
		await registration.retry()
		expect(calls).toEqual([
			`host.register ${ACCOUNT.api} ${ACCOUNT.userId}`,
			`api.register ${TOKEN.token}`,
		])
	})

	it("after the shell refuses, only a return to the front asks again", async () => {
		let answers = 0
		const { calls, registration } = make({
			host: {
				register: async () => {
					answers += 1
					if (answers === 1) throw new Error("notifications are not allowed")
					return TOKEN
				},
			},
		})
		await registration.ensure()
		await registration.retry()
		expect(answers).toBe(1)
		await registration.ensure()
		expect(answers).toBe(2)
		expect(calls).toEqual([`api.register ${TOKEN.token}`])
	})

	it("sign-out forgets the token on the API, then in the shell, and registers again after", async () => {
		const { calls, registration } = make()
		await registration.ensure()
		await registration.unregister()
		expect(calls.slice(2)).toEqual([`api.unregister ${TOKEN.token}`, "host.forget"])
		expect(registration.isRegistered()).toBe(false)
		await registration.ensure()
		expect(registration.isRegistered()).toBe(true)
	})

	it("sign-out holds off the retry until the device is forgotten", async () => {
		const calls: Array<string> = []
		let release: () => void = () => undefined
		const registration = makePushRegistration({
			host: {
				register: async () => {
					calls.push("host.register")
					return TOKEN
				},
				forget: async () => {
					calls.push("host.forget")
				},
			},
			api: {
				account: async () => ACCOUNT,
				register: async () => {
					calls.push("api.register")
				},
				unregister: (token) =>
					new Promise<void>((resolve) => {
						calls.push(`api.unregister ${token}`)
						release = resolve
					}),
			},
			log: () => undefined,
		})
		await registration.ensure()
		const signingOut = registration.unregister()
		await Promise.resolve()
		// The session still answers while the API forgets the token: the timer must not register again.
		await registration.retry()
		await registration.ensure()
		release()
		await signingOut
		expect(calls).toEqual([
			"host.register",
			"api.register",
			`api.unregister ${TOKEN.token}`,
			"host.forget",
		])
		expect(registration.isRegistered()).toBe(false)
	})

	it("an attempt running when sign-out starts lands first, so its token is forgotten too", async () => {
		const calls: Array<string> = []
		let answer: (token: PushToken) => void = () => undefined
		const registration = makePushRegistration({
			host: {
				register: () =>
					new Promise<PushToken>((resolve) => {
						calls.push("host.register")
						answer = resolve
					}),
				forget: async () => {
					calls.push("host.forget")
				},
			},
			api: {
				account: async () => ACCOUNT,
				register: async () => {
					calls.push("api.register")
				},
				unregister: async (token) => {
					calls.push(`api.unregister ${token}`)
				},
			},
			log: () => undefined,
		})
		const registering = registration.ensure()
		await Promise.resolve()
		await Promise.resolve()
		const signingOut = registration.unregister()
		answer(TOKEN)
		await Promise.all([registering, signingOut])
		expect(calls).toEqual([
			"host.register",
			"api.register",
			`api.unregister ${TOKEN.token}`,
			"host.forget",
		])
		expect(registration.isRegistered()).toBe(false)
	})
})
