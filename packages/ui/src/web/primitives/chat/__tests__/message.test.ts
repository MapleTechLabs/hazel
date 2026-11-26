// @vitest-environment happy-dom
// Lane A5's message row: the parity pass's thread name, toolbar actions and run marks.
import { describe, expect, it } from "vitest"
import { create } from "../../../primitives.ts"

const drawn = async (row: unknown) => {
	const message = create(document, "hz:message")
	if (message === undefined) throw new Error("hz:message has no renderer")
	document.body.replaceChildren(message.outer)
	message.set("row", row as never)
	await new Promise((resolve) => setTimeout(resolve, 20))
	return message.outer
}

describe("hz:message on the web", () => {
	it("leads the thread card with its name and leaves selectText out of the toolbar", async () => {
		const node = await drawn({
			author: "Ada Lovelace",
			time: "14:05",
			body: [[0, ["Notes are up, ", [1, "@Grace", "u2"]]]],
			thread: {
				name: "Release notes",
				count: 4,
				author: "Grace",
				initials: "GH",
				preview: "Ok",
				time: "14:20",
			},
			actions: ["react", "copy", "selectText"],
		})
		const card = node.querySelector("[data-hz-part=thread]")
		expect(card?.querySelector("[data-hz-part=threadName]")?.textContent).toBe("Release notes")
		expect(card?.getAttribute("aria-label")).toBe("Open thread Release notes, 4 messages")
		const tools = [...node.querySelectorAll<HTMLElement>("[data-hz-part=tool]")].map(
			(tool) => tool.dataset.action,
		)
		expect(tools).toEqual(["react", "copy"])
		// Runs carry `data-hz-run`, what `popover.anchorTo` finds (`leaf-anchor-key`).
		expect(node.querySelector("[data-hz-part=mention]")?.getAttribute("data-hz-run")).toBe("1")
	})
})
