import type { Node as ProseMirrorNode } from "prosemirror-model"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	createEmptyValue,
	deserializeFromMarkdown,
	extractMentionsFromMarkdown,
	hasMentionPattern,
	isValueEmpty,
	serializeToMarkdown,
} from "./markdown"
import { schema } from "./schema"

/**
 * Port of `apps/web/src/components/chat/slate-editor/slate-markdown-serializer.test.ts`.
 * Every case and every expected markdown string is unchanged. Only the document model
 * moved: `fromLegacy` builds ProseMirror nodes from the legacy Slate-shaped literals, and
 * `shape` projects ProseMirror nodes back to that shape so structural assertions read the
 * same. One assertion differs, see "downgrade untrusted custom emoji URLs".
 */

type LegacyNode =
	| { readonly text: string }
	| { readonly type: string; readonly children: ReadonlyArray<LegacyNode>; readonly [key: string]: unknown }

/** Slate literal to ProseMirror: `type` is the node type, other keys are attrs, empty text is dropped. */
const fromLegacy = (nodes: ReadonlyArray<LegacyNode>): Array<ProseMirrorNode> =>
	nodes.flatMap((node): Array<ProseMirrorNode> => {
		if (!("type" in node)) return node.text === "" ? [] : [schema.text(node.text)]
		const { type, children, ...attrs } = node
		const nodeType = schema.nodes[type]
		if (!nodeType) throw new Error(`unknown node type ${type}`)
		return [nodeType.create(attrs, nodeType.isAtom ? [] : fromLegacy(children))]
	})

type Shaped = { text: string } | { type: string; children: Array<Shaped>; [key: string]: unknown }

/** ProseMirror to the Slate shape: attrs flattened (null reads as undefined); an empty textblock or atom has one empty text child. */
const shape = (nodes: ReadonlyArray<ProseMirrorNode>): Array<Shaped> =>
	nodes.map((node): Shaped => {
		if (node.isText) return { text: node.text ?? "" }
		const children: Array<ProseMirrorNode> = []
		node.forEach((child) => children.push(child))
		const attrs = Object.fromEntries(Object.entries(node.attrs).map(([key, value]) => [key, value ?? undefined]))
		return {
			type: node.type.name,
			...attrs,
			children: children.length === 0 && (node.isTextblock || node.isAtom) ? [{ text: "" }] : shape(children),
		}
	})

const TRUSTED_EMOJI_BASE_URL = "https://emoji-cdn.test"

describe("markdown serializer (ProseMirror model)", () => {
	beforeEach(() => {
		vi.stubEnv("VITE_R2_PUBLIC_URL", TRUSTED_EMOJI_BASE_URL)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	// ===========================================
	// DESERIALIZATION - Code Blocks
	// ===========================================
	describe("deserializeFromMarkdown - code blocks", () => {
		it("should parse a simple code block", () => {
			const markdown = "```javascript\nconst x = 1\n```"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				type: "code-block",
				language: "javascript",
				children: [{ text: "const x = 1" }],
			})
		})

		it("should preserve empty lines in code blocks", () => {
			const markdown = "```javascript\nline1\n\nline3\n```"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				type: "code-block",
				language: "javascript",
				children: [{ text: "line1\n\nline3" }],
			})
		})

		it("should preserve multiple consecutive empty lines", () => {
			const markdown = "```\nline1\n\n\n\nline5\n```"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).children[0].text).toBe("line1\n\n\n\nline5")
		})

		it("should handle code block without language", () => {
			const markdown = "```\nsome code\n```"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result[0]).toMatchObject({
				type: "code-block",
				language: undefined,
			})
		})

		it("should handle code block at end without closing fence", () => {
			const markdown = "```javascript\ncode here"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("code-block")
		})

		it("should handle multi-line code with indentation", () => {
			const markdown = "```python\ndef foo():\n    if True:\n        return 42\n```"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).children[0].text).toBe("def foo():\n    if True:\n        return 42")
		})

		it("should handle code block followed by paragraph", () => {
			const markdown = "```js\ncode\n```\nSome text after"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(2)
			expect((result[0] as any).type).toBe("code-block")
			expect((result[1] as any).type).toBe("paragraph")
		})

		it("should handle empty code block", () => {
			const markdown = "```\n```"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("code-block")
			expect((result[0] as any).children[0].text).toBe("")
		})
	})

	// ===========================================
	// DESERIALIZATION - Edge Cases
	// ===========================================
	describe("deserializeFromMarkdown - edge cases", () => {
		it("should return empty paragraph for empty string", () => {
			const result = shape(deserializeFromMarkdown(""))

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				type: "paragraph",
				children: [{ text: "" }],
			})
		})

		it("should return empty paragraph for whitespace only", () => {
			const result = shape(deserializeFromMarkdown("   \n\t\n  "))

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				type: "paragraph",
				children: [{ text: "" }],
			})
		})

		it("should skip empty lines between elements", () => {
			const markdown = "Line 1\n\nLine 2"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(2)
			expect((result[0] as any).type).toBe("paragraph")
			expect((result[1] as any).type).toBe("paragraph")
		})
	})

	// ===========================================
	// DESERIALIZATION - Blockquotes
	// ===========================================
	describe("deserializeFromMarkdown - blockquotes", () => {
		it("should parse single-line blockquote", () => {
			const result = shape(deserializeFromMarkdown("> This is a quote"))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("blockquote")
		})

		it("should merge consecutive > lines into single blockquote", () => {
			const markdown = "> Line 1\n> Line 2\n> Line 3"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("blockquote")
			expect((result[0] as any).children[0].text).toBe("Line 1\nLine 2\nLine 3")
		})

		it("should parse multi-line blockquote with >>>", () => {
			const markdown = ">>> First line\nSecond line\nThird line"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("blockquote")
			expect((result[0] as any).children[0].text).toBe("First line\nSecond line\nThird line")
		})

		it("should parse blockquote with inline mention", () => {
			const markdown = "> Hello @[userId:123] how are you?"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("blockquote")
			// Should have text + mention + text children
			expect((result[0] as any).children.length).toBeGreaterThan(1)
		})

		it("should stop > blockquote at non-quote line", () => {
			const markdown = "> Quote line\nRegular line"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(2)
			expect((result[0] as any).type).toBe("blockquote")
			expect((result[1] as any).type).toBe("paragraph")
		})
	})

	// ===========================================
	// DESERIALIZATION - Lists
	// ===========================================
	describe("deserializeFromMarkdown - lists", () => {
		it("should parse unordered list with dash", () => {
			const result = shape(deserializeFromMarkdown("- Item 1"))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("list-item")
			expect((result[0] as any).ordered).toBe(false)
		})

		it("should parse unordered list with asterisk", () => {
			const result = shape(deserializeFromMarkdown("* Item 1"))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("list-item")
			expect((result[0] as any).ordered).toBe(false)
		})

		it("should parse ordered list", () => {
			const result = shape(deserializeFromMarkdown("1. First item"))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("list-item")
			expect((result[0] as any).ordered).toBe(true)
		})

		it("should parse ordered list with higher numbers", () => {
			const result = shape(deserializeFromMarkdown("42. Item forty-two"))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("list-item")
			expect((result[0] as any).ordered).toBe(true)
		})

		it("should parse multiple list items", () => {
			const markdown = "- Item 1\n- Item 2\n- Item 3"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(3)
			expect((result[0] as any).type).toBe("list-item")
			expect((result[1] as any).type).toBe("list-item")
			expect((result[2] as any).type).toBe("list-item")
		})

		it("should parse list item with inline mention", () => {
			const markdown = "- Talk to @[userId:abc]"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("list-item")
			expect((result[0] as any).children.length).toBeGreaterThan(1)
		})
	})

	// ===========================================
	// DESERIALIZATION - Subtext
	// ===========================================
	describe("deserializeFromMarkdown - subtext", () => {
		it("should parse subtext", () => {
			const result = shape(deserializeFromMarkdown("-# Small text"))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("subtext")
		})

		it("should parse subtext with mention", () => {
			const result = shape(deserializeFromMarkdown("-# Note from @[userId:123]"))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("subtext")
			expect((result[0] as any).children.length).toBeGreaterThan(1)
		})
	})

	// ===========================================
	// DESERIALIZATION - Mentions in Paragraphs
	// ===========================================
	describe("deserializeFromMarkdown - mentions", () => {
		it("should parse paragraph with inline mention", () => {
			const markdown = "Hello @[userId:123] world"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			expect((result[0] as any).type).toBe("paragraph")
			const children = (result[0] as any).children
			expect(children).toHaveLength(3)
			expect(children[0]).toMatchObject({ text: "Hello " })
			expect(children[1]).toMatchObject({ type: "mention", userId: "123" })
			expect(children[2]).toMatchObject({ text: " world" })
		})

		it("should parse paragraph with multiple mentions", () => {
			const markdown = "@[userId:abc] and @[userId:def]"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result).toHaveLength(1)
			const children = (result[0] as any).children
			expect(children.filter((c: any) => c.type === "mention")).toHaveLength(2)
		})

		it("should parse mention at start of text", () => {
			const markdown = "@[userId:123] is here"
			const result = shape(deserializeFromMarkdown(markdown))

			const children = (result[0] as any).children
			expect(children[0]).toMatchObject({ type: "mention", userId: "123" })
		})

		it("should parse mention at end of text", () => {
			const markdown = "Hello @[userId:123]"
			const result = shape(deserializeFromMarkdown(markdown))

			const children = (result[0] as any).children
			expect(children[children.length - 1]).toMatchObject({ type: "mention", userId: "123" })
		})

		it("should parse directive mentions", () => {
			const markdown = "@[directive:channel] everyone!"
			const result = shape(deserializeFromMarkdown(markdown))

			const children = (result[0] as any).children
			expect(children[0]).toMatchObject({ type: "mention", userId: "channel" })
		})
	})

	// ===========================================
	// DESERIALIZATION - Mixed Content
	// ===========================================
	describe("deserializeFromMarkdown - mixed content", () => {
		it("should parse document with multiple element types", () => {
			const markdown = "Hello world\n> A quote\n- List item\n```js\ncode\n```\n-# Subtext"
			const result = shape(deserializeFromMarkdown(markdown))

			expect(result.length).toBeGreaterThanOrEqual(5)
			expect((result[0] as any).type).toBe("paragraph")
			expect((result[1] as any).type).toBe("blockquote")
			expect((result[2] as any).type).toBe("list-item")
			expect((result[3] as any).type).toBe("code-block")
			expect((result[4] as any).type).toBe("subtext")
		})
	})

	// ===========================================
	// SERIALIZATION - Code Blocks
	// ===========================================
	describe("serializeToMarkdown - code blocks", () => {
		it("should serialize code block with language", () => {
			const nodes = [
				{
					type: "code-block" as const,
					language: "typescript",
					children: [{ text: "const x: number = 1" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("```typescript\nconst x: number = 1\n```")
		})

		it("should serialize code block without language", () => {
			const nodes = [
				{
					type: "code-block" as const,
					children: [{ text: "some code" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("```\nsome code\n```")
		})

		it("should preserve newlines in code block content", () => {
			const nodes = [
				{
					type: "code-block" as const,
					language: "js",
					children: [{ text: "line1\n\nline3" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("```js\nline1\n\nline3\n```")
		})
	})

	// ===========================================
	// SERIALIZATION - Mentions
	// ===========================================
	describe("serializeToMarkdown - mentions", () => {
		it("should serialize user mention", () => {
			const nodes = [
				{
					type: "mention" as const,
					userId: "user-123",
					displayName: "John",
					children: [{ text: "" }] as [{ text: "" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("@[userId:user-123]")
		})

		it("should serialize channel directive mention", () => {
			const nodes = [
				{
					type: "mention" as const,
					userId: "channel",
					displayName: "channel",
					children: [{ text: "" }] as [{ text: "" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("@[directive:channel]")
		})

		it("should serialize here directive mention", () => {
			const nodes = [
				{
					type: "mention" as const,
					userId: "here",
					displayName: "here",
					children: [{ text: "" }] as [{ text: "" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("@[directive:here]")
		})
	})

	// ===========================================
	// SERIALIZATION - Blockquotes
	// ===========================================
	describe("serializeToMarkdown - blockquotes", () => {
		it("should serialize single-line blockquote", () => {
			const nodes = [
				{
					type: "blockquote" as const,
					children: [{ text: "This is a quote" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("> This is a quote")
		})

		it("should serialize multi-line blockquote with > prefix per line", () => {
			const nodes = [
				{
					type: "blockquote" as const,
					children: [{ text: "Line 1\nLine 2\nLine 3" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("> Line 1\n> Line 2\n> Line 3")
		})

		it("should serialize blockquote with mention", () => {
			const nodes = [
				{
					type: "blockquote" as const,
					children: [
						{ text: "Hello " },
						{
							type: "mention" as const,
							userId: "123",
							displayName: "User",
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("> Hello @[userId:123]")
		})
	})

	// ===========================================
	// SERIALIZATION - Lists
	// ===========================================
	describe("serializeToMarkdown - lists", () => {
		it("should serialize unordered list item", () => {
			const nodes = [
				{
					type: "list-item" as const,
					ordered: false,
					children: [{ text: "Item content" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("- Item content")
		})

		it("should serialize ordered list item", () => {
			const nodes = [
				{
					type: "list-item" as const,
					ordered: true,
					children: [{ text: "First item" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("1. First item")
		})

		it("should serialize list item with mention", () => {
			const nodes = [
				{
					type: "list-item" as const,
					ordered: false,
					children: [
						{ text: "Talk to " },
						{
							type: "mention" as const,
							userId: "abc",
							displayName: "User",
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("- Talk to @[userId:abc]")
		})
	})

	// ===========================================
	// SERIALIZATION - Subtext
	// ===========================================
	describe("serializeToMarkdown - subtext", () => {
		it("should serialize subtext with -# prefix", () => {
			const nodes = [
				{
					type: "subtext" as const,
					children: [{ text: "Small note" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("-# Small note")
		})

		it("should serialize subtext with mention", () => {
			const nodes = [
				{
					type: "subtext" as const,
					children: [
						{ text: "By " },
						{
							type: "mention" as const,
							userId: "author",
							displayName: "Author",
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("-# By @[userId:author]")
		})
	})

	// ===========================================
	// SERIALIZATION - Paragraphs
	// ===========================================
	describe("serializeToMarkdown - paragraphs", () => {
		it("should serialize paragraph with text", () => {
			const nodes = [
				{
					type: "paragraph" as const,
					children: [{ text: "Hello world" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("Hello world")
		})

		it("should serialize paragraph with inline mention", () => {
			const nodes = [
				{
					type: "paragraph" as const,
					children: [
						{ text: "Hello " },
						{
							type: "mention" as const,
							userId: "user-1",
							displayName: "User",
							children: [{ text: "" }] as [{ text: "" }],
						},
						{ text: " how are you?" },
					],
				},
			] as any

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("Hello @[userId:user-1] how are you?")
		})

		it("should serialize multiple paragraphs joined by newlines", () => {
			const nodes = [
				{
					type: "paragraph" as const,
					children: [{ text: "First paragraph" }],
				},
				{
					type: "paragraph" as const,
					children: [{ text: "Second paragraph" }],
				},
			]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("First paragraph\nSecond paragraph")
		})
	})

	// ===========================================
	// SERIALIZATION - Text Nodes
	// ===========================================
	describe("serializeToMarkdown - text nodes", () => {
		it("should serialize plain text node", () => {
			const nodes = [{ text: "Just plain text" }]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("Just plain text")
		})

		it("should serialize multiple text nodes joined", () => {
			const nodes = [{ text: "First" }, { text: "Second" }]

			const result = serializeToMarkdown(fromLegacy(nodes))
			expect(result).toBe("First\nSecond")
		})
	})

	// ===========================================
	// ROUND-TRIP TESTS
	// ===========================================
	describe("round-trip: serialize then deserialize", () => {
		it("should preserve code block with empty lines through round-trip", () => {
			const original = [
				{
					type: "code-block" as const,
					language: "python",
					children: [{ text: "def foo():\n\n    return 42" }],
				},
			]

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).children[0].text).toBe("def foo():\n\n    return 42")
		})

		it("should preserve code block with multiple empty lines through round-trip", () => {
			const original = [
				{
					type: "code-block" as const,
					language: "js",
					children: [{ text: "a\n\n\nb" }],
				},
			]

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).children[0].text).toBe("a\n\n\nb")
			expect((result[0] as any).language).toBe("js")
		})

		it("should preserve blockquote through round-trip", () => {
			const original = [
				{
					type: "blockquote" as const,
					children: [{ text: "A quoted message" }],
				},
			]

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).type).toBe("blockquote")
			expect((result[0] as any).children[0].text).toBe("A quoted message")
		})

		it("should preserve unordered list item through round-trip", () => {
			const original = [
				{
					type: "list-item" as const,
					ordered: false,
					children: [{ text: "List item content" }],
				},
			]

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).type).toBe("list-item")
			expect((result[0] as any).ordered).toBe(false)
		})

		it("should preserve ordered list item through round-trip", () => {
			const original = [
				{
					type: "list-item" as const,
					ordered: true,
					children: [{ text: "Ordered item" }],
				},
			]

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).type).toBe("list-item")
			expect((result[0] as any).ordered).toBe(true)
		})

		it("should preserve subtext through round-trip", () => {
			const original = [
				{
					type: "subtext" as const,
					children: [{ text: "Small text" }],
				},
			]

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).type).toBe("subtext")
			expect((result[0] as any).children[0].text).toBe("Small text")
		})

		it("should preserve paragraph with mention through round-trip", () => {
			const original = [
				{
					type: "paragraph" as const,
					children: [
						{ text: "Hello " },
						{
							type: "mention" as const,
							userId: "test-user",
							displayName: "Test",
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).type).toBe("paragraph")
			const children = (result[0] as any).children
			expect(children[0]).toMatchObject({ text: "Hello " })
			expect(children[1]).toMatchObject({ type: "mention", userId: "test-user" })
		})

		it("should preserve custom emoji through round-trip", () => {
			const trustedHazelUrl = `${TRUSTED_EMOJI_BASE_URL}/emojis/hazel.png`
			const original = [
				{
					type: "paragraph" as const,
					children: [
						{ text: "Look " },
						{
							type: "custom-emoji" as const,
							name: "hazel",
							imageUrl: trustedHazelUrl,
							children: [{ text: "" }] as [{ text: "" }],
						},
						{ text: " cool!" },
					],
				},
			] as any

			const markdown = serializeToMarkdown(fromLegacy(original))
			expect(markdown).toBe(`Look ![custom-emoji:hazel](${trustedHazelUrl}) cool!`)

			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).type).toBe("paragraph")
			const children = (result[0] as any).children
			expect(children[0]).toMatchObject({ text: "Look " })
			expect(children[1]).toMatchObject({
				type: "custom-emoji",
				name: "hazel",
				imageUrl: trustedHazelUrl,
			})
			expect(children[2]).toMatchObject({ text: " cool!" })
		})

		it("should serialize paragraph with only a custom emoji", () => {
			const trustedHazelUrl = `${TRUSTED_EMOJI_BASE_URL}/emojis/hazel.png`
			const original = [
				{
					type: "paragraph" as const,
					children: [
						{
							type: "custom-emoji" as const,
							name: "hazel",
							imageUrl: trustedHazelUrl,
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any

			const markdown = serializeToMarkdown(fromLegacy(original))
			expect(markdown).toBe(`![custom-emoji:hazel](${trustedHazelUrl})`)

			// Also verify isValueEmpty recognizes this as non-empty
			expect(isValueEmpty(fromLegacy(original))).toBe(false)

			// And round-trip works
			const result = shape(deserializeFromMarkdown(markdown))
			expect((result[0] as any).type).toBe("paragraph")
			const children = (result[0] as any).children
			expect(children[0]).toMatchObject({
				type: "custom-emoji",
				name: "hazel",
				imageUrl: trustedHazelUrl,
			})
		})

		it("should preserve custom emoji alongside mentions through round-trip", () => {
			const trustedWaveUrl = `${TRUSTED_EMOJI_BASE_URL}/emojis/wave.gif`
			const original = [
				{
					type: "paragraph" as const,
					children: [
						{
							type: "mention" as const,
							userId: "user1",
							displayName: "User",
							children: [{ text: "" }] as [{ text: "" }],
						},
						{ text: " " },
						{
							type: "custom-emoji" as const,
							name: "wave",
							imageUrl: trustedWaveUrl,
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any

			const markdown = serializeToMarkdown(fromLegacy(original))
			const result = shape(deserializeFromMarkdown(markdown))

			const children = (result[0] as any).children
			expect(children[0]).toMatchObject({ type: "mention", userId: "user1" })
			expect(children[1]).toMatchObject({ text: " " })
			expect(children[2]).toMatchObject({
				type: "custom-emoji",
				name: "wave",
				imageUrl: trustedWaveUrl,
			})
		})

		it("should downgrade untrusted custom emoji URLs to shortcode text", () => {
			const markdown = "Look ![custom-emoji:hazel](https://evil.example/emojis/hazel.png) cool!"
			const result = shape(deserializeFromMarkdown(markdown))

			expect((result[0] as any).type).toBe("paragraph")
			const children = (result[0] as any).children
			// Legacy: three text nodes ("Look ", ":hazel:", " cool!"). ProseMirror always merges
			// adjacent text nodes (Slate's own normalizer does too once the value is in an editor).
			expect(children).toHaveLength(1)
			expect(children[0]).toMatchObject({ text: "Look :hazel: cool!" })
		})
	})

	// ===========================================
	// UTILITY FUNCTIONS
	// ===========================================
	describe("createEmptyValue", () => {
		it("should create empty paragraph", () => {
			const result = shape(createEmptyValue())

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				type: "paragraph",
				children: [{ text: "" }],
			})
		})
	})

	describe("isValueEmpty", () => {
		it("should return true for empty value", () => {
			expect(isValueEmpty(createEmptyValue())).toBe(true)
		})

		it("should return true for whitespace only", () => {
			const value = [{ type: "paragraph" as const, children: [{ text: "   " }] }]
			expect(isValueEmpty(fromLegacy(value))).toBe(true)
		})

		it("should return false for content", () => {
			const value = [{ type: "paragraph" as const, children: [{ text: "hello" }] }]
			expect(isValueEmpty(fromLegacy(value))).toBe(false)
		})

		it("should return true for empty array", () => {
			expect(isValueEmpty([])).toBe(true)
		})

		it("should return false for code block with content", () => {
			const value = [
				{
					type: "code-block" as const,
					children: [{ text: "code" }],
				},
			]
			expect(isValueEmpty(fromLegacy(value))).toBe(false)
		})

		it("should return true for code block with empty content", () => {
			const value = [
				{
					type: "code-block" as const,
					children: [{ text: "" }],
				},
			]
			expect(isValueEmpty(fromLegacy(value))).toBe(true)
		})

		it("should return false for mention-only content", () => {
			const value = [
				{
					type: "paragraph" as const,
					children: [
						{
							type: "mention" as const,
							userId: "user-1",
							displayName: "User 1",
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any
			expect(isValueEmpty(fromLegacy(value))).toBe(false)
		})

		it("should return false for custom-emoji-only content", () => {
			const value = [
				{
					type: "paragraph" as const,
					children: [
						{
							type: "custom-emoji" as const,
							name: "hazel",
							imageUrl: `${TRUSTED_EMOJI_BASE_URL}/emojis/hazel.png`,
							children: [{ text: "" }] as [{ text: "" }],
						},
					],
				},
			] as any
			expect(isValueEmpty(fromLegacy(value))).toBe(false)
		})
	})

	describe("extractMentionsFromMarkdown", () => {
		it("should extract user mentions", () => {
			const result = extractMentionsFromMarkdown("Hello @[userId:123] how are you?")

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({ prefix: "userId", value: "123" })
		})

		it("should extract directive mentions", () => {
			const result = extractMentionsFromMarkdown("@[directive:channel] everyone!")

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({ prefix: "directive", value: "channel" })
		})

		it("should extract multiple mentions", () => {
			const result = extractMentionsFromMarkdown("@[userId:abc] and @[userId:def]")

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ prefix: "userId", value: "abc" })
			expect(result[1]).toEqual({ prefix: "userId", value: "def" })
		})

		it("should return empty array for no mentions", () => {
			const result = extractMentionsFromMarkdown("No mentions here")

			expect(result).toHaveLength(0)
		})

		it("should extract mentions from complex text", () => {
			const result = extractMentionsFromMarkdown(
				"Hey @[userId:user1], please talk to @[directive:channel] about @[userId:user2]",
			)

			expect(result).toHaveLength(3)
		})
	})

	describe("hasMentionPattern", () => {
		it("should return true for text with user mentions", () => {
			expect(hasMentionPattern("Hello @[userId:123]")).toBe(true)
		})

		it("should return true for text with directive mentions", () => {
			expect(hasMentionPattern("Hello @[directive:channel]")).toBe(true)
		})

		it("should return false for text without mentions", () => {
			expect(hasMentionPattern("Hello world")).toBe(false)
		})

		it("should return false for malformed mentions", () => {
			expect(hasMentionPattern("Hello @[invalid:123]")).toBe(false)
			expect(hasMentionPattern("Hello @userId:123]")).toBe(false)
			expect(hasMentionPattern("Hello @[userId:123")).toBe(false)
		})
	})
})
