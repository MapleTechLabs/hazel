// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { BrandPanel } from "../extensions/BrandPanel.ts"
import { missingWebExtensions, mountExtension } from "./extensions.ts"
import { pictureAt } from "./primitives/structure/brandPanel.ts"

describe("BrandPanel on the web", () => {
	it("is registered, and picks the season and time of day's picture", () => {
		expect(missingWebExtensions([BrandPanel])).toEqual([])
		expect(pictureAt(new Date(2026, 10, 26, 15))).toBe("autumn-day.webp")
		expect(pictureAt(new Date(2026, 0, 2, 22))).toBe("winter-night.webp")
		expect(pictureAt(new Date(2026, 3, 2, 5))).toBe("spring-night.webp")
	})

	it("draws the picture, the logo home and the tagline card, which hides without a tagline", () => {
		const surface = document.createElement("div")
		const props = { pictures: "/images/onboarding", homeHref: "/", tagline: "Calm" }
		expect(mountExtension(surface, "BrandPanel", props, () => false)).toBe(true)
		const picture = surface.querySelector<HTMLImageElement>('[data-hz-part="picture"]')
		expect(picture?.getAttribute("src")).toMatch(
			/^\/images\/onboarding\/(spring|summer|autumn|winter)-(day|night)\.webp$/,
		)
		expect(surface.querySelector('[data-hz-part="home"]')?.getAttribute("href")).toBe("/")
		expect(surface.querySelector('[data-hz-part="tagline"]')?.textContent).toBe("Calm")
		mountExtension(surface, "BrandPanel", { ...props, tagline: null }, () => false)
		expect(surface.querySelector<HTMLElement>('[data-hz-part="card"]')?.hidden).toBe(true)
	})
})
