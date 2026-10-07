import type { Html, HtmlBuilder } from "foldkit/html"
import { galleryStyles } from "~/dev-gallery/gallery.styles"

/**
 * Port of `apps/web/src/dev-gallery/frame.tsx`. The root is `div#app`, which the first render replaces.
 * `before` renders ahead of the page, where the legacy root puts app-wide UI such as the toaster.
 */
export const galleryFrame = <Message>(
	h: HtmlBuilder<Message>,
	title: string,
	children: ReadonlyArray<Html>,
	before: ReadonlyArray<Html> = [],
): Html =>
	h.div(
		[h.Id("app")],
		[
			...before,
			h.div(
				[h.Class(galleryStyles.page)],
				[
					h.h1([h.Class(galleryStyles.title)], [title]),
					h.div([h.Class(galleryStyles.sections)], [...children]),
				],
			),
		],
	)

export const gallerySection = <Message>(
	h: HtmlBuilder<Message>,
	title: string,
	children: ReadonlyArray<Html | string>,
): Html =>
	h.section(
		[h.Class(galleryStyles.section), h.Attribute("aria-label", title)],
		[
			h.h2([h.Class(galleryStyles.sectionTitle)], [title]),
			h.div([h.Class(galleryStyles.row)], [...children]),
		],
	)
