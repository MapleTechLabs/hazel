import type { Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { kbdStyles } from "~/components/ui/kbd.styles"

/** One key of a shortcut as a key cap (`⌘`, `K`, `Enter`). */
export const kbd = <Message>(
	h: HtmlBuilder<Message>,
	options: VariantProps<typeof kbdStyles> & { readonly className?: string },
	key: string,
): Html => h.kbd([h.Class(kbdStyles({ size: options.size, className: options.className }))], [key])

/**
 * A shortcut: its keys as caps, in the order they are pressed (`["⌘", "K"]`). Left to right in
 * every locale, as the keys are on the keyboard.
 */
export const shortcut = <Message>(
	h: HtmlBuilder<Message>,
	options: VariantProps<typeof kbdStyles> & { readonly className?: string },
	keys: ReadonlyArray<string>,
): Html =>
	h.span(
		[h.Class("inline-flex items-center gap-0.5"), h.Attribute("dir", "ltr")],
		keys.map((key) => h.keyed("span")(key, [h.Class("contents")], [kbd(h, options, key)])),
	)
