import { EditorState, TextSelection } from "prosemirror-state"
import { describe, expect, it } from "vitest"

import { type ProseMirrorNode, schema } from "../../web-foldkit/src/editor/schema"
import { replaceFieldText } from "./text-edit"

const { paragraph, blockquote, mention } = schema.nodes
const listItem = schema.nodes["list-item"]
if (paragraph === undefined || blockquote === undefined || mention === undefined || listItem === undefined)
	throw new Error("the composer schema changed")

const stateOf = (...blocks: Array<ProseMirrorNode>) =>
	EditorState.create({ doc: schema.node("doc", null, blocks) })

const edited = (state: EditorState, value: string) => {
	const tr = replaceFieldText(state, value)
	return tr === undefined ? state : state.apply(tr)
}

const blocksOf = (state: EditorState) => {
	const blocks: Array<string> = []
	state.doc.forEach((block) => blocks.push(`${block.type.name}:${block.textContent}`))
	return blocks
}

describe("replaceFieldText", () => {
	it("types into one block and keeps the others as the editor made them", () => {
		const state = stateOf(
			blockquote.create(null, schema.text("quoted")),
			listItem.create(null, schema.text("first item")),
		)
		const next = edited(state, "quoted\nfirst items")
		expect(blocksOf(next)).toEqual(["blockquote:quoted", "list-item:first items"])
	})

	it("splits the block a newline is typed into", () => {
		const state = stateOf(listItem.create(null, schema.text("onetwo")))
		expect(blocksOf(edited(state, "one\ntwo"))).toEqual(["list-item:one", "list-item:two"])
	})

	it("joins blocks when the newline between them is deleted, and clears to one empty block", () => {
		const state = stateOf(
			paragraph.create(null, schema.text("a")),
			paragraph.create(null, schema.text("b")),
		)
		expect(blocksOf(edited(state, "ab"))).toEqual(["paragraph:ab"])
		expect(blocksOf(edited(state, ""))).toEqual(["paragraph:"])
	})

	it("types after a mention when the caret is after it, where one text offset is either side", () => {
		const grace = mention.create({ userId: "u2", displayName: "Grace" })
		const doc = schema.node("doc", null, [paragraph.create(null, [schema.text("Thanks "), grace])])
		const afterMention = doc.content.size - 1
		const state = EditorState.create({ doc, selection: TextSelection.create(doc, afterMention) })
		const next = edited(state, "Thanks  for the review")
		const order: Array<string> = []
		next.doc.descendants((node) => {
			if (node.type === mention) order.push("@Grace")
			else if (node.isText) order.push(node.text ?? "")
		})
		expect(order).toEqual(["Thanks ", "@Grace", " for the review"])
		// Without a caret there, the earliest place wins, as before.
		const before = edited(stateOf(paragraph.create(null, [schema.text("Thanks "), grace])), "Thanks !")
		expect(before.doc.textBetween(0, before.doc.content.size, "\n")).toBe("Thanks !")
	})

	it("leaves a mention in place when text after it changes", () => {
		const ada = mention.create({ userId: "u1", displayName: "Ada" })
		const state = stateOf(paragraph.create(null, [schema.text("hi "), ada, schema.text(" there")]))
		const next = edited(state, "hi  there!")
		let mentions = 0
		next.doc.descendants((node) => {
			if (node.type === mention) mentions++
		})
		expect(mentions).toBe(1)
		expect(next.doc.textBetween(0, next.doc.content.size, "\n")).toBe("hi  there!")
	})

	it("changes nothing when the text is the same", () => {
		const state = stateOf(paragraph.create(null, schema.text("same")))
		expect(replaceFieldText(state, "same")).toBeUndefined()
	})
})
