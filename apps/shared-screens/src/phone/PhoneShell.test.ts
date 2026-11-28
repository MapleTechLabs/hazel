// @effect-diagnostics experimentalApiUsage:off
import { describe, expect, it } from "vitest"
import { open, type PhoneShellModel, pop } from "./PhoneShell"

const C = "00000003-0000-4000-8000-000000000001"
const empty: PhoneShellModel = { tab: "home", stacks: { home: [], dms: [], activity: [], more: [] } }

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

	it("ignores a path the table does not know", () => {
		expect(open(empty, "/hazel/unknown")).toBe(empty)
	})

	it("pops the top screens of the current tab only", () => {
		const two = open(open(empty, `/hazel/chat/${C}`), `/hazel/chat/${C}/files`)
		expect(pop(two, 1).stacks.home).toEqual([`/hazel/chat/${C}`])
		expect(pop(two, 5).stacks.home).toEqual([])
	})
})
