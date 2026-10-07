import { AnimatePresence, motion } from "motion/react"
import { createContext, useContext, useRef } from "react"
import { PANEL_CONSTRAINTS } from "~/atoms/panel-atoms"
import { SplitPanelHandle } from "./split-panel-handle"
import { contentStyles, panelStyles, rootStyles } from "./split-panel.styles"
import { usePanelResize } from "./use-panel-resize"

// ============================================================================
// Context for sharing container ref
// ============================================================================

interface SplitPanelContextValue {
	containerRef: React.RefObject<HTMLDivElement | null>
}

const SplitPanelContext = createContext<SplitPanelContextValue | null>(null)

function useSplitPanelContext() {
	const context = useContext(SplitPanelContext)
	if (!context) {
		throw new Error("SplitPanel components must be used within SplitPanelRoot")
	}
	return context
}

// ============================================================================
// Styles
// ============================================================================

// Defined in split-panel.styles.ts so the Foldkit app composes the same classes.

// ============================================================================
// SplitPanelRoot
// ============================================================================

export interface SplitPanelRootProps {
	children: React.ReactNode
	className?: string
}

export function SplitPanelRoot({ children, className }: SplitPanelRootProps) {
	const containerRef = useRef<HTMLDivElement>(null)

	return (
		<SplitPanelContext.Provider value={{ containerRef }}>
			<div ref={containerRef} className={rootStyles({ className })}>
				{children}
			</div>
		</SplitPanelContext.Provider>
	)
}

// ============================================================================
// SplitPanelContent
// ============================================================================

export interface SplitPanelContentProps {
	children: React.ReactNode
	className?: string
}

export function SplitPanelContent({ children, className }: SplitPanelContentProps) {
	return <div className={contentStyles({ className })}>{children}</div>
}

// ============================================================================
// SplitPanel
// ============================================================================

export interface SplitPanelProps {
	/** Whether the panel is open */
	isOpen: boolean
	/** Callback when panel requests to close */
	onClose?: () => void
	/** Default width */
	defaultWidth?: number
	/** Callback during resize */
	onWidthChange?: (width: number) => void
	/** Callback when resize ends (for persistence) */
	onWidthChangeEnd?: (width: number) => void
	/** Minimum width */
	minWidth?: number
	/** Maximum width */
	maxWidth?: number
	/** Panel position */
	position?: "left" | "right"
	/** Enable snap points */
	enableSnap?: boolean
	/** Custom snap points */
	snapPoints?: readonly number[]
	/** Accessible label for resize handle */
	resizeHandleLabel?: string
	/** Panel content */
	children: React.ReactNode
	/** Additional className for the panel */
	className?: string
}

export function SplitPanel({
	isOpen,
	onClose,
	defaultWidth = 480,
	onWidthChange,
	onWidthChangeEnd,
	minWidth = PANEL_CONSTRAINTS.minWidth,
	maxWidth = PANEL_CONSTRAINTS.maxWidth,
	position = "right",
	enableSnap = true,
	snapPoints = PANEL_CONSTRAINTS.snapPoints,
	resizeHandleLabel = "Resize panel",
	children,
	className,
}: SplitPanelProps) {
	const { containerRef } = useSplitPanelContext()

	const { width, isDragging, handleProps } = usePanelResize({
		initialWidth: defaultWidth,
		minWidth,
		maxWidth,
		containerRef,
		position,
		onWidthChange,
		onWidthChangeEnd,
		enableSnap,
		snapPoints,
	})

	const panelWidth = width

	const customHandleProps = {
		...handleProps,
		"aria-label": resizeHandleLabel,
	}

	return (
		<AnimatePresence mode="wait">
			{isOpen && (
				<motion.div
					key="split-panel"
					initial={{ width: 0, opacity: 0 }}
					animate={{
						width: panelWidth,
						opacity: 1,
						transition: isDragging
							? { duration: 0 }
							: { type: "spring", damping: 25, stiffness: 300 },
					}}
					exit={{
						width: 0,
						opacity: 0,
						transition: { duration: 0.2, ease: "easeInOut" },
					}}
					className={panelStyles({ position, className })}
					style={{ width: isDragging ? panelWidth : undefined }}
					data-position={position}
				>
					<SplitPanelHandle
						handleProps={customHandleProps}
						position={position}
						isDragging={isDragging}
					/>
					<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
				</motion.div>
			)}
		</AnimatePresence>
	)
}
