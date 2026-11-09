import { describe, expect, it } from "vitest"

import { makeOverlays, parsePlacement } from "./overlays"

describe("overlays", () => {
	it("reads React Aria placements as a side and an alignment", () => {
		expect(parsePlacement("bottom")).toEqual({ side: "bottom", align: "center" })
		expect(parsePlacement("bottom start")).toEqual({ side: "bottom", align: "start" })
		expect(parsePlacement("top right")).toEqual({ side: "top", align: "end" })
		expect(parsePlacement("end top")).toEqual({ side: "right", align: "start" })
	})

	it("reports only the paths whose overlay entry changed since it was last asked", () => {
		const overlays = makeOverlays()
		const release = overlays.portal("r/0/1")
		overlays.anchor("r/0/1/2", { triggerId: "t", side: "bottom", align: "start", gap: 8 })
		expect([...overlays.takeChanges()].sort()).toEqual(["r/0/1", "r/0/1/2"])
		expect([...overlays.takeChanges()]).toEqual([])
		release()
		expect([...overlays.takeChanges()]).toEqual(["r/0/1"])
	})

	it("portals the root, anchors the panel to its trigger and dismisses from the panel", async () => {
		const overlays = makeOverlays()
		let changes = 0
		overlays.onChange(() => changes++)
		const releasePortal = overlays.portal("r/0/1")
		overlays.modal("r/0/1")
		overlays.anchor("r/0/1/2", { triggerId: "menu-trigger", side: "bottom", align: "start", gap: 8 })
		const pathOfId = (id: string) => (id === "menu-trigger" ? "r/0" : undefined)
		expect(overlays.wireFor("r/0/1", pathOfId)).toEqual({ portal: 1 })
		expect(overlays.wireFor("r/0/1/2", pathOfId)).toEqual({
			anchor: { to: "r/0", side: "bottom", align: "start", gap: 8 },
			modal: "r/0/1",
		})
		expect(overlays.wireFor("r/0/1/0", pathOfId)).toBeUndefined()
		let dismissed = 0
		overlays.onDismiss("r/0/1", () => dismissed++)
		overlays.dismissed("r/0/1")
		expect(dismissed).toBe(1)
		await Promise.resolve()
		expect(changes).toBe(1)
		const version = overlays.version
		// A Mount re-anchoring on every commit: released and set again in one go is no change.
		const anchor = { triggerId: "menu-trigger", side: "bottom", align: "start", gap: 8 } as const
		const releaseAnchor = overlays.anchor("r/0/1/2", anchor)
		releaseAnchor()
		overlays.anchor("r/0/1/2", anchor)
		await Promise.resolve()
		expect(changes).toBe(1)
		expect(overlays.version).toBe(version)
		releasePortal()
		expect(overlays.wireFor("r/0/1", pathOfId)).toBeUndefined()
		await Promise.resolve()
		expect(changes).toBe(2)
	})

	it("sends a context menu's offset along its trigger", () => {
		const overlays = makeOverlays()
		overlays.anchor("r/2/0", {
			triggerId: "row",
			side: "bottom",
			align: "start",
			gap: 12,
			crossOffset: 240,
		})
		expect(overlays.wireFor("r/2/0", (id) => (id === "row" ? "r/1" : undefined))).toEqual({
			anchor: { to: "r/1", side: "bottom", align: "start", gap: 12, cross: 240 },
		})
	})

	it("makes a modal root without an anchored panel modal itself", () => {
		const overlays = makeOverlays()
		overlays.modal("r/3")
		expect(overlays.wireFor("r/3", () => undefined)).toEqual({ modal: "r/3" })
	})
})
