"use client"

import { Toolbar as ToolbarPrimitive, type ToolbarProps } from "react-aria-components"
import { cx } from "~/lib/primitive"
import { toolbarStyles } from "./toolbar.styles"

function Toolbar({ className, orientation = "horizontal", ...props }: ToolbarProps) {
	return <ToolbarPrimitive orientation={orientation} className={cx(toolbarStyles, className)} {...props} />
}

export { Toolbar }
export type { ToolbarProps }
