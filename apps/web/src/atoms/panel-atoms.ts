import { Atom } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Schema } from "effect"
import { useCallback } from "react"
import { platformStorageRuntime } from "~/lib/platform-storage"

/**
 * Panel types for the split panel system
 */
export type PanelType = "thread" | "profile" | "search"

/**
 * Default widths for each panel type
 */
export const DEFAULT_PANEL_WIDTHS: Record<PanelType, number> = {
	thread: 480,
	profile: 400,
	search: 520,
}

/**
 * Panel width constraints
 */
export const PANEL_CONSTRAINTS = {
	minWidth: 320,
	maxWidth: 800,
	snapPoints: [0.33, 0.5, 0.67] as const,
	snapThreshold: 20,
} as const

/**
 * Atom family that stores panel widths per type
 * Persisted to localStorage for user preference retention
 */
export const panelWidthAtomFamily = Atom.family((panelType: PanelType) =>
	Atom.kvs({
		runtime: platformStorageRuntime,
		key: `panel_width_${panelType}`,
		schema: Schema.toCodecIso(Schema.NullOr(Schema.Number)),
		defaultValue: () => DEFAULT_PANEL_WIDTHS[panelType],
	}),
)

/**
 * React hook for panel width state and actions
 * Use this in React components to properly trigger re-renders
 *
 * @example
 * const { width, setWidth } = usePanelWidth("thread")
 * <ResizablePanel width={width} onWidthChangeEnd={setWidth} />
 */
export const usePanelWidth = (panelType: PanelType) => {
	const width = useAtomValue(panelWidthAtomFamily(panelType))
	const setWidthAtom = useAtomSet(panelWidthAtomFamily(panelType))

	const setWidth = useCallback(
		(newWidth: number) => {
			const clamped = Math.max(
				PANEL_CONSTRAINTS.minWidth,
				Math.min(PANEL_CONSTRAINTS.maxWidth, newWidth),
			)
			setWidthAtom(clamped)
		},
		[setWidthAtom],
	)

	return {
		width: width ?? DEFAULT_PANEL_WIDTHS[panelType],
		setWidth,
	}
}

/**
 * Snap to nearest snap point if within threshold
 */
export const snapToNearestPoint = (
	width: number,
	containerWidth: number,
	snapPoints: readonly number[] = PANEL_CONSTRAINTS.snapPoints,
	threshold: number = PANEL_CONSTRAINTS.snapThreshold,
): number => {
	for (const fraction of snapPoints) {
		const snapWidth = containerWidth * fraction
		if (Math.abs(width - snapWidth) <= threshold) {
			return snapWidth
		}
	}
	return width
}

/**
 * Clamp width to constraints, optionally using container width for max
 */
export const clampPanelWidth = (
	width: number,
	minWidth: number = PANEL_CONSTRAINTS.minWidth,
	maxWidth: number = PANEL_CONSTRAINTS.maxWidth,
	containerWidth?: number,
): number => {
	const effectiveMax = containerWidth ? Math.min(maxWidth, containerWidth * 0.7) : maxWidth
	return Math.max(minWidth, Math.min(effectiveMax, width))
}
