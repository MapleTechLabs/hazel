import { IconMinus } from "~/components/icons/icon-minus"
import { OTPInput, OTPInputContext } from "input-otp"
import { use } from "react"
import { twMerge } from "tailwind-merge"
import { fieldStyles, Label } from "~/components/ui/field"
import { inputOtpStyles } from "./input-otp.styles"

export function InputOTP({
	className,
	containerClassName,
	...props
}: React.ComponentPropsWithoutRef<typeof OTPInput>) {
	return (
		<span data-slot="control" className={inputOtpStyles.wrapper}>
			<OTPInput
				data-slot="input-otp"
				containerClassName={twMerge(fieldStyles(), containerClassName)}
				className={twMerge(inputOtpStyles.input, className)}
				{...props}
			/>
		</span>
	)
}

export function InputOTPControl({ className, ...props }: React.ComponentProps<"span">) {
	return <span data-slot="control" className={twMerge(inputOtpStyles.control, className)} {...props} />
}

export function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<span data-slot="input-otp-group" className={twMerge(inputOtpStyles.group, className)} {...props} />
	)
}

export function InputOTPSlot({
	index,
	className,
	...props
}: React.ComponentProps<"div"> & {
	index: number
}) {
	const inputOTPContext = use(OTPInputContext)
	const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

	return (
		<div
			data-slot="input-otp-slot"
			data-active={isActive}
			className={twMerge(inputOtpStyles.slot, className)}
			{...props}
		>
			{char}
			{hasFakeCaret && (
				<div className={inputOtpStyles.caret}>
					<div className={inputOtpStyles.caretBar} />
				</div>
			)}
		</div>
	)
}

export function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="input-otp-separator" {...props}>
			<IconMinus className={inputOtpStyles.separatorIcon} />
		</div>
	)
}

export function InputOTPLabel(props: React.ComponentProps<typeof Label>) {
	return <Label elementType="span" {...props} />
}
