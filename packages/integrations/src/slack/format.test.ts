import { describe, expect, it } from "@effect/vitest"
import { markdownToSlackMrkdwn, SLACK_USER_MENTION_PATTERN, slackMrkdwnToMarkdown } from "./format"

describe("slackMrkdwnToMarkdown", () => {
	it.each([
		["*bold*", "**bold**"],
		["_italic_", "*italic*"],
		["~strike~", "~~strike~~"],
		["*_bold italic_*", "***bold italic***"],
		["a *b* and *c* d", "a **b** and **c** d"],
		["(*parenthesized*)", "(**parenthesized**)"],
		["snake_case_name and 2*3*4", "snake_case_name and 2*3*4"],
		["* not bold *", "* not bold *"],
		[":white_check_mark: done", ":white_check_mark: done"],
		["&gt; quoted *text*", "> quoted **text**"],
	])("formatting %j", (input, expected) => {
		expect(slackMrkdwnToMarkdown(input)).toBe(expected)
	})

	it.each([
		["<https://example.com|the docs>", "[the docs](https://example.com)"],
		["<https://example.com/a_b_c|label>", "[label](https://example.com/a_b_c)"],
		["<https://example.com/a_b_c>", "https://example.com/a_b_c"],
		["<https://example.com|example.com>", "https://example.com"],
		["<https://example.com?a=1&amp;b=2|q>", "[q](https://example.com?a=1&b=2)"],
		["<mailto:a@b.com|a@b.com>", "a@b.com"],
		["<https://e.com|[x]>", "[\\[x\\]](https://e.com)"],
	])("links %j", (input, expected) => {
		expect(slackMrkdwnToMarkdown(input)).toBe(expected)
	})

	it.each([
		["hi <@U123ABC>", "hi <@U123ABC>"],
		["hi <@U123ABC|alice>", "hi <@U123ABC>"],
		["hi <@W123ABC>", "hi <@W123ABC>"],
		["in <#C123|general>", "in #general"],
		["in <#C123|>", "in #C123"],
		["<!here> <!channel> <!everyone>", "@here @channel @everyone"],
		["<!here|here>", "@here"],
		["<!subteam^S123|@eng> ping", "@eng ping"],
		["<!date^1392734382^{date_short}|Feb 18, 2014>", "Feb 18, 2014"],
	])("mentions and specials %j", (input, expected) => {
		expect(slackMrkdwnToMarkdown(input)).toBe(expected)
	})

	it("decodes Slack's three entities, once", () => {
		expect(slackMrkdwnToMarkdown("a &lt;b&gt; &amp; c &amp;lt;")).toBe("a <b> & c &lt;")
	})

	it("leaves code spans and blocks alone, apart from entities", () => {
		expect(slackMrkdwnToMarkdown("`*not bold* &lt;x&gt;` *bold*")).toBe("`*not bold* <x>` **bold**")
		expect(slackMrkdwnToMarkdown("```\n_keep_ <https://a|b>\n``` *after*")).toBe(
			"```\n_keep_ <https://a|b>\n``` **after**",
		)
	})

	it("keeps formatting on one line", () => {
		expect(slackMrkdwnToMarkdown("*one\ntwo*")).toBe("*one\ntwo*")
	})
})

describe("markdownToSlackMrkdwn", () => {
	it.each([
		["**bold**", "*bold*"],
		["__bold__", "*bold*"],
		["*italic*", "_italic_"],
		["_italic_", "_italic_"],
		["~~strike~~", "~strike~"],
		["[docs](https://e.com/a_b)", "<https://e.com/a_b|docs>"],
		["<https://e.com>", "<https://e.com>"],
		["# Title", "*Title*"],
		["- one\n- two", "• one\n• two"],
		["> quote", "> quote"],
		["a < b & c > d", "a &lt; b &amp; c &gt; d"],
		["hi <@U123> in <#C1|general> <!here>", "hi <@U123> in <#C1|general> <!here>"],
		["`a < b` and **x**", "`a &lt; b` and *x*"],
		["```\n**x**\n```", "```\n**x**\n```"],
	])("%j", (input, expected) => {
		expect(markdownToSlackMrkdwn(input)).toBe(expected)
	})
})

describe("SLACK_USER_MENTION_PATTERN", () => {
	it("finds user ids in both mention forms", () => {
		const text = "<@U123> and <@W456|bob>, not <#C1> or <!here>"
		expect([...text.matchAll(SLACK_USER_MENTION_PATTERN)].map((match) => match[1])).toEqual([
			"U123",
			"W456",
		])
	})
})
