import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { Link } from "./link"
import { textStyles } from "./text.styles"

export function Text({ className, ...props }: React.ComponentPropsWithoutRef<"p">) {
	return <p data-slot="text" {...props} className={twMerge(textStyles.text, className)} />
}

export function TextLink({ className, ...props }: React.ComponentPropsWithoutRef<typeof Link>) {
	return <Link {...props} className={cx(textStyles.textLink, className)} />
}

export function Strong({ className, ...props }: React.ComponentPropsWithoutRef<"strong">) {
	return <strong {...props} className={twMerge(textStyles.strong, className)} />
}

export function Code({ className, ...props }: React.ComponentPropsWithoutRef<"code">) {
	return <code {...props} className={twMerge(textStyles.code, className)} />
}
