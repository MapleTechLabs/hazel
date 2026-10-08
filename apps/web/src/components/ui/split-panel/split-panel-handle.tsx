import { handleStyles, indicatorStyles } from "./split-panel.styles"

export interface SplitPanelHandleProps {
	/** Props from usePanelResize hook */
	handleProps: {
		onPointerDown: (e: React.PointerEvent) => void
		onKeyDown: (e: React.KeyboardEvent) => void
		tabIndex: number
		role: "separator"
		"aria-orientation": "vertical"
		"aria-valuenow": number
		"aria-valuemin": number
		"aria-valuemax": number
		"aria-label": string
	}
	/** Panel position */
	position?: "left" | "right"
	/** Whether currently dragging */
	isDragging?: boolean
	/** Additional className */
	className?: string
}

export function SplitPanelHandle({
	handleProps,
	position = "right",
	isDragging = false,
	className,
}: SplitPanelHandleProps) {
	return (
		<div
			{...handleProps}
			className={handleStyles({ position, isDragging, className })}
			data-dragging={isDragging}
		>
			<div className={indicatorStyles({ position, isDragging })} />
		</div>
	)
}
