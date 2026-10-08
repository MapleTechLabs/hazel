import {
	Group,
	type GroupProps,
	Input as InputPrimitive,
	type InputProps as PrimitiveInputProps,
} from "react-aria-components"
import { cx } from "~/lib/primitive"
import { inputControlStyles, inputGroupStyles, inputStyles } from "./input.styles"

interface InputProps extends PrimitiveInputProps {
	ref?: React.RefObject<HTMLInputElement>
}

export function Input({ className, ref, ...props }: InputProps) {
	return (
		<span data-slot="control" className={inputControlStyles}>
			<InputPrimitive ref={ref} className={cx(...inputStyles, className)} {...props} />
		</span>
	)
}

export function InputGroup({ className, ...props }: GroupProps) {
	return <Group data-slot="control" className={cx(...inputGroupStyles, className)} {...props} />
}
