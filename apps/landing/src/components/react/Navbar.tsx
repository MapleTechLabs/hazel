import { GitHubStarsProvider } from "@/components/react/GitHubStarsProvider"
import { Icons } from "@/components/react/Icons"
import { NavMenu } from "@/components/react/NavMenu"
import { StarCount } from "@/components/react/StarCount"
// import { ThemeToggle } from "@/components/react/ThemeToggle"
import { siteConfig } from "@/lib/config"
import { cn } from "@/lib/utils"
import { Download, Menu, X } from "lucide-react"
import { AnimatePresence, type Variants, motion } from "motion/react"
import { useEffect, useState } from "react"

const INITIAL_WIDTH = "70rem"
const MAX_WIDTH = "900px"

// Animation variants
const overlayVariants = {
	hidden: { opacity: 0 },
	visible: { opacity: 1 },
	exit: { opacity: 0 },
}

const drawerVariants = {
	hidden: { opacity: 0, y: 100 },
	visible: {
		opacity: 1,
		y: 0,
		rotate: 0,
		transition: {
			type: "spring",
			damping: 15,
			stiffness: 200,
			staggerChildren: 0.03,
		},
	},
	exit: {
		opacity: 0,
		y: 100,
		transition: { duration: 0.1 },
	},
} satisfies Variants

const drawerMenuContainerVariants = {
	hidden: { opacity: 0 },
	visible: { opacity: 1 },
}

const drawerMenuVariants = {
	hidden: { opacity: 0 },
	visible: { opacity: 1 },
}

interface NavbarProps {
	currentPath: string
}

export function Navbar({ currentPath }: NavbarProps) {
	const [hasScrolled, setHasScrolled] = useState(false)
	const [isDrawerOpen, setIsDrawerOpen] = useState(false)
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

	const isActive = (href: string) => {
		if (href.startsWith("http")) return false
		if (href === "/") return currentPath === "/"
		return currentPath.startsWith(href)
	}

	useEffect(() => {
		const handleScroll = () => {
			const scrolled = window.scrollY > 10
			setHasScrolled(scrolled)
		}

		window.addEventListener("scroll", handleScroll, { passive: true })
		handleScroll() // Initial check

		return () => window.removeEventListener("scroll", handleScroll)
	}, [])

	useEffect(() => {
		if (!contextMenu) return

		const handleClick = () => setContextMenu(null)
		const handleScroll = () => setContextMenu(null)

		document.addEventListener("click", handleClick)
		document.addEventListener("scroll", handleScroll, true)

		return () => {
			document.removeEventListener("click", handleClick)
			document.removeEventListener("scroll", handleScroll, true)
		}
	}, [contextMenu])

	const toggleDrawer = () => setIsDrawerOpen((prev) => !prev)
	const handleOverlayClick = () => setIsDrawerOpen(false)

	const handleLogoContextMenu = (e: React.MouseEvent) => {
		e.preventDefault()
		setContextMenu({ x: e.clientX, y: e.clientY })
	}

	const handleDownloadLogo = () => {
		const link = document.createElement("a")
		link.href = "/icon.svg"
		link.download = "hazel-logo.svg"
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
		setContextMenu(null)
	}

	return (
		<GitHubStarsProvider>
			<header
				className={cn(
					"sticky z-50 mx-4 flex justify-center transition-[top,margin] duration-300 md:mx-0",
					hasScrolled ? "top-6" : "top-4 mx-0",
				)}
				data-scrolled={hasScrolled ? "true" : "false"}
			>
				<motion.div
					initial={false}
					animate={{ width: hasScrolled ? MAX_WIDTH : INITIAL_WIDTH }}
					transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
					style={{ width: INITIAL_WIDTH }}
				>
					<div
						className={cn(
							"mx-auto max-w-7xl rounded-2xl transition-[border-color,background-color,padding,box-shadow,backdrop-filter] duration-300 xl:px-0",
							hasScrolled
								? "border border-border bg-background/75 px-2 backdrop-blur-lg"
								: "px-7 shadow-none",
						)}
					>
						<div className="flex h-[56px] items-center justify-between p-4">
							<a
								href="/"
								className="flex items-center gap-3"
								onContextMenu={handleLogoContextMenu}
							>
								<Icons.logo className="size-7 md:size-10" />
								<p className="font-semibold text-lg text-primary">Hazel</p>
							</a>

							<NavMenu currentPath={currentPath} hasScrolled={hasScrolled} />

							<div className="flex shrink-0 flex-row items-center gap-1 md:gap-3">
								<div className="flex items-center space-x-6">
									<a
										className="hidden h-8 w-fit items-center justify-center rounded-full border border-white/[0.12] bg-secondary px-4 font-normal text-primary-foreground text-sm tracking-wide shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] md:flex dark:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
										href="https://app.hazel.sh"
									>
										Try for free
									</a>
								</div>
								{/* <ThemeToggle /> */}
								<button
									type="button"
									aria-label={isDrawerOpen ? "Close menu" : "Open menu"}
									className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border md:hidden"
									onClick={toggleDrawer}
								>
									{isDrawerOpen ? (
										<X className="size-5" aria-hidden="true" />
									) : (
										<Menu className="size-5" aria-hidden="true" />
									)}
								</button>
							</div>
						</div>
					</div>
				</motion.div>

				{/* Mobile Drawer */}
				<AnimatePresence>
					{isDrawerOpen && (
						<>
							<motion.div
								className="fixed inset-0 bg-black/50 backdrop-blur-sm"
								initial="hidden"
								animate="visible"
								exit="exit"
								variants={overlayVariants}
								transition={{ duration: 0.2 }}
								onClick={handleOverlayClick}
							/>

							<motion.div
								className="fixed inset-x-0 bottom-3 mx-auto w-[95%] rounded-xl border border-border bg-background p-4 shadow-lg"
								initial="hidden"
								animate="visible"
								exit="exit"
								variants={drawerVariants}
							>
								{/* Mobile menu content */}
								<div className="flex flex-col gap-4">
									<div className="flex items-center justify-between">
										<a
											href="/"
											className="flex items-center gap-3"
											onContextMenu={handleLogoContextMenu}
										>
											<Icons.logo className="size-7 md:size-10" />
											<p className="font-semibold text-lg text-primary">Hazel</p>
										</a>
										<button
											type="button"
											aria-label="Close menu"
											onClick={toggleDrawer}
											className="cursor-pointer rounded-md border border-border p-1"
										>
											<X className="size-5" aria-hidden="true" />
										</button>
									</div>

									<motion.ul
										className="mb-4 flex flex-col rounded-md border border-border text-sm"
										variants={drawerMenuContainerVariants}
									>
										<AnimatePresence>
											{siteConfig.nav.links.map((item) => (
												<motion.li
													key={item.id}
													className="border-border border-b p-2.5 last:border-b-0"
													variants={drawerMenuVariants}
												>
													<a
														href={item.href}
														onClick={(e) => {
															// Only intercept hash links for smooth scrolling
															if (!item.href.startsWith("#")) {
																setIsDrawerOpen(false)
																return // Allow normal navigation
															}
															e.preventDefault()
															const element = document.getElementById(
																item.href.substring(1),
															)
															element?.scrollIntoView({ behavior: "smooth" })
															setIsDrawerOpen(false)
														}}
														className={`flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-primary/80 ${
															isActive(item.href)
																? "font-medium text-primary"
																: "text-primary/60"
														}`}
													>
														{item.name === "GitHub" && <Icons.github />}
														{item.name}
														{item.name === "Desktop" && (
															<span className="ml-auto rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-medium text-[10px] text-emerald-600 dark:text-emerald-400">
																Alpha
															</span>
														)}
														{item.name === "GitHub" && (
															<StarCount
																variant="badge"
																showIcon
																className="ml-auto"
															/>
														)}
													</a>
												</motion.li>
											))}
										</AnimatePresence>
									</motion.ul>

									{/* Action buttons */}
									<div className="flex flex-col gap-2">
										<a
											href="https://app.hazel.sh"
											className="flex h-8 w-full items-center justify-center rounded-full border border-white/[0.12] bg-secondary px-4 font-normal text-primary-foreground text-sm tracking-wide shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] transition-all ease-out hover:bg-secondary/80 active:scale-95 dark:text-secondary-foreground"
										>
											Try for free
										</a>
									</div>
								</div>
							</motion.div>
						</>
					)}
				</AnimatePresence>

				{/* Logo Context Menu */}
				<AnimatePresence>
					{contextMenu && (
						<motion.div
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.95 }}
							transition={{ duration: 0.1 }}
							className="fixed z-[100] rounded-lg border border-border bg-background p-1 shadow-lg"
							style={{ left: contextMenu.x, top: contextMenu.y }}
						>
							<button
								type="button"
								aria-label="Download Hazel logo as SVG"
								onClick={handleDownloadLogo}
								className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-primary text-sm hover:bg-muted"
							>
								<Download className="size-4" aria-hidden="true" />
								Download Logo as SVG
							</button>
						</motion.div>
					)}
				</AnimatePresence>
			</header>
		</GitHubStarsProvider>
	)
}
