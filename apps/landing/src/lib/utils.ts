import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

let colorProbe: CanvasRenderingContext2D | null = null

/** Any CSS color as `rgba(r g b / a)`, read back from a 1x1 canvas so the browser does the parsing. */
const toRGBA = (cssColor: string): string | null => {
	colorProbe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })
	if (!colorProbe) return null
	const sentinel = "#010203"
	colorProbe.fillStyle = sentinel
	colorProbe.fillStyle = cssColor
	if (colorProbe.fillStyle === sentinel && cssColor.toLowerCase() !== sentinel) return null
	colorProbe.clearRect(0, 0, 1, 1)
	colorProbe.fillRect(0, 0, 1, 1)
	const [r = 0, g = 0, b = 0, a = 0] = colorProbe.getImageData(0, 0, 1, 1).data
	return `rgba(${r} ${g} ${b} / ${Math.round((a / 255) * 1000) / 1000})`
}

// Helper function to convert any CSS color to rgba
export const getRGBA = (
	cssColor: React.CSSProperties["color"],
	fallback: string = "rgba(180, 180, 180)",
): string => {
	if (typeof window === "undefined") return fallback
	if (!cssColor) return fallback

	// Handle CSS variables
	if (cssColor.startsWith("var(")) {
		const element = document.createElement("div")
		element.style.color = cssColor
		document.body.appendChild(element)
		const computedColor = window.getComputedStyle(element).color
		document.body.removeChild(element)
		return toRGBA(computedColor) ?? fallback
	}

	return toRGBA(cssColor) ?? fallback
}

// Helper function to add opacity to an RGB color string (runs per cell per frame, so no canvas here)
export const colorWithOpacity = (color: string, opacity: number): string => {
	if (!color.startsWith("rgb")) return color
	const [r, g, b] = color.match(/[\d.]+/g) ?? []
	if (b === undefined) return color
	return `rgba(${r} ${g} ${b} / ${opacity})`
}
