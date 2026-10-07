import { createContext, use, useEffect, useRef, useState } from "react"
import { twMerge } from "tailwind-merge"
import { contextMenuTriggerBase } from "./context-menu.styles"
import {
	MenuContent,
	type MenuContentProps,
	MenuDescription,
	MenuHeader,
	MenuItem,
	MenuLabel,
	MenuSection,
	MenuSeparator,
	MenuShortcut,
} from "./menu"

interface ContextMenuTriggerContextType {
	buttonRef: React.RefObject<HTMLDivElement | null>
	contextMenuOffset: { offset: number; crossOffset: number } | null
	setContextMenuOffset: React.Dispatch<React.SetStateAction<{ offset: number; crossOffset: number } | null>>
}

const ContextMenuTriggerContext = createContext<ContextMenuTriggerContextType | undefined>(undefined)

const useContextMenuTrigger = () => {
	const context = use(ContextMenuTriggerContext)
	if (!context) {
		throw new Error("useContextMenuTrigger must be used within a ContextMenuTrigger")
	}
	return context
}

interface ContextMenuProps {
	children: React.ReactNode
}

const ContextMenu = ({ children }: ContextMenuProps) => {
	const [contextMenuOffset, setContextMenuOffset] = useState<{
		offset: number
		crossOffset: number
	} | null>(null)
	const buttonRef = useRef<HTMLDivElement>(null)
	return (
		<ContextMenuTriggerContext.Provider value={{ buttonRef, contextMenuOffset, setContextMenuOffset }}>
			{children}
		</ContextMenuTriggerContext.Provider>
	)
}

type ContextMenuTriggerProps = React.HTMLAttributes<HTMLDivElement>

const ContextMenuTrigger = ({ className, ...props }: ContextMenuTriggerProps) => {
	const { buttonRef, setContextMenuOffset } = useContextMenuTrigger()

	const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
		e.preventDefault()
		const rect = e.currentTarget.getBoundingClientRect()
		setContextMenuOffset({
			offset: e.clientY - rect.bottom,
			crossOffset: e.clientX - rect.left,
		})
	}
	return (
		<div
			className={twMerge(contextMenuTriggerBase, className)}
			ref={buttonRef}
			aria-haspopup="menu"
			onContextMenu={onContextMenu}
			{...props}
		/>
	)
}

type ContextMenuContentProps<T> = Omit<
	MenuContentProps<T>,
	"arrow" | "isOpen" | "onOpenChange" | "triggerRef" | "placement" | "shouldFlip"
>

const ContextMenuContent = <T extends object>(props: ContextMenuContentProps<T>) => {
	const { contextMenuOffset, setContextMenuOffset, buttonRef } = useContextMenuTrigger()

	// Close context menu and prevent browser's default context menu when right-clicking elsewhere
	useEffect(() => {
		if (!contextMenuOffset) return

		const handleContextMenu = (e: MouseEvent) => {
			// Don't interfere if right-clicking on another context menu trigger
			const target = e.target as HTMLElement
			if (target.closest('[aria-haspopup="menu"]')) {
				return
			}

			e.preventDefault()
			setContextMenuOffset(null)
		}

		document.addEventListener("contextmenu", handleContextMenu)
		return () => document.removeEventListener("contextmenu", handleContextMenu)
	}, [contextMenuOffset, setContextMenuOffset])

	return contextMenuOffset ? (
		<MenuContent
			popover={{
				isOpen: !!contextMenuOffset,
				shouldFlip: true,
				triggerRef: buttonRef,
				onOpenChange: () => setContextMenuOffset(null),
				placement: "bottom left",
				offset: contextMenuOffset.offset,
				crossOffset: contextMenuOffset.crossOffset,
			}}
			onClose={() => setContextMenuOffset(null)}
			{...props}
		/>
	) : null
}

const ContextMenuItem = MenuItem
const ContextMenuSeparator = MenuSeparator
const ContextMenuDescription = MenuDescription
const ContextMenuSection = MenuSection
const ContextMenuHeader = MenuHeader
const ContextMenuShortcut = MenuShortcut
const ContextMenuLabel = MenuLabel

export type { ContextMenuProps }
export {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuDescription,
	ContextMenuSection,
	ContextMenuHeader,
	ContextMenuShortcut,
}
