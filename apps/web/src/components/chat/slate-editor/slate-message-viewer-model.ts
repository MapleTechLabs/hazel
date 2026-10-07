import { Element, type Path, Text } from "slate"
import { decorateCodeBlock } from "./slate-code-decorator"
import { decorateEmoji } from "./slate-emoji-decorator"
import { decorateMarkdown } from "./slate-markdown-decorations"

/**
 * What the read-only Slate viewer renders, without an editor instance: the parsed blocks and the
 * decorated leaves of each text node. The Foldkit message viewer is a pure view over this.
 */

export { isEmojiOnly } from "~/lib/emoji-utils"
export { markdownLeafClassName } from "./slate-markdown-decorations"
export {
	deserializeFromMarkdown,
	type CustomDescendant,
	type CustomElement,
	type CustomText,
} from "./slate-markdown-serializer"

export type ViewerLeaf = Readonly<Record<string, unknown> & { text: string }>

/** Same ranges as the viewer's `decorate`, split into leaves by Slate's own `Text.decorations`. */
export function viewerLeaves(text: { text: string }, path: Path, parent: unknown): ReadonlyArray<ViewerLeaf> {
	const ranges = [...decorateMarkdown([text, path], parent), ...decorateEmoji([text, path], parent)]
	return Text.decorations(text, ranges).map(({ leaf }) => leaf as ViewerLeaf)
}

/** Leaves of a code block's text: the Prism ranges the viewer's `decorate` gives the block. */
export function codeBlockLeaves(
	block: unknown,
	blockPath: Path,
	text: { text: string },
	textPath: Path,
): ReadonlyArray<ViewerLeaf> {
	if (!Element.isElement(block)) return [text as ViewerLeaf]
	const ranges = decorateCodeBlock([block, blockPath]).map((range) => ({
		...range,
		anchor: { path: textPath, offset: range.anchor.offset },
		focus: { path: textPath, offset: range.focus.offset },
	}))
	return Text.decorations(text as Text, ranges).map(({ leaf }) => leaf as ViewerLeaf)
}
