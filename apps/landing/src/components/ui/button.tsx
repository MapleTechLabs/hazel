import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
				destructive:
					"bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
				outline:
					"border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
				secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
				icon: "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

/**
 * Renders its one child element in its place, with this element's props merged in: the child's win,
 * except classes, which join, and event handlers, which both run (the child's first).
 */
function Slot({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
	if (!React.isValidElement<React.HTMLAttributes<HTMLElement>>(children)) return null
	const childProps = children.props
	const handlers = Object.fromEntries(
		Object.entries(props).flatMap(([name, slotHandler]) => {
			const childHandler = childProps[name as keyof typeof childProps]
			return /^on[A-Z]/.test(name) &&
				typeof slotHandler === "function" &&
				typeof childHandler === "function"
				? [
						[
							name,
							(...args: Array<unknown>) => {
								childHandler(...args)
								slotHandler(...args)
							},
						],
					]
				: []
		}),
	)
	return React.cloneElement(children, {
		...props,
		...children.props,
		...handlers,
		className: cn(className, children.props.className),
	})
}

function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean
	}) {
	const Comp = asChild ? Slot : "button"

	return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
