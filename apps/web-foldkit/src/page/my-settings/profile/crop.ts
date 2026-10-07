import { Option, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin } from "tailwind-merge"
import { clampCropRect } from "~/utils/image-crop"

/** The crop area of `AvatarCropModal` (`crop-area.tsx` + `use-crop-interaction.ts`). */

export const CropRect = Schema.Struct({ x: Schema.Number, y: Schema.Number, size: Schema.Number })
export type CropRect = typeof CropRect.Type

export const DragMode = Schema.Literals(["move", "resize-nw", "resize-ne", "resize-sw", "resize-se"])
export type DragMode = typeof DragMode.Type

export const Drag = Schema.Struct({
	mode: DragMode,
	startX: Schema.Number,
	startY: Schema.Number,
	startCrop: CropRect,
})
export type Drag = typeof Drag.Type

/** A loaded image: its object URL, natural size and the current crop (image pixels). */
export const CropImage = Schema.Struct({
	src: Schema.String,
	width: Schema.Number,
	height: Schema.Number,
	crop: CropRect,
	drag: Schema.NullOr(Drag),
})
export type CropImage = typeof CropImage.Type

const MAX_DISPLAY_SIZE = 400
const MIN_SIZE = 50

/** Fits the image into the 400px box, keeping its aspect ratio. */
export const displaySizeOf = (image: { readonly width: number; readonly height: number }) => {
	const aspectRatio = image.width / image.height
	const width =
		aspectRatio >= 1
			? Math.min(image.width, MAX_DISPLAY_SIZE)
			: Math.min(image.height, MAX_DISPLAY_SIZE) * aspectRatio
	const height = aspectRatio >= 1 ? width / aspectRatio : Math.min(image.height, MAX_DISPLAY_SIZE)
	return { width, height, scale: width / image.width }
}

const isGrowing = (mode: DragMode, deltaX: number, deltaY: number) => {
	if (mode === "resize-nw") return deltaX < 0 || deltaY < 0
	if (mode === "resize-ne") return deltaX > 0 || deltaY < 0
	if (mode === "resize-sw") return deltaX < 0 || deltaY > 0
	return deltaX > 0 || deltaY > 0
}

/** `handlePointerMove`: moves or resizes (square, anchored at the opposite corner), then clamps. */
export const dragTo = (image: CropImage, drag: Drag, clientX: number, clientY: number): CropRect => {
	const { scale } = displaySizeOf(image)
	const deltaX = (clientX - drag.startX) / scale
	const deltaY = (clientY - drag.startY) / scale
	const start = drag.startCrop
	if (drag.mode === "move") {
		return clampCropRect(
			{ x: start.x + deltaX, y: start.y + deltaY, size: start.size },
			image.width,
			image.height,
			MIN_SIZE,
		)
	}
	const sizeDelta = Math.max(Math.abs(deltaX), Math.abs(deltaY))
	const size = isGrowing(drag.mode, deltaX, deltaY) ? start.size + sizeDelta : start.size - sizeDelta
	const isLeft = drag.mode === "resize-nw" || drag.mode === "resize-sw"
	const isTop = drag.mode === "resize-nw" || drag.mode === "resize-ne"
	return clampCropRect(
		{
			x: isLeft ? start.x + start.size - size : start.x,
			y: isTop ? start.y + start.size - size : start.y,
			size,
		},
		image.width,
		image.height,
		MIN_SIZE,
	)
}

const px = (value: number) => `${value}px`

const handleCursor: Record<"nw" | "ne" | "sw" | "se", string> = {
	nw: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	se: "nwse-resize",
}

export const cropArea = <Message>(
	h: HtmlBuilder<Message>,
	image: CropImage,
	onPointerDown: (mode: DragMode, clientX: number, clientY: number) => Message,
): Html => {
	const display = displaySizeOf(image)
	const crop = {
		x: image.crop.x * display.scale,
		y: image.crop.y * display.scale,
		size: image.crop.size * display.scale,
	}
	const shade = (className: string, style: Record<string, string>) =>
		h.div([h.Class(className), h.Style(style)], [])
	const pressed = (mode: DragMode) =>
		h.OnPointerDown((_pointerType, button, _screenX, _screenY, _timeStamp, clientX, clientY) =>
			button === 0 ? Option.some(onPointerDown(mode, clientX, clientY)) : Option.none(),
		)
	const handle = (position: "nw" | "ne" | "sw" | "se") => {
		const left = position === "nw" || position === "sw" ? crop.x - 6 : crop.x + crop.size - 6
		const top = position === "nw" || position === "ne" ? crop.y - 6 : crop.y + crop.size - 6
		return h.div(
			[
				h.Class("absolute size-3 rounded-sm bg-white shadow-md"),
				h.Style({ left: px(left), top: px(top), cursor: handleCursor[position] }),
				pressed(`resize-${position}`),
			],
			[],
		)
	}
	return h.div(
		[
			h.Class("relative mx-auto touch-none select-none"),
			h.Style({ width: px(display.width), height: px(display.height) }),
		],
		[
			h.img([
				h.Src(image.src),
				h.Alt("Crop preview"),
				h.Class("absolute inset-0 size-full object-contain"),
				h.Attribute("draggable", "false"),
			]),
			shade("absolute top-0 right-0 left-0 bg-black/60", { height: px(crop.y) }),
			shade("absolute right-0 bottom-0 left-0 bg-black/60", {
				height: px(display.height - crop.y - crop.size),
			}),
			shade("absolute left-0 bg-black/60", {
				top: px(crop.y),
				height: px(crop.size),
				width: px(crop.x),
			}),
			shade("absolute right-0 bg-black/60", {
				top: px(crop.y),
				height: px(crop.size),
				width: px(display.width - crop.x - crop.size),
			}),
			h.div(
				[
					h.Class(
						twJoin(
							"absolute border-2 border-white",
							image.drag ? "cursor-grabbing" : "cursor-grab",
						),
					),
					h.Style({
						left: px(crop.x),
						top: px(crop.y),
						width: px(crop.size),
						height: px(crop.size),
					}),
					pressed("move"),
				],
				[
					h.div(
						[h.Class("pointer-events-none absolute inset-0")],
						[
							"absolute top-1/3 right-0 left-0 h-px bg-white/30",
							"absolute top-2/3 right-0 left-0 h-px bg-white/30",
							"absolute top-0 bottom-0 left-1/3 w-px bg-white/30",
							"absolute top-0 bottom-0 left-2/3 w-px bg-white/30",
						].map((className) => h.div([h.Class(className)], [])),
					),
				],
			),
			handle("nw"),
			handle("ne"),
			handle("sw"),
			handle("se"),
		],
	)
}
