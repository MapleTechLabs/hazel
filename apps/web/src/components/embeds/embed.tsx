"use client"

import { createContext, type ReactNode, use } from "react"
import { cn } from "~/lib/utils"
import { embedContainerStyles, embedSectionStyles } from "./embed.styles"

export type { EmbedContainerVariants, EmbedSectionVariants } from "./embed.styles"
export { embedContainerStyles, embedSectionStyles }

// Embed context for sharing accent color with children
interface EmbedContextValue {
	accentColor?: string
	url?: string
}

const EmbedContext = createContext<EmbedContextValue | null>(null)

export const useEmbedContext = () => {
	const context = use(EmbedContext)
	if (!context) {
		throw new Error("Embed components must be used within an Embed")
	}
	return context
}

export interface EmbedProps {
	/** Accent color for the left border (e.g., "#5E6AD2" for Linear) */
	accentColor?: string
	/** Optional URL to make the entire embed clickable */
	url?: string
	/** Additional class names */
	className?: string
	children: ReactNode
}

/**
 * Discord-style embed container with colored left border.
 * Use compound components like Embed.Author, Embed.Body, etc.
 */
export function Embed({ accentColor, url, className, children }: EmbedProps) {
	const content = (
		<div
			className={cn(
				embedContainerStyles({ variant: "default" }),
				url && "hover:border-border",
				className,
			)}
			style={{
				borderLeftColor: accentColor || "var(--color-border)",
			}}
		>
			{children}
		</div>
	)

	if (url) {
		return (
			<EmbedContext value={{ accentColor, url }}>
				<a href={url} target="_blank" rel="noopener noreferrer" className="block">
					{content}
				</a>
			</EmbedContext>
		)
	}

	return <EmbedContext value={{ accentColor, url }}>{content}</EmbedContext>
}
