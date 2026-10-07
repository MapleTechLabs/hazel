"use client"

import { TextArea, type TextAreaProps } from "react-aria-components"
import { twJoin } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { textareaControlStyles, textareaStyles } from "./textarea.styles"

export function Textarea({ className, ...props }: TextAreaProps) {
	return (
		<span data-slot="control" className={textareaControlStyles}>
			<TextArea {...props} className={cx(twJoin(textareaStyles), className)} />
		</span>
	)
}
