import { describe, expect, it } from "vitest"

import { anchorSetup, floatingPlacement } from "./anchor"
import { nativeOverlays } from "./overlay"

describe("anchorSetup", () => {
	it("reads Floating UI placements as a side and an alignment", () => {
		expect(floatingPlacement("top")).toEqual({ side: "top", align: "center" })
		expect(floatingPlacement("bottom-start")).toEqual({ side: "bottom", align: "start" })
		expect(floatingPlacement("right-end")).toEqual({ side: "right", align: "end" })
	})

	it("portals and anchors a panel to its trigger until released", () => {
		const panel = { __path: "r/4/1" }
		const release = anchorSetup(panel, { buttonId: "tip", anchor: { placement: "top", gap: 10 } })
		const pathOfId = (id: string) => (id === "tip" ? "r/4/0" : undefined)
		expect(nativeOverlays.wireFor("r/4/1", pathOfId)).toEqual({
			portal: 1,
			anchor: { to: "r/4/0", side: "top", align: "center", gap: 10 },
		})
		release()
		expect(nativeOverlays.wireFor("r/4/1", pathOfId)).toBeUndefined()
	})
})
