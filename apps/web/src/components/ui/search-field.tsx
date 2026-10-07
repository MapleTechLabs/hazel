"use client"

import type { InputProps, SearchFieldProps } from "react-aria-components"
import { Button, SearchField as SearchFieldPrimitive } from "react-aria-components"
import { twJoin } from "tailwind-merge"
import IconClose from "~/components/icons/icon-close"
import IconMagnifier from "~/components/icons/icon-magnifier-3"
import { fieldStyles } from "~/components/ui/field"
import { cx } from "~/lib/primitive"
import { Input, InputGroup } from "./input"
import { searchFieldStyles } from "./search-field.styles"

export function SearchField({ className, ...props }: SearchFieldProps) {
	return (
		<SearchFieldPrimitive
			{...props}
			aria-label={props["aria-label"] ?? "Search"}
			className={cx(fieldStyles({ className: searchFieldStyles.field }), className)}
		/>
	)
}

export function SearchInput(props: InputProps) {
	return (
		<InputGroup className={searchFieldStyles.group}>
			<IconMagnifier className={searchFieldStyles.icon} />
			<Input {...props} />
			<Button className={twJoin(searchFieldStyles.clearButton)}>
				<IconClose className={searchFieldStyles.clearIcon} />
			</Button>
		</InputGroup>
	)
}
