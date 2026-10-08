import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { keyboardStyles } from "~/components/ui/keyboard.styles"
import { textStyles } from "~/components/ui/text.styles"

/** Ports of `components/ui/text.tsx` (Text, Strong, Code) and `keyboard.tsx`. */
type Children = ReadonlyArray<Html | string>
interface Options {
	readonly className?: string
}

export const text = <Message>(h: HtmlBuilder<Message>, options: Options, children: Children): Html =>
	h.p(
		[h.Attribute("data-slot", "text"), h.Class(twMerge(textStyles.text, options.className))],
		[...children],
	)

export const strong = <Message>(h: HtmlBuilder<Message>, options: Options, children: Children): Html =>
	h.strong([h.Class(twMerge(textStyles.strong, options.className))], [...children])

export const code = <Message>(h: HtmlBuilder<Message>, options: Options, children: Children): Html =>
	h.code([h.Class(twMerge(textStyles.code, options.className))], [...children])

export const keyboard = <Message>(h: HtmlBuilder<Message>, options: Options, children: Children): Html =>
	h.kbd(
		[
			h.Attribute("dir", "ltr"),
			h.Attribute("data-slot", "keyboard"),
			h.Class(twMerge(keyboardStyles, options.className)),
		],
		[...children],
	)
