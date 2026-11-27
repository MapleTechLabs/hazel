import type { Theme } from "@hazel/domain/models"

/**
 * HSL color representation (all values 0-1)
 */
interface HSL {
	h: number // Hue (0-1)
	s: number // Saturation (0-1)
	l: number // Lightness (0-1)
}

/**
 * RGB color representation (all values 0-255)
 */
interface RGB {
	r: number
	g: number
	b: number
}

/**
 * Convert hex color string to HSL
 */
export function hexToHsl(hex: string): HSL {
	const rgb = hexToRgb(hex)
	return rgbToHsl(rgb)
}

/**
 * Convert HSL to hex color string
 */
export function hslToHex(hsl: HSL): string {
	const rgb = hslToRgb(hsl)
	return rgbToHex(rgb)
}

/**
 * Convert hex to RGB
 */
function hexToRgb(hex: string): RGB {
	const h = hex.startsWith("#") ? hex.slice(1) : hex
	return {
		r: parseInt(h.substring(0, 2), 16),
		g: parseInt(h.substring(2, 4), 16),
		b: parseInt(h.substring(4, 6), 16),
	}
}

/**
 * Convert RGB to hex
 */
function rgbToHex(rgb: RGB): string {
	const toHex = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n)))
			.toString(16)
			.padStart(2, "0")
	return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

/**
 * Convert RGB to HSL
 */
function rgbToHsl(rgb: RGB): HSL {
	const r = rgb.r / 255
	const g = rgb.g / 255
	const b = rgb.b / 255

	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2

	if (max === min) {
		return { h: 0, s: 0, l }
	}

	const d = max - min
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

	let h = 0
	switch (max) {
		case r:
			h = (g - b) / d + (g < b ? 6 : 0)
			break
		case g:
			h = (b - r) / d + 2
			break
		case b:
			h = (r - g) / d + 4
			break
	}
	h /= 6

	return { h, s, l }
}

/**
 * Convert HSL to RGB
 */
function hslToRgb(hsl: HSL): RGB {
	const { h, s, l } = hsl

	if (s === 0) {
		const gray = Math.round(l * 255)
		return { r: gray, g: gray, b: gray }
	}

	const hue2rgb = (p: number, q: number, t: number): number => {
		if (t < 0) t += 1
		if (t > 1) t -= 1
		if (t < 1 / 6) return p + (q - p) * 6 * t
		if (t < 1 / 2) return q
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
		return p
	}

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s
	const p = 2 * l - q

	return {
		r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
		g: Math.round(hue2rgb(p, q, h) * 255),
		b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
	}
}

/**
 * Calculate relative luminance for WCAG contrast calculations
 */
function getRelativeLuminance(rgb: RGB): number {
	const toLinear = (c: number) => {
		const sRGB = c / 255
		return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4)
	}

	const r = toLinear(rgb.r)
	const g = toLinear(rgb.g)
	const b = toLinear(rgb.b)

	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Calculate contrast ratio between two colors (WCAG 2.0)
 */
export function getContrastRatio(color1: string, color2: string): number {
	const l1 = getRelativeLuminance(hexToRgb(color1))
	const l2 = getRelativeLuminance(hexToRgb(color2))

	const lighter = Math.max(l1, l2)
	const darker = Math.min(l1, l2)

	return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Check if a color has sufficient contrast with white/black
 */
function hasGoodContrast(hex: string, minRatio: number = 4.5): boolean {
	const whiteContrast = getContrastRatio(hex, "#FFFFFF")
	const blackContrast = getContrastRatio(hex, "#000000")
	return Math.max(whiteContrast, blackContrast) >= minRatio
}

/**
 * Select the best gray palette based on primary color hue
 */
export function selectGrayPalette(primaryHex: string): Theme.GrayPalette {
	const hsl = hexToHsl(primaryHex)
	const hueDegrees = hsl.h * 360

	// Map hue ranges to gray palettes based on undertone matching
	if (hueDegrees >= 0 && hueDegrees < 30) {
		// Red-orange range -> warm gray
		return "gray-warm"
	} else if (hueDegrees >= 30 && hueDegrees < 60) {
		// Orange-yellow range -> warm gray
		return "gray-warm"
	} else if (hueDegrees >= 60 && hueDegrees < 150) {
		// Yellow-green range -> modern gray (slight warmth)
		return "gray-modern"
	} else if (hueDegrees >= 150 && hueDegrees < 210) {
		// Green-cyan range -> cool gray
		return "gray-cool"
	} else if (hueDegrees >= 210 && hueDegrees < 270) {
		// Blue range -> blue gray
		return "gray-blue"
	} else if (hueDegrees >= 270 && hueDegrees < 330) {
		// Purple-magenta range -> neutral gray
		return "gray-neutral"
	} else {
		// Pink-red range -> iron gray (neutral-cool)
		return "gray-iron"
	}
}

/**
 * Select a random radius preset with weights favoring normal/round
 */
function selectRandomRadius(): Theme.RadiusPreset {
	const random = Math.random()
	// Weights: tight: 15%, normal: 35%, round: 35%, full: 15%
	if (random < 0.15) return "tight"
	if (random < 0.5) return "normal"
	if (random < 0.85) return "round"
	return "full"
}

/**
 * Generate a random primary color with good saturation and contrast
 */
function generateRandomPrimaryColor(): string {
	const maxAttempts = 20
	let attempts = 0

	while (attempts < maxAttempts) {
		// Random hue (0-1)
		const h = Math.random()
		// Saturation between 60-85% for vibrant but not garish colors
		const s = 0.6 + Math.random() * 0.25
		// Lightness between 45-60% for good visibility
		const l = 0.45 + Math.random() * 0.15

		const hex = hslToHex({ h, s, l })

		if (hasGoodContrast(hex, 4.5)) {
			return hex
		}

		attempts++
	}

	// Fallback to a safe color if we can't find one with good contrast
	return "#6938EF"
}

/**
 * Generate a single remix theme
 */
export function generateRemixTheme(): Theme.ThemeCustomization {
	const primary = generateRandomPrimaryColor() as Theme.HexColor
	const grayPalette = selectGrayPalette(primary)
	const radius = selectRandomRadius()

	return {
		primary,
		grayPalette,
		radius,
	}
}

/**
 * Check if two hues are sufficiently different (at least minDiff degrees apart)
 */
function huesAreDifferent(hue1: number, hue2: number, minDiff: number = 45): boolean {
	const diff = Math.abs(hue1 - hue2) * 360
	const wrappedDiff = Math.min(diff, 360 - diff)
	return wrappedDiff >= minDiff
}

/**
 * Generate multiple distinct remix theme options
 */
export function generateRemixOptions(count: number = 4): Theme.ThemeCustomization[] {
	const options: Theme.ThemeCustomization[] = []
	const usedHues: number[] = []
	const maxAttempts = count * 10

	let attempts = 0
	while (options.length < count && attempts < maxAttempts) {
		const theme = generateRemixTheme()
		const hsl = hexToHsl(theme.primary)

		// Check if this hue is different enough from existing ones
		const isDifferent = usedHues.every((usedHue) => huesAreDifferent(hsl.h, usedHue))

		if (isDifferent) {
			options.push(theme)
			usedHues.push(hsl.h)
		}

		attempts++
	}

	// If we couldn't generate enough distinct themes, fill with any valid themes
	while (options.length < count) {
		options.push(generateRemixTheme())
	}

	return options
}
