import { Icons } from "@/components/react/Icons"
import { StarCount } from "@/components/react/StarCount"
import { siteConfig } from "@/lib/config"
import React, { useRef, useState } from "react"

interface NavItem {
	name: string
	href: string
}

interface NavMenuProps {
	currentPath: string
	hasScrolled?: boolean
}

const navs: NavItem[] = siteConfig.nav.links

export function NavMenu({ currentPath, hasScrolled }: NavMenuProps) {
	const ref = useRef<HTMLUListElement>(null)
	const [left, setLeft] = useState(0)
	const [width, setWidth] = useState(0)

	const isActive = (href: string) => {
		if (href.startsWith("http")) return false
		if (href === "/") return currentPath === "/"
		return currentPath.startsWith(href)
	}

	React.useEffect(() => {
		// Find the active nav item based on current path
		const activeItem = navs.find((item) => isActive(item.href))
		const activeHref = activeItem?.href || navs[0].href

		const navItem = ref.current?.querySelector(`[href="${activeHref}"]`)?.parentElement
		if (navItem) {
			setLeft(navItem.offsetLeft)
			setWidth(navItem.getBoundingClientRect().width)
		}
	}, [currentPath])

	return (
		<div className="w-full hidden md:block">
			<ul
				className="relative mx-auto flex w-fit rounded-full h-11 px-2 items-center justify-center"
				ref={ref}
			>
				{navs.map((item) => (
					<li
						key={item.name}
						className={`z-10 cursor-pointer h-full flex items-center justify-center px-4 py-2 text-sm font-medium transition-colors duration-200 ${
							isActive(item.href) ? "text-primary" : "text-primary/60 hover:text-primary"
						} tracking-tight`}
					>
						<a href={item.href} className="flex items-center gap-1.5">
							{item.name === "GitHub" && <Icons.github />}
							{item.name !== "GitHub" && item.name}
							{item.name === "GitHub" && !hasScrolled && item.name}
							{item.name === "Desktop" && (
								<span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-medium text-[10px] text-emerald-600 dark:text-emerald-400">
									Alpha
								</span>
							)}
							{item.name === "GitHub" && <StarCount variant="badge" showIcon />}
						</a>
					</li>
				))}
				{width > 0 && (
					<li
						style={{ left, width }}
						className="absolute inset-0 my-1.5 rounded-full bg-accent/60 border border-border"
					/>
				)}
			</ul>
		</div>
	)
}
