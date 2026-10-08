import type { HTMLAttributes } from "react"
import { twMerge } from "tailwind-merge"
import { cardStyles } from "./card.styles"

interface CardProps extends HTMLAttributes<HTMLDivElement> {
	variant?: "default" | "danger"
}

const Card = ({ className, variant = "default", ...props }: CardProps) => {
	return (
		<div
			className={twMerge(
				cardStyles.card,
				variant === "danger" ? cardStyles.cardDanger : cardStyles.cardDefault,
				className,
			)}
			{...props}
		/>
	)
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {}

const CardHeader = ({ className, ...props }: CardHeaderProps) => {
	return <div className={twMerge(cardStyles.cardHeader, className)} {...props} />
}

interface CardHeaderGroupProps extends HTMLAttributes<HTMLDivElement> {}

const CardHeaderGroup = ({ className, ...props }: CardHeaderGroupProps) => {
	return <div className={twMerge(cardStyles.cardHeaderGroup, className)} {...props} />
}

interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {}

const CardBody = ({ className, ...props }: CardBodyProps) => {
	return <div className={twMerge(cardStyles.cardBody, className)} {...props} />
}

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {}

const CardTitle = ({ className, ...props }: CardTitleProps) => {
	return <h2 className={twMerge(cardStyles.cardTitle, className)} {...props} />
}

interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {}

const CardDescription = ({ className, ...props }: CardDescriptionProps) => {
	return <p className={twMerge(cardStyles.cardDescription, className)} {...props} />
}

export { Card, CardHeader, CardHeaderGroup, CardBody, CardTitle, CardDescription }
