import { describe, expect, it } from "vitest"
import { extractUrls } from "./link-preview.utils"

describe("extractUrls", () => {
	it("finds full URLs, www. links and bare domains", () => {
		expect(extractUrls("see https://hazel.sh/docs, www.example.com and maple.dev/pricing.")).toEqual([
			"https://hazel.sh/docs",
			"https://www.example.com",
			"https://maple.dev/pricing",
		])
	})

	it("does not treat an email address as a link", () => {
		expect(extractUrls("send emails to inbox@hazel.sh or some bs like this")).toEqual([])
		expect(extractUrls("mail first.last@mail.hazel.sh")).toEqual([])
		expect(extractUrls("mail inbox@www.hazel.sh")).toEqual([])
	})

	it("still finds a link next to an email address", () => {
		expect(extractUrls("inbox@hazel.sh, docs at hazel.sh/docs")).toEqual(["https://hazel.sh/docs"])
	})
})
