"use client"

import { createContext, use } from "react"
import {
	composeRenderProps,
	ToggleButton,
	ToggleButtonGroup,
	type ToggleButtonGroupProps,
	type ToggleButtonProps,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { toggleGroupItemStyles, toggleGroupStyles } from "./toggle-group.styles"

type ToggleSize = "xs" | "sm" | "md" | "lg" | "sq-xs" | "sq-sm" | "sq-md" | "sq-lg"

interface ToggleGroupContextValue extends Pick<ToggleButtonGroupProps, "selectionMode" | "orientation"> {
	size?: ToggleSize
}

const ToggleGroupContext = createContext<ToggleGroupContextValue>({
	size: "md",
	selectionMode: "single",
	orientation: "horizontal",
})

const useToggleGroupContext = () => use(ToggleGroupContext)

interface ToggleGroupProps extends ToggleButtonGroupProps {
	size?: ToggleSize
	isCircle?: boolean
}

const ToggleGroup = ({
	size = "md",
	orientation = "horizontal",
	selectionMode = "single",
	isCircle,
	className,
	...props
}: ToggleGroupProps) => {
	return (
		<ToggleGroupContext.Provider value={{ size, selectionMode, orientation }}>
			<ToggleButtonGroup
				data-slot="control"
				selectionMode={selectionMode}
				className={cx(toggleGroupStyles({ orientation, selectionMode, isCircle }), className)}
				{...props}
			/>
		</ToggleGroupContext.Provider>
	)
}

interface ToggleGroupItemProps extends ToggleButtonProps {
	size?: ToggleSize
}

const ToggleGroupItem = ({ className, ...props }: ToggleGroupItemProps) => {
	const { size, selectionMode, orientation } = useToggleGroupContext()

	return (
		<ToggleButton
			data-slot="toggle-group-item"
			className={composeRenderProps(className, (className, renderProps) =>
				twMerge(
					toggleGroupItemStyles({
						...renderProps,
						size,
						orientation,
						selectionMode,
						className,
					}),
				),
			)}
			{...props}
		/>
	)
}

export type { ToggleGroupProps, ToggleGroupItemProps }
export { ToggleGroup, ToggleGroupItem }
