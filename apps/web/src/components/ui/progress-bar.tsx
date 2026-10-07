"use client"

import { createContext, use } from "react"
import type { ProgressBarProps, ProgressBarRenderProps } from "react-aria-components"
import { ProgressBar as ProgressBarPrimitive } from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import { progressBarStyles } from "./progress-bar.styles"

const ProgressBarContext = createContext<ProgressBarRenderProps | null>(null)

export function ProgressBar({ className, children, ...props }: ProgressBarProps) {
	return (
		<ProgressBarPrimitive
			data-slot="control"
			className={cx(...progressBarStyles.root, className)}
			{...props}
		>
			{(values) => (
				<ProgressBarContext value={{ ...values }}>
					{typeof children === "function" ? children(values) : children}
				</ProgressBarContext>
			)}
		</ProgressBarPrimitive>
	)
}

export function ProgressBarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="progress-bar-header"
			className={twMerge(progressBarStyles.header, className)}
			{...props}
		/>
	)
}

export function ProgressBarValue({ className, ...props }: Omit<React.ComponentProps<"span">, "children">) {
	const { valueText } = use(ProgressBarContext)!
	return (
		<span className={twMerge(progressBarStyles.value, className)} {...props}>
			{valueText}
		</span>
	)
}

export function ProgressBarTrack({ className, ref, ...props }: React.ComponentProps<"div">) {
	const { isIndeterminate, percentage } = use(ProgressBarContext)!
	return (
		<span data-slot="progress-bar-track" className={progressBarStyles.track}>
			<style>{progressBarStyles.keyframes}</style>
			<div ref={ref} className={progressBarStyles.trackInner} {...props}>
				<div className={twMerge(progressBarStyles.bar, className)}>
					{!isIndeterminate ? (
						<div
							data-slot="progress-content"
							className={progressBarStyles.fill}
							style={{ width: `${percentage}%` }}
						/>
					) : (
						<div
							data-slot="progress-content"
							className={progressBarStyles.fillIndeterminate}
							style={{ width: "40%" }}
						/>
					)}
				</div>
			</div>
		</span>
	)
}
