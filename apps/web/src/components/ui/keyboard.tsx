import { Keyboard as KeyboardPrimitive } from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { keyboardBase } from "./keyboard.styles"

interface KeyboardProps extends React.ComponentProps<typeof KeyboardPrimitive> {}

const Keyboard = ({ className, ...props }: KeyboardProps) => {
	return <KeyboardPrimitive data-slot="keyboard" className={twMerge(keyboardBase, className)} {...props} />
}

export type { KeyboardProps }
export { Keyboard }
