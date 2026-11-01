import { describe, expect, it } from "vitest"
import { parseInlineMarkdown } from "./embed-markdown.parser"

describe("parseInlineMarkdown", () => {
	it("leaves underscores inside words as text", () => {
		expect(parseInlineMarkdown("Approve create_alert_rule?")).toEqual([
			{ type: "text", content: "Approve create_alert_rule?" },
		])
	})

	it("still parses _italic_ and __bold__ on word boundaries", () => {
		expect(parseInlineMarkdown("a _b_ __c__").map((segment) => segment.type)).toEqual([
			"text",
			"italic",
			"text",
			"bold",
		])
	})
})
