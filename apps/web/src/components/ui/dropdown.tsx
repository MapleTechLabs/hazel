import type { ListBoxItemProps, ListBoxSectionProps, SeparatorProps, TextProps } from "react-aria-components"
import {
	Collection,
	composeRenderProps,
	Header,
	ListBoxItem as ListBoxItemPrimitive,
	ListBoxSection,
	Separator,
	Text,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import IconCheck from "~/components/icons/icon-check"

import {
	dropdownCheckIndicatorClassName,
	dropdownDescriptionBase,
	dropdownItemStyles,
	dropdownKeyboardBase,
	dropdownLabelBase,
	dropdownSectionStyles,
	dropdownSeparatorBase,
} from "./dropdown.styles"
import { Keyboard } from "./keyboard"

const { section, header } = dropdownSectionStyles()

interface DropdownSectionProps<T> extends ListBoxSectionProps<T> {
	title?: string
}

const DropdownSection = <T extends object>({ className, children, ...props }: DropdownSectionProps<T>) => {
	return (
		<ListBoxSection className={section({ className })}>
			{"title" in props && <Header className={header()}>{props.title}</Header>}
			<Collection items={props.items}>{children}</Collection>
		</ListBoxSection>
	)
}

interface DropdownItemProps extends ListBoxItemProps {
	intent?: "danger" | "warning"
}

const DropdownItem = ({ className, children, intent, ...props }: DropdownItemProps) => {
	const textValue = typeof children === "string" ? children : undefined
	return (
		<ListBoxItemPrimitive
			textValue={textValue}
			className={composeRenderProps(className, (className, renderProps) =>
				dropdownItemStyles({ ...renderProps, intent, className }),
			)}
			{...props}
		>
			{composeRenderProps(children, (children, { isSelected }) => (
				<>
					{isSelected && (
						<IconCheck className={dropdownCheckIndicatorClassName} data-slot="check-indicator" />
					)}
					{typeof children === "string" ? <DropdownLabel>{children}</DropdownLabel> : children}
				</>
			))}
		</ListBoxItemPrimitive>
	)
}

interface DropdownLabelProps extends TextProps {
	ref?: React.Ref<HTMLDivElement>
}

const DropdownLabel = ({ className, ref, ...props }: DropdownLabelProps) => (
	<Text slot="label" ref={ref} className={twMerge(dropdownLabelBase, className)} {...props} />
)

interface DropdownDescriptionProps extends TextProps {
	ref?: React.Ref<HTMLDivElement>
}

const DropdownDescription = ({ className, ref, ...props }: DropdownDescriptionProps) => (
	<Text slot="description" ref={ref} className={twMerge(dropdownDescriptionBase, className)} {...props} />
)

const DropdownSeparator = ({ className, ...props }: Omit<SeparatorProps, "orientation">) => (
	<Separator orientation="horizontal" className={twMerge(dropdownSeparatorBase, className)} {...props} />
)

const DropdownKeyboard = ({ className, ...props }: React.ComponentProps<typeof Keyboard>) => {
	return <Keyboard className={twMerge(dropdownKeyboardBase, className)} {...props} />
}

/**
 * Note: This is not exposed component, but it's used in other components to render dropdowns.
 * @internal
 */
export type { DropdownSectionProps, DropdownItemProps, DropdownLabelProps, DropdownDescriptionProps }
export {
	DropdownSeparator,
	DropdownItem,
	DropdownLabel,
	DropdownDescription,
	DropdownKeyboard,
	dropdownItemStyles,
	DropdownSection,
	dropdownSectionStyles,
}
