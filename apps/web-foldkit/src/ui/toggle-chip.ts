import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { ariaButton } from "./button"

/**
 * A pressable chip that toggles (`aria-pressed`): weekdays, plan names, filter choices. Pressed reads
 * as a quiet primary tint, never a brand fill.
 */
export interface ToggleChipOptions<Message> {
	readonly label: string
	readonly isPressed: boolean
	readonly isDisabled?: boolean
	readonly onPress?: Message
	/** `aria-label` when the visible label is abbreviated ("Mon" for Monday). */
	readonly ariaLabel?: string
	readonly className?: string
}

export const toggleChip = <Message>(h: HtmlBuilder<Message>, options: ToggleChipOptions<Message>): Html =>
	ariaButton(
		h,
		{
			isDisabled: options.isDisabled ?? false,
			onPress: options.onPress,
			attributes: [
				h.AriaPressed(options.isPressed ? "true" : "false"),
				...(options.ariaLabel === undefined ? [] : [h.AriaLabel(options.ariaLabel)]),
			],
			className: twMerge(
				"inline-flex h-8 max-w-full cursor-pointer items-center justify-center rounded-md border px-2.5 font-medium text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-default disabled:opacity-60 sm:h-7",
				options.isPressed
					? "border-primary/50 bg-primary-subtle/50 text-fg"
					: "border-border text-muted-fg hover:bg-secondary hover:text-fg",
				options.className,
			),
		},
		[h.span([h.Class("truncate")], [options.label])],
	)
