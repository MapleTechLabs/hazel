import { createLink } from "@tanstack/react-router"
import { Link as LinkPrimitive, type LinkProps as LinkPrimitiveProps } from "react-aria-components"
import { cx } from "~/lib/primitive"
import { linkStyles } from "./link.styles"

export interface LinkProps extends LinkPrimitiveProps {
	ref?: React.RefObject<HTMLAnchorElement>
}

export function Link({ className, ref, ...props }: LinkProps) {
	return (
		<LinkPrimitive
			ref={ref}
			className={cx(linkStyles({ hasHref: "href" in props }), className)}
			{...props}
		/>
	)
}
