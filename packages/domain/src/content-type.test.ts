import { describe, expect, it } from "vitest"
import { isActiveContentType } from "./content-type"

describe("isActiveContentType", () => {
	it("lets ordinary single types through", () => {
		for (const type of [
			"image/png",
			"application/pdf",
			"text/plain; charset=utf-8",
			"application/octet-stream",
		]) {
			expect(isActiveContentType(type)).toBe(false)
		}
	})

	it("refuses document types, lists, quotes and empty types", () => {
		for (const type of [
			"text/html",
			"TEXT/HTML; charset=utf-8",
			"image/svg+xml",
			"application/xml",
			"text/xsl",
			"image/png, text/html",
			'image/png; x="a,text/html"',
			"",
			"   ",
			"html",
		]) {
			expect(isActiveContentType(type)).toBe(true)
		}
	})
})
