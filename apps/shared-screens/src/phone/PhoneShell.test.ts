// @effect-diagnostics experimentalApiUsage:off
import { describe, expect, it } from "vitest"
import type { Session } from "../app/session"
import { initialModel, open, pop, receiveSession, replace, showToast } from "./PhoneShell"

const C = "00000003-0000-4000-8000-000000000001"
const empty = initialModel(0)

const sessionOf = (orgSlug: string): Session => ({
	auth: "SignedIn",
	user: null,
	organization: null,
	member: null,
	orgSlug,
})

describe("PhoneShell navigation", () => {
	it("pushes a route on the current tab, once", () => {
		const once = open(empty, `/hazel/chat/${C}`)
		expect(once.stacks.home).toEqual([`/hazel/chat/${C}`])
		expect(open(once, `/hazel/chat/${C}`)).toBe(once)
		const files = open(once, `/hazel/chat/${C}/files`)
		expect(files.stacks.home).toEqual([`/hazel/chat/${C}`, `/hazel/chat/${C}/files`])
	})

	it("selects a tab at its root for that tab's own route", () => {
		const deep = open(open({ ...empty, tab: "dms" }, `/hazel/chat/${C}`), "/hazel/notifications")
		expect(deep.tab).toBe("activity")
		expect(deep.stacks.dms).toEqual([`/hazel/chat/${C}`])
		const home = open({ ...deep, stacks: { ...deep.stacks, home: [`/hazel/chat/${C}`] } }, "/hazel/chat")
		expect(home).toMatchObject({ tab: "home", stacks: { home: [] } })
	})

	it("pushes Unreads and All over Activity's Mentions, and Members under Home", () => {
		expect(open(empty, "/hazel/notifications/all").stacks.home).toEqual(["/hazel/notifications/all"])
		expect(open(empty, "/hazel").stacks.home).toEqual(["/hazel"])
	})

	it("ignores a path the table does not know", () => {
		expect(open(empty, "/hazel/unknown")).toBe(empty)
	})

	it("pops the top screens of the current tab only", () => {
		const two = open(open(empty, `/hazel/chat/${C}`), `/hazel/chat/${C}/files`)
		expect(pop(two, 1).stacks.home).toEqual([`/hazel/chat/${C}`])
		expect(pop(two, 5).stacks.home).toEqual([])
	})

	it("replaces the top screen, so back skips it", () => {
		const one = open(empty, `/hazel/chat/${C}`)
		expect(replace(one, `/hazel/chat/${C}/files`).stacks.home).toEqual([`/hazel/chat/${C}/files`])
		expect(replace(empty, `/hazel/chat/${C}`).stacks.home).toEqual([`/hazel/chat/${C}`])
	})

	it("starts the tabs over for another organization, not for the same one", () => {
		const deep = receiveSession(open(empty, `/hazel/chat/${C}`), sessionOf("hazel"))
		expect(deep.stacks.home).toEqual([])
		const same = receiveSession(open(deep, `/hazel/chat/${C}`), sessionOf("hazel"))
		expect(same.stacks.home).toEqual([`/hazel/chat/${C}`])
		const other = receiveSession({ ...same, tab: "dms" }, sessionOf("acme"))
		expect(other).toMatchObject({ tab: "home", stacks: { home: [], dms: [] } })
	})

	it("shows toasts, a toast with a shown one's id replacing it", () => {
		const toast = { intent: "loading", title: "Sending", description: null, id: "send" } as const
		const one = showToast(empty, toast)
		const replaced = showToast(one, { ...toast, intent: "success", title: "Sent" })
		expect(replaced.toasts.map((shown) => shown.toast.title)).toEqual(["Sent"])
		expect(showToast(replaced, { intent: "info", title: "Hi", description: null }).toasts).toHaveLength(2)
	})
})
