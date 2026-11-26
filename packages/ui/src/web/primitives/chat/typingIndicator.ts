/**
 * `hz:typingIndicator` (lane A5): three bouncing dots and who is typing (`page/chat/banners.ts`). A
 * polite live region that is always there, so screen readers announce who starts typing.
 */
import { definePrimitive, part } from "../define.ts"
import { ensureStyles, text } from "./shared.ts"

/** "Ada is typing...", "Ada and Grace are typing...", "Ada and 2 others are typing...". */
export const typingText = (names: ReadonlyArray<string>): string =>
	names.length === 0
		? ""
		: names.length === 1
			? `${names[0]} is typing...`
			: names.length === 2
				? `${names[0]} and ${names[1]} are typing...`
				: `${names[0]} and ${names.length - 1} others are typing...`

export const primitive = definePrimitive("typingIndicator", ({ document, outer, self }) => {
	ensureStyles(document)
	const node = outer("div")
	node.setAttribute("aria-live", "polite")
	const draw = (names: ReadonlyArray<string>) => {
		node.replaceChildren()
		if (names.length === 0) return
		const dots = part(document, "span", "dots")
		dots.setAttribute("aria-hidden", "true")
		for (let index = 0; index < 3; index++) dots.append(part(document, "span", "dot"))
		node.append(dots, text(document, "span", "label", typingText(names)))
	}
	return self(node, (name, value) => {
		if (name !== "names") return
		draw(Array.isArray(value) ? value.filter((each) => typeof each === "string") : [])
	})
})
