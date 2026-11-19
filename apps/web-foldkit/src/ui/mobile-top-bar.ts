import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { heading } from "./heading"

/**
 * A phone screen's top bar, as a native navigation bar: 56pt high (the chat list's header and a
 * conversation's are the same), a hairline under it, an optional control at each end (each a 44pt
 * target) and the screen's title. Every tab's screen uses it, so they line up as one app's do.
 */
export const mobileTopBar = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		title: string
		/** A back chevron or the section's menu. */
		leading?: Html
		/** The screen's action (compose, ...). */
		trailing?: Html
		/** Stays at the top while the page under it scrolls (a page that scrolls in the shell's column). */
		isSticky?: boolean
		className?: string
	}>,
): Html =>
	h.header(
		[
			h.Class(
				twMerge(
					"flex h-14 shrink-0 items-center gap-1 border-border border-b bg-bg px-2",
					options.leading === undefined && "pl-4",
					options.trailing === undefined && "pr-4",
					options.isSticky && "sticky top-0 z-10",
					options.className,
				),
			),
		],
		[
			...(options.leading === undefined ? [] : [options.leading]),
			heading(h, { variant: "section", level: 1, className: "min-w-0 flex-1 truncate" }, [
				options.title,
			]),
			...(options.trailing === undefined ? [] : [options.trailing]),
		],
	)
