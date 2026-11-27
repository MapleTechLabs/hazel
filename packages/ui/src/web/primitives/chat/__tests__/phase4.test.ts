// @vitest-environment happy-dom
// Lane A5, phase 4 (W11): the files page's layouts, failed uploads, code copy and the right-click menu.
import { describe, expect, it } from "vitest"
import type { Plain } from "../../define.ts"
import { create, type Primitive } from "../../../primitives.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** A primitive with `props` set and every event in `on` recorded as `[event, payload]`. */
const mount = async (tag: string, props: Readonly<Record<string, unknown>>, on: ReadonlyArray<string>) => {
	const primitive = create(document, `hz:${tag}`) as Primitive
	const fired: Array<readonly [string, Plain]> = []
	primitive.events = {
		handlers: Object.fromEntries(on.map((name) => [name, name])),
		dispatch: (event, _handler, payload) => {
			fired.push([event, payload])
			return true
		},
	}
	document.body.replaceChildren(primitive.outer)
	for (const [name, value] of Object.entries(props)) primitive.set(name, value as never)
	await settle()
	return { node: primitive.outer, fired, set: primitive.set }
}

const files = [
	{ id: "i1", kind: "image", name: "a.png", width: 800, height: 600 },
	{ id: "v1", kind: "video", name: "demo.mp4", width: 1920, height: 1080, duration: "1:24" },
	{ id: "f1", kind: "file", name: "report.pdf", size: "2.4 MB", failed: true },
]

describe("hz:attachmentGrid layouts", () => {
	it("draws every attachment as a tile in the grid and masonry, in order", async () => {
		for (const layout of ["grid", "masonry"] as const) {
			const { node } = await mount("attachmentGrid", { layout, attachments: files }, ["press"])
			const holder = node.querySelector(
				`:scope > [data-hz-part=${layout === "grid" ? "tiles" : "masonry"}]`,
			)
			const tiles = [...(holder?.querySelectorAll<HTMLElement>("[data-hz-part=tile]") ?? [])]
			expect(tiles.map((tile) => tile.dataset.kind)).toEqual(["image", "video", "file"])
			expect(tiles[1]?.querySelector("[data-hz-part=duration]")?.textContent).toBe("1:24")
			expect(tiles[1]?.querySelector("[data-hz-part=playBadge]")).not.toBeNull()
		}
	})

	it("keeps a masonry tile's aspect before its picture loads", async () => {
		const { node } = await mount("attachmentGrid", { layout: "masonry", attachments: files }, [])
		const tile = node.querySelector<HTMLElement>("[data-hz-part=tile]")
		expect(tile?.style.aspectRatio).toBe("800 / 600")
	})

	it("lists rows with the size and length", async () => {
		const { node } = await mount("attachmentGrid", { layout: "list", attachments: files }, [])
		const rows = [...node.querySelectorAll<HTMLElement>("[data-hz-part=rows] > [data-hz-part=row]")]
		expect(rows).toHaveLength(3)
		expect(rows[1]?.querySelector("[data-hz-part=fileSize]")?.textContent).toBe("1:24")
	})

	it("retries a failed upload when the view handles retry, else opens it", async () => {
		const retrying = await mount("attachmentGrid", { layout: "grid", attachments: files }, [
			"press",
			"retry",
		])
		const failed = retrying.node.querySelector<HTMLElement>("[data-hz-part=tile][data-failed]")
		expect(failed?.getAttribute("aria-label")).toBe("Retry report.pdf")
		expect(failed?.textContent).toContain("Upload failed")
		failed?.click()
		retrying.node.querySelector<HTMLElement>("[data-hz-part=tile]")?.click()
		expect(retrying.fired).toEqual([
			["retry", { id: "f1" }],
			["press", { id: "i1" }],
		])

		const opening = await mount("attachmentGrid", { attachments: files }, ["press"])
		const card = opening.node.querySelector<HTMLElement>("[data-hz-part=file][data-failed]")
		expect(card?.querySelector("[data-hz-part=retryLabel]")).toBeNull()
		card?.click()
		expect(opening.fired).toEqual([["press", { id: "f1" }]])
	})
})

const row = {
	author: "Ada Lovelace",
	time: "10:02",
	body: [
		[0, ["The fix:"]],
		[1, "const answer = 42", "ts"],
	],
	quick: ["👍", "❤️"],
	actions: ["react", "reply", "copy", "pin", "selectText", "delete"],
}

describe("hz:message phase 4", () => {
	it("copies a code block by its index in the body, only when the view handles copyCode", async () => {
		const { node, fired } = await mount("message", { row }, ["copyCode"])
		const copy = node.querySelector<HTMLElement>("[data-hz-part=copyCode]")
		expect(copy?.getAttribute("aria-label")).toBe("Copy code")
		copy?.click()
		expect(fired).toEqual([["copyCode", { block: 1 }]])

		const plain = await mount("message", { row }, [])
		expect(plain.node.querySelector("[data-hz-part=copyCode]")).toBeNull()
	})

	it("opens a menu of the row's own actions on a right click, and raises what it picks", async () => {
		const { node, fired } = await mount("message", { row }, ["action", "pressReaction", "addReaction"])
		const event = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			clientX: 40,
			clientY: 30,
		})
		node.querySelector("[data-hz-part=body]")?.dispatchEvent(event)
		await settle()
		expect(event.defaultPrevented).toBe(true)
		const panel = node.querySelector<HTMLElement>("[data-hz=contextMenu] > [data-hz-part=panel]")
		const entries = [
			...(panel?.querySelectorAll<HTMLElement>("[data-hz-part=group] > [data-hz-part=item]") ?? []),
		]
		expect(entries.map((entry) => entry.dataset.id)).toEqual(["react", "reply", "copy", "pin", "delete"])
		expect(entries.map((entry) => entry.textContent)).toEqual([
			"Add reaction",
			"Reply",
			"Copy text",
			"Pin message",
			"Delete message",
		])
		const quick = [
			...(panel?.querySelectorAll<HTMLElement>("[data-hz-part=menuQuick] > [data-hz-part=item]") ?? []),
		]
		expect(quick.map((each) => each.textContent)).toEqual(["👍", "❤️"])
		quick[1]?.click()
		expect(fired).toEqual([["pressReaction", { emoji: "❤️" }]])

		node.querySelector("[data-hz-part=body]")?.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
		)
		await settle()
		node.querySelector<HTMLElement>("[data-hz=contextMenu] [data-id=react]")?.click()
		expect(fired.at(-1)).toEqual(["addReaction", {}])
	})

	it("leaves a row without actions to the screen's longPress", async () => {
		const { node, fired } = await mount("message", { row: { ...row, quick: [], actions: [] } }, [
			"longPress",
		])
		node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
		expect(fired).toEqual([["longPress", {}]])
	})
})
