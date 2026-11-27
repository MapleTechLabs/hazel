/**
 * A reaction pill's tooltip in Chromium: the bubble draws nothing until it opens, then lays out its
 * emoji and names. Runs in Vitest's browser mode only; `vitest run` under Node skips it.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"

const inBrowser = typeof navigator !== "undefined" && /Chrome|HeadlessChrome/.test(navigator.userAgent)

let Shared: typeof import("../shared.ts")
let Surface: typeof import("../../../focus/surface.ts")

beforeAll(async () => {
	if (!inBrowser) return
	await import("../../../../style/generated/tokens.css")
	Shared = await import("../shared.ts")
	Surface = await import("../../../focus/surface.ts")
})

afterEach(() => {
	if (inBrowser) document.body.replaceChildren()
})

describe.runIf(inBrowser)("reaction pill tooltip", () => {
	it("draws no bubble while closed and lays it out once open", () => {
		// The app's order: the overlay layer's rules first, the chat's after (they win a tie).
		Surface.installOverlayStyles(document)
		Shared.ensureStyles(document)
		const pill = Shared.reactionPill(
			document,
			{ emoji: "🔥", count: 2, mine: true, who: { names: ["Ada", "Grace"], others: 0 } },
			() => {},
		)
		document.body.append(pill)
		const bubble = pill.querySelector<HTMLElement>('[data-hz-part="bubble"]')!
		expect(getComputedStyle(bubble).display).toBe("none")
		expect(bubble.getBoundingClientRect().width).toBe(0)
		Surface.showPanel(bubble, { modal: false, inPlace: false })
		expect(getComputedStyle(bubble).display).toBe("flex")
	})
})
