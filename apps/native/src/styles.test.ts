import { StyleResolver } from "@hazel/foldkit-rune"
import { beforeAll, describe, expect, it } from "vitest"
import { progressBarStyles } from "../../web-foldkit/src/core/components/ui/progress-bar.styles"

// The app's own stylesheet, as `src/entry.ts` loads it, against the classes its components ship.
let styles: StyleResolver

beforeAll(async () => {
	styles = await StyleResolver.load(new URL("../../web-foldkit/src/styles.css", import.meta.url).pathname)
})

const resolve = (className: string) => {
	const classes = className.split(/\s+/).filter((c) => c !== "")
	styles.ensure(classes)
	return styles.resolve(
		{ classes, attrs: {}, hasDescendant: () => false },
		styles.rootScope(false),
		false,
		1280,
	)
}

describe("the app's stylesheet on Rune", () => {
	it("sweeps the loading screen's indeterminate progress segment across its track", () => {
		const { style } = resolve(progressBarStyles.fillIndeterminate)
		expect(style.animation).toEqual({
			kind: "slide",
			period: 1.6,
			delay: 0,
			from: [-1, 0],
			to: [2.5, 0],
			ease: [0.42, 0, 0.58, 1],
		})
		expect(style.w).toEqual({ frac: 0.4 })
	})
})
