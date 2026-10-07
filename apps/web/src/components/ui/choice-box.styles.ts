import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const choiceBoxStyles = tv({
	base: "grid [--gutter:--spacing(4)]",
	variants: {
		columns: {
			1: "col-span-full grid-cols-[auto_1fr]",
			2: "sm:grid-cols-2",
			3: "sm:grid-cols-3",
			4: "sm:grid-cols-4",
			5: "sm:grid-cols-5",
			6: "sm:grid-cols-6",
		},
		gap: {
			0: "gap-0",
			1: "gap-1",
			2: "gap-2",
			3: "gap-3",
			4: "gap-4",
			5: "gap-5",
			6: "gap-6",
		},
	},
	defaultVariants: {
		columns: 1,
		gap: 0,
	},
	compoundVariants: [
		{
			gap: 0,
			columns: 1,
			className:
				"*:data-[slot=choice-box-item]:-mt-px rounded-lg *:data-[slot=choice-box-item]:inset-ring *:data-[slot=choice-box-item]:rounded-none *:data-[slot=choice-box-item]:last:rounded-b-[calc(var(--radius-lg)-1px)] *:data-[slot=choice-box-item]:first:rounded-t-[calc(var(--radius-lg)-1px)]",
		},
	],
})

export const choiceBoxItemStyles = tv({
	base: [
		"group outline-hidden",
		"[--choice-box-fg:var(--color-primary-subtle-fg)] [--choice-box:var(--color-primary-subtle)]",
		"[--choice-box-selected-hovered:var(--color-primary-subtle)]/90",
		"inset-ring inset-ring-border rounded-lg p-3 sm:p-(--gutter) **:data-[slot=label]:font-medium",
		"**:data-[slot=avatar]:row-span-2 **:data-[slot=avatar]:mt-0.5 **:data-[slot=avatar]:shrink-0",
		"**:data-[slot=icon]:row-span-2 **:data-[slot=icon]:h-[1.1lh] **:data-[slot=icon]:w-5 **:data-[slot=icon]:shrink-0",
		"has-data-[slot=avatar]:grid-cols-[auto_1fr_auto] has-data-[slot=icon]:grid-cols-[auto_1fr_auto]",
		"grid grid-cols-[1fr_auto] content-start items-start gap-x-[calc(var(--gutter)-(--spacing(1)))] gap-y-1",
		"[--choice-box-active-ring:var(--color-ring)]/70 [--choice-box-ring:var(--color-ring)]/20",
		"has-[[slot=description]]:**:data-[slot=label]:font-medium",
	],
	variants: {
		isLink: {
			true: "cursor-pointer",
			false: "cursor-default",
		},
		isHovered: {
			true: "not-data-readonly:not-data-focus-visible:not-selected:inset-ring-muted-fg/30",
		},
		isFocused: {
			true: "inset-ring-(--choice-box-active-ring) ring-(--choice-box-ring) ring-3 invalid:ring-danger-subtle-fg/20",
		},
		isInvalid: { true: "ring-3 ring-danger-subtle-fg/20" },
		isOneColumn: {
			true: "col-span-full",
		},
		isActive: {
			true: [
				"bg-(--choice-box) text-(--choice-box-fg)",
				"inset-ring-(--choice-box-active-ring) z-20 hover:bg-(--choice-box-selected-hovered)",
				"**:data-[slot=label]:text-(--choice-box-fg)",
				"**:[[slot=description]]:text-(--choice-box-fg)",
			],
		},
		isDisabled: {
			true: "z-10 opacity-50 **:data-[slot=label]:text-muted-fg forced-colors:text-[GrayText] **:[[slot=description]]:text-muted-fg/70",
		},
	},
})

export const choiceBoxLabelStyles = [
	"select-none text-base/6 text-fg group-disabled:opacity-50 sm:text-sm/6",
	"col-start-1 row-start-1",
	"group-has-data-[slot=icon]:col-start-2",
	"group-has-data-[slot=avatar]:col-start-2",
]

export const choiceBoxDescriptionStyles = [
	"col-start-1 row-start-2",
	"group-has-data-[slot=icon]:col-start-2",
	"group-has-data-[slot=avatar]:col-start-2",
	"text-base/6 text-muted-fg sm:text-sm/6",
	"group-disabled:opacity-50",
]

/** The selection checkbox in multiple selection mode. */
export const choiceBoxCheckboxStyles =
	"col-start-2 self-start group-has-data-[slot=avatar]:col-start-3 group-has-data-[slot=icon]:col-start-3 sm:mt-0.5"
