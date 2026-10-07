import { createContext, use } from "react"
import type { GridListItemProps, GridListProps, TextProps } from "react-aria-components"
import { composeRenderProps, GridList, GridListItem, Text } from "react-aria-components"
import { twMerge } from "tailwind-merge"
import type { VariantProps } from "tailwind-variants"
import {
	choiceBoxCheckboxStyles,
	choiceBoxDescriptionStyles,
	choiceBoxItemStyles,
	choiceBoxLabelStyles,
	choiceBoxStyles,
} from "./choice-box.styles"
import { cx } from "~/lib/primitive"
import { Checkbox } from "./checkbox"

const ChoiceBoxContext = createContext<{ columns?: number; gap?: number; isReadOnly?: boolean }>({})

const useChoiceBoxContext = () => use(ChoiceBoxContext)

interface ChoiceBoxProps<T extends object> extends GridListProps<T>, VariantProps<typeof choiceBoxStyles> {
	isReadOnly?: boolean
}

const ChoiceBox = <T extends object>({
	columns = 1,
	gap = 0,
	className,
	selectionMode = "single",
	isReadOnly,
	...props
}: ChoiceBoxProps<T>) => {
	return (
		<ChoiceBoxContext value={{ columns, gap, isReadOnly }}>
			<GridList
				data-slot="control"
				layout={columns === 1 ? "stack" : "grid"}
				selectionMode={selectionMode}
				className={cx(
					choiceBoxStyles({
						columns,
						gap,
					}),
					className,
				)}
				{...props}
			/>
		</ChoiceBoxContext>
	)
}

interface ChoiceBoxItemProps extends GridListItemProps, VariantProps<typeof choiceBoxItemStyles> {
	label?: string
	description?: string
}

const ChoiceBoxItem = ({ className, label, description, children, ...props }: ChoiceBoxItemProps) => {
	const textValue = typeof children === "string" ? children : undefined
	const { columns, isReadOnly } = useChoiceBoxContext()
	return (
		<GridListItem
			textValue={textValue}
			data-readonly={isReadOnly}
			data-slot="choice-box-item"
			{...props}
			className={composeRenderProps(
				className,
				(className, { isFocusVisible, isSelected, ...renderProps }) =>
					choiceBoxItemStyles({
						...renderProps,
						isOneColumn: columns === 1,
						isLink: "href" in props,
						isFocused: !isReadOnly && renderProps.isFocused,
						isActive: (!isReadOnly && isSelected) || isFocusVisible,
						className,
					}),
			)}
		>
			{composeRenderProps(children, (children, { selectionMode }) => {
				const isStringChild = typeof children === "string"
				const hasCustomChildren = typeof children !== "undefined"

				const content = hasCustomChildren ? (
					isStringChild ? (
						<ChoiceBoxLabel>{children}</ChoiceBoxLabel>
					) : (
						children
					)
				) : (
					<>
						{label && <ChoiceBoxLabel>{label}</ChoiceBoxLabel>}
						{description && <ChoiceBoxDescription>{description}</ChoiceBoxDescription>}
					</>
				)
				return (
					<>
						{content}
						{selectionMode === "multiple" && (
							<Checkbox className={choiceBoxCheckboxStyles} slot="selection" />
						)}
					</>
				)
			})}
		</GridListItem>
	)
}

interface ChoiceBoxLabelProps extends TextProps {
	ref?: React.Ref<HTMLDivElement>
}

const ChoiceBoxLabel = ({ className, ref, ...props }: ChoiceBoxLabelProps) => {
	return (
		<Text
			data-slot="label"
			ref={ref}
			className={twMerge(...choiceBoxLabelStyles, className)}
			{...props}
		/>
	)
}

type ChoiceBoxDescriptionProps = ChoiceBoxLabelProps

const ChoiceBoxDescription = ({ className, ref, ...props }: ChoiceBoxDescriptionProps) => {
	return (
		<Text
			slot="description"
			ref={ref}
			className={twMerge(...choiceBoxDescriptionStyles, className)}
			{...props}
		/>
	)
}

export type { ChoiceBoxProps, ChoiceBoxItemProps }
export { ChoiceBox, ChoiceBoxItem, ChoiceBoxLabel, ChoiceBoxDescription }
