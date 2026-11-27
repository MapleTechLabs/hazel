import type { Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { kbdStyles } from "~/components/ui/kbd.styles"

/** One key of a shortcut as a key cap (`⌘`, `K`, `Enter`). */
export const kbd = <Message>(
	h: HtmlBuilder<Message>,
	options: VariantProps<typeof kbdStyles> & { readonly className?: string },
	key: string,
): Html => h.kbd([h.Class(kbdStyles({ size: options.size, className: options.className }))], [key])
