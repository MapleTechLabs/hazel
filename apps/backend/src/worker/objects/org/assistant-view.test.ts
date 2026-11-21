/** How T3 Code's activity items read in the AI panel (`./assistant.ts` `viewOf`). */
import { describe, expect, it } from "vitest"
import { toolNameLabel, viewOf } from "./assistant"

const item = (type: string, text: string, title: string | null = null) => ({
	position: 1,
	itemId: "i1",
	runId: "run-1",
	type,
	status: "completed",
	title,
	text,
})

describe("viewOf", () => {
	it("reads a tool call's JSON as its name, a one-line input and its output", () => {
		const view = viewOf(
			item(
				"dynamic_tool",
				JSON.stringify({
					toolName: "mcp__hazel__read_messages",
					input: { channel_id: "c1", limit: 20 },
					output: { messages: [] },
				}),
			),
		)
		expect(view).toEqual({
			kind: "tool",
			title: "Read messages",
			text: JSON.stringify({ messages: [] }, null, 2),
			data: { input: "channel_id: c1, limit: 20" },
		})
	})

	it("keeps T3's own title, but not one that only names the item type", () => {
		const call = JSON.stringify({ toolName: "ToolSearch", input: {} })
		expect(viewOf(item("dynamic_tool", call, "List channels"))?.title).toBe("List channels")
		expect(viewOf(item("dynamic_tool", call, "dynamic tool"))).toMatchObject({
			title: "Tool search",
			data: null,
		})
	})

	it("keeps text that is not a tool call as it is", () => {
		expect(viewOf(item("mcp_status", "The wonder MCP server needs a sign-in."))).toMatchObject({
			kind: "tool",
			title: "mcp status",
			text: "The wonder MCP server needs a sign-in.",
		})
	})
})

describe("toolNameLabel", () => {
	it("drops the MCP prefix and reads as words", () => {
		expect(toolNameLabel("mcp__hazel__list_channels")).toBe("List channels")
		expect(toolNameLabel("mcp__plugin:finance:slack__send_message")).toBe("Send message")
		expect(toolNameLabel("ToolSearch")).toBe("Tool search")
	})
})
