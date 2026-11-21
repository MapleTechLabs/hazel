import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { handleStyles, indicatorStyles, panelStyles } from "~/components/ui/split-panel/split-panel.styles"

/** A side panel beside the page, and the edge that resizes it (drag, or arrow keys when focused). */

export type Position = "left" | "right"

export const splitPanelClassName = (position: Position, className?: string) =>
	twMerge(panelStyles({ position }), className)

/** The px an arrow key moves the focused edge. */
const KEYBOARD_STEP = 24

export interface ResizeEdgeOptions<Message> {
	readonly label: string
	/** The panel's side: a right panel's edge is its left border, and ArrowLeft widens it. */
	readonly position: Position
	readonly width: number
	readonly minWidth: number
	readonly isDragging: boolean
	/** The edge was grabbed (primary button): the pointer's x and the event target to measure from. */
	readonly onPress: (clientX: number, target: EventTarget | null) => Message
	/** An arrow key, by the px the panel grows (negative: shrinks). */
	readonly onNudge: (delta: number) => Message
	readonly className?: string
}

export const resizeEdge = <Message>(h: HtmlBuilder<Message>, options: ResizeEdgeOptions<Message>): Html => {
	const grow = options.position === "right" ? "ArrowLeft" : "ArrowRight"
	const shrink = options.position === "right" ? "ArrowRight" : "ArrowLeft"
	return h.div(
		[
			h.Role("separator"),
			h.AriaLabel(options.label),
			h.Attribute("aria-orientation", "vertical"),
			h.Attribute("aria-valuemin", String(options.minWidth)),
			h.Attribute("aria-valuenow", String(options.width)),
			h.Attribute("tabindex", "0"),
			h.Attribute("data-dragging", String(options.isDragging)),
			h.Class(
				twMerge(
					handleStyles({ position: options.position, isDragging: options.isDragging }),
					"group w-1.5 touch-none",
					options.className,
				),
			),
			h.OnPointerDown(
				(_pointerType, button, _screenX, _screenY, _timeStamp, clientX, _y, _id, target) =>
					button === 0 ? Option.some(options.onPress(clientX, target)) : Option.none(),
			),
			h.OnKeyDownPreventDefault((key) =>
				key === grow
					? Option.some(options.onNudge(KEYBOARD_STEP))
					: key === shrink
						? Option.some(options.onNudge(-KEYBOARD_STEP))
						: Option.none(),
			),
		],
		[h.div([h.Class(indicatorStyles({ position: options.position, isDragging: options.isDragging }))])],
	)
}
