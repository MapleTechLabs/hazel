import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"

/**
 * Discord's image mosaic, shared by a message's image attachments and its image-only embeds. One
 * image keeps its own aspect ratio; two to ten fill fixed rows of cropped cells (three is one large
 * image beside two small ones); past ten, the tenth cell counts the rest.
 */

export interface MosaicImage<M> {
	readonly key: string
	readonly url: string
	readonly alt: string
	readonly onOpen: M | undefined
}

const MAX_SHOWN = 10

/** The cells per row for 2, 4–10 images (3 has its own layout). */
const ROWS: Record<number, ReadonlyArray<number>> = {
	2: [2],
	4: [2, 2],
	5: [2, 3],
	6: [3, 3],
	7: [1, 3, 3],
	8: [2, 3, 3],
	9: [3, 3, 3],
	10: [1, 3, 3, 3],
}

/**
 * How `count` images lay out: `single` (own aspect ratio), `feature` (one large beside two), or the
 * cells per row. Past ten, the rows of ten.
 */
export const mosaicLayout = (count: number): "single" | "feature" | ReadonlyArray<number> =>
	count <= 1 ? "single" : count === 3 ? "feature" : (ROWS[Math.min(count, MAX_SHOWN)] ?? [])

const GRID_COLUMNS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }

/** A row's cell shape: a lone image is a wide band, two are 4:3, three are squares. */
const ROW_ASPECT: Record<number, string> = { 1: "aspect-[2/1]", 2: "aspect-[4/3]", 3: "aspect-square" }

const cellFrame = "relative block overflow-hidden rounded-md border border-border bg-muted"
const pressable =
	"cursor-zoom-in outline-hidden transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"

/** One cropped cell; `hidden` (the images past it) puts "+N" over it and in its label. */
const cell = <M>(h: HtmlBuilder<M>, image: MosaicImage<M>, className: string, hidden: number): Html => {
	const extra = hidden > 0 ? moreOverlay(h, hidden) : h.empty
	const img = h.img([
		h.Src(image.url),
		h.Attribute("alt", image.alt),
		h.Attribute("loading", "lazy"),
		h.Attribute("draggable", "false"),
		h.Class("size-full object-cover"),
	])
	return image.onOpen === undefined
		? h.keyed("div")(image.key, [h.Class(cx(cellFrame, className))], [img, extra])
		: h.keyed("button")(
				image.key,
				[
					h.Type("button"),
					h.Class(cx(cellFrame, pressable, className)),
					h.AriaLabel(hidden > 0 ? `Open ${image.alt} (+${hidden} more)` : `Open ${image.alt}`),
					h.OnClick(image.onOpen),
				],
				[img, extra],
			)
}

/** The "+N" over the last shown cell. */
const moreOverlay = <M>(h: HtmlBuilder<M>, hidden: number): Html =>
	h.div(
		[
			h.Class(
				"pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm",
			),
		],
		[h.span([h.Class("font-semibold text-lg text-white")], [`+${hidden}`])],
	)

/** A lone image: its own aspect ratio, never scaled up, at most 300px tall. */
const singleView = <M>(h: HtmlBuilder<M>, image: MosaicImage<M>): Html => {
	const img = h.img([
		h.Src(image.url),
		h.Attribute("alt", image.alt),
		h.Attribute("loading", "lazy"),
		h.Class("block h-auto max-h-[300px] w-auto max-w-full"),
	])
	const frame = "block w-fit max-w-full overflow-hidden rounded-md border border-border"
	return image.onOpen === undefined
		? h.div([h.Class(frame)], [img])
		: h.button(
				[
					h.Type("button"),
					h.Class(cx(frame, pressable)),
					h.AriaLabel(`Open ${image.alt}`),
					h.OnClick(image.onOpen),
				],
				[img],
			)
}

export const imageMosaicView = <M>(h: HtmlBuilder<M>, images: ReadonlyArray<MosaicImage<M>>): Html => {
	if (images.length === 0) return h.empty
	const layout = mosaicLayout(images.length)
	if (layout === "single") return singleView(h, images[0]!)
	const shown = images.slice(0, MAX_SHOWN)
	const hidden = images.length - shown.length
	const hiddenFor = (index: number) => (index === shown.length - 1 ? hidden : 0)
	if (layout === "feature")
		return h.div(
			[h.Class("grid aspect-[3/2] w-full max-w-[480px] grid-cols-3 grid-rows-2 gap-1")],
			shown.map((image, index) =>
				cell(h, image, index === 0 ? "col-span-2 row-span-2" : "", hiddenFor(index)),
			),
		)
	let offset = 0
	return h.div(
		[h.Class("flex w-full max-w-[480px] flex-col gap-1")],
		layout.map((count) => {
			const start = offset
			offset += count
			return h.div(
				[h.Class(cx("grid gap-1", GRID_COLUMNS[count]))],
				shown
					.slice(start, start + count)
					.map((image, index) => cell(h, image, ROW_ASPECT[count]!, hiddenFor(start + index))),
			)
		}),
	)
}
