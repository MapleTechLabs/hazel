import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

/**
 * A placeholder block while content loads: one fill and radius everywhere. `className` gives it a
 * shape (`h-4 w-24`, `size-8 rounded-full`, `h-24 w-full`); never rebuild it from `animate-pulse`.
 */
export const skeleton = <Message>(h: HtmlBuilder<Message>, className?: string): Html =>
	h.span([h.AriaHidden(true), h.Class(twMerge("block animate-pulse rounded-md bg-secondary", className))])
