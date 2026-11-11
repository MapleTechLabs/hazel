"use client"

import { motion, useInView, useReducedMotion } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Icons } from "@/components/react/Icons"
import { cn } from "@/lib/utils"

function DiscordLogo({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 127.14 96.36" className={className} aria-hidden="true">
			<path
				fill="currentColor"
				d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
			/>
		</svg>
	)
}

function SlackLogo({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 124 124" className={className} aria-hidden="true">
			<g fill="currentColor">
				<path d="M26.4 78.4c0 7.2-5.8 13-13 13s-13-5.8-13-13 5.8-13 13-13h13v13zm6.5 0c0-7.2 5.8-13 13-13s13 5.8 13 13v32.5c0 7.2-5.8 13-13 13s-13-5.8-13-13V78.4z" />
				<path d="M45.9 26.4c-7.2 0-13-5.8-13-13s5.8-13 13-13 13 5.8 13 13v13H45.9zm0 6.5c7.2 0 13 5.8 13 13s-5.8 13-13 13H13.4c-7.2 0-13-5.8-13-13s5.8-13 13-13h32.5z" />
				<path d="M97.9 45.9c0-7.2 5.8-13 13-13s13 5.8 13 13-5.8 13-13 13h-13V45.9zm-6.5 0c0 7.2-5.8 13-13 13s-13-5.8-13-13V13.4c0-7.2 5.8-13 13-13s13 5.8 13 13v32.5z" />
				<path d="M78.4 97.9c7.2 0 13 5.8 13 13s-5.8 13-13 13-13-5.8-13-13v-13h13zm0-6.5c-7.2 0-13-5.8-13-13s5.8-13 13-13h32.5c7.2 0 13 5.8 13 13s-5.8 13-13 13H78.4z" />
			</g>
		</svg>
	)
}

interface PlatformNodeProps {
	icon: React.ReactNode
	label: string
	position: "left" | "right"
	iconBg: string
	delay: number
}

function PlatformNode({ icon, label, position, iconBg, delay }: PlatformNodeProps) {
	return (
		<motion.div
			className={cn(
				"absolute flex flex-col items-center gap-2",
				position === "left" ? "left-4 md:left-8" : "right-4 md:right-8",
			)}
			style={{ top: "50%", transform: "translateY(-50%)" }}
			initial={{ opacity: 0, scale: 0.8, y: "-50%" }}
			animate={{ opacity: 1, scale: 1, y: "-50%" }}
			transition={{
				duration: 0.5,
				delay,
				type: "spring",
				stiffness: 200,
				damping: 20,
			}}
		>
			<div
				className={cn(
					"relative size-14 md:size-16 rounded-2xl flex items-center justify-center",
					"backdrop-blur-md bg-white/80 dark:bg-white/10",
					"border border-white/50 dark:border-white/20",
					"shadow-lg shadow-black/5 dark:shadow-black/20",
				)}
			>
				<div className={cn("size-10 md:size-11 rounded-xl flex items-center justify-center", iconBg)}>
					{icon}
				</div>
			</div>
			<span className="text-sm font-medium text-muted-foreground">{label}</span>
		</motion.div>
	)
}

function HazelHub({ delay }: { delay: number }) {
	const prefersReducedMotion = useReducedMotion()

	return (
		<motion.div
			className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2"
			initial={{ opacity: 0, scale: 0 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{
				duration: 0.6,
				delay,
				type: "spring",
				stiffness: 150,
				damping: 15,
			}}
		>
			<div className="relative">
				{/* Outer glow - smaller on mobile */}
				<motion.div
					className="absolute inset-0 rounded-full bg-secondary/40 blur-xl md:blur-2xl"
					style={{ scale: 1.5 }}
					animate={
						prefersReducedMotion
							? {}
							: {
									opacity: [0.4, 0.6, 0.4],
									scale: [1.4, 1.6, 1.4],
								}
					}
					transition={{
						duration: 3,
						repeat: Number.POSITIVE_INFINITY,
						ease: "easeInOut",
					}}
				/>

				{/* Hub container */}
				<motion.div
					className={cn(
						"relative size-20 md:size-24 rounded-full",
						"bg-secondary flex items-center justify-center",
						"shadow-[0_0_60px_rgba(224,125,84,0.3)]",
					)}
					animate={
						prefersReducedMotion
							? {}
							: {
									scale: [1, 1.03, 1],
								}
					}
					transition={{
						duration: 3,
						repeat: Number.POSITIVE_INFINITY,
						ease: "easeInOut",
					}}
				>
					<Icons.logo className="size-12 md:size-14 text-white [&_path]:fill-white" />
				</motion.div>
			</div>
			<span className="text-sm font-semibold text-foreground mt-1">Hazel</span>
		</motion.div>
	)
}

// Animated particle component that travels along a line path
function LineParticle({
	delay,
	duration,
	fromX,
	toX,
	color,
}: {
	delay: number
	duration: number
	fromX: number
	toX: number
	color: string
}) {
	const prefersReducedMotion = useReducedMotion()
	if (prefersReducedMotion) return null

	return (
		<motion.div
			className="absolute size-2.5 rounded-full"
			style={{
				background: color,
				boxShadow: `0 0 10px ${color}, 0 0 20px ${color}`,
				top: "50%",
				translateY: "-50%",
			}}
			initial={{ x: fromX, opacity: 0, scale: 0 }}
			animate={{
				x: [fromX, toX],
				opacity: [0, 1, 1, 0],
				scale: [0.5, 1, 1, 0.5],
			}}
			transition={{
				duration,
				delay,
				repeat: Number.POSITIVE_INFINITY,
				ease: "easeInOut",
			}}
		/>
	)
}

function LineParticleSystem({ leftEdge, rightEdge }: { leftEdge: number; rightEdge: number }) {
	const prefersReducedMotion = useReducedMotion()

	const particles = useMemo(() => {
		if (prefersReducedMotion) return []

		return [
			// Discord to Hazel (Discord is on LEFT, negative X)
			{
				id: "discord-to-hazel-1",
				delay: 0,
				duration: 2.5,
				fromX: leftEdge,
				toX: -48,
				color: "#5865F2",
			},
			{
				id: "discord-to-hazel-2",
				delay: 1.25,
				duration: 2.5,
				fromX: leftEdge,
				toX: -48,
				color: "#5865F2",
			},
			// Hazel to Discord
			{
				id: "hazel-to-discord-1",
				delay: 0.6,
				duration: 2.5,
				fromX: -48,
				toX: leftEdge,
				color: "#E07D54",
			},
			{
				id: "hazel-to-discord-2",
				delay: 1.85,
				duration: 2.5,
				fromX: -48,
				toX: leftEdge,
				color: "#E07D54",
			},
			// Slack to Hazel (Slack is on RIGHT, positive X)
			{
				id: "slack-to-hazel-1",
				delay: 0.3,
				duration: 2.5,
				fromX: rightEdge,
				toX: 48,
				color: "#2EB67D",
			},
			{
				id: "slack-to-hazel-2",
				delay: 1.55,
				duration: 2.5,
				fromX: rightEdge,
				toX: 48,
				color: "#2EB67D",
			},
			// Hazel to Slack
			{
				id: "hazel-to-slack-1",
				delay: 0.9,
				duration: 2.5,
				fromX: 48,
				toX: rightEdge,
				color: "#E07D54",
			},
			{
				id: "hazel-to-slack-2",
				delay: 2.15,
				duration: 2.5,
				fromX: 48,
				toX: rightEdge,
				color: "#E07D54",
			},
		]
	}, [prefersReducedMotion, leftEdge, rightEdge])

	if (prefersReducedMotion) return null

	return (
		<div className="absolute left-1/2 top-0 h-full pointer-events-none">
			{particles.map((p) => (
				<LineParticle
					key={p.id}
					delay={p.delay}
					duration={p.duration}
					fromX={p.fromX}
					toX={p.toX}
					color={p.color}
				/>
			))}
		</div>
	)
}

// Connection line between nodes
function ConnectionLine({ fromX, toX, delay }: { fromX: number; toX: number; delay: number }) {
	const width = Math.abs(toX - fromX)
	const left = Math.min(fromX, toX)

	return (
		<motion.div
			className="absolute top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border/40 to-transparent"
			style={{
				left: `calc(50% + ${left}px)`,
				width,
			}}
			initial={{ opacity: 0, scaleX: 0 }}
			animate={{ opacity: 1, scaleX: 1 }}
			transition={{ duration: 0.6, delay }}
		/>
	)
}

export function PremiumSyncAnimation() {
	const containerRef = useRef<HTMLDivElement>(null)
	const isInView = useInView(containerRef, { once: true, margin: "-100px" })
	const [containerWidth, setContainerWidth] = useState(600)

	// biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure when visibility changes
	useEffect(() => {
		const updateWidth = () => {
			if (containerRef.current) {
				setContainerWidth(containerRef.current.offsetWidth)
			}
		}

		const timer = setTimeout(updateWidth, 50)
		window.addEventListener("resize", updateWidth)
		return () => {
			clearTimeout(timer)
			window.removeEventListener("resize", updateWidth)
		}
	}, [isInView])

	// Icons are positioned with spacing from edges
	// Calculate distance from center to icon centers, accounting for padding and icon size
	const isMobile = containerWidth < 768
	const iconOffset = containerWidth / 2 - (isMobile ? 56 : 48) // More offset on mobile for breathing room

	if (!isInView) {
		return <div ref={containerRef} className="relative w-full h-[280px] md:h-[360px]" />
	}

	return (
		<div
			ref={containerRef}
			className="relative w-full h-[280px] md:h-[360px] flex items-center justify-center px-4 md:px-0"
		>
			{/* Background glow */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(224,125,84,0.08)_0%,transparent_70%)]" />

			{/* Connection lines */}
			<ConnectionLine fromX={-iconOffset} toX={-48} delay={0.3} />
			<ConnectionLine fromX={48} toX={iconOffset} delay={0.3} />

			{/* Particle system */}
			<LineParticleSystem leftEdge={-iconOffset} rightEdge={iconOffset} />

			{/* Central Hazel Hub */}
			<HazelHub delay={0} />

			{/* Platform Nodes */}
			<PlatformNode
				icon={<DiscordLogo className="size-6 md:size-7 text-white" />}
				label="Discord"
				position="left"
				iconBg="bg-[#5865F2]"
				delay={0.2}
			/>

			<PlatformNode
				icon={<SlackLogo className="size-6 md:size-7 text-white" />}
				label="Slack"
				position="right"
				iconBg="bg-gradient-to-br from-[#E01E5A] via-[#ECB22E] to-[#2EB67D]"
				delay={0.3}
			/>
		</div>
	)
}

export function SyncSection() {
	return (
		<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full">
			{/* Left: Animation */}
			<div className="w-full">
				<PremiumSyncAnimation />
			</div>

			{/* Right: Feature cards */}
			<div className="flex flex-col gap-4 px-4 lg:px-0 lg:pr-6">
				<FeatureCard
					icon={
						<svg
							className="size-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
						>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					}
					title="Message Sync"
					description="Every message syncs instantly. Edit in Discord, see it update in Hazel. Reply from Slack, your team sees it everywhere."
				/>
				<FeatureCard
					icon={
						<svg
							className="size-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
						>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
							<path d="M8 10h8" />
							<path d="M8 14h4" />
						</svg>
					}
					title="Thread Continuity"
					description="Threaded conversations stay connected. Start a thread in Slack, continue it in Hazel with full context preserved."
				/>
				<FeatureCard
					icon={
						<svg
							className="size-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
						>
							<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
						</svg>
					}
					title="Reaction Sync"
					description="Reactions travel across platforms. React with an emoji in Discord, it appears in Hazel and Slack instantly."
				/>
			</div>
		</div>
	)
}

function FeatureCard({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode
	title: string
	description: string
}) {
	return (
		<div className="flex gap-4 p-4 rounded-2xl border border-border/50 hover:border-border hover:shadow-lg transition-all duration-200 bg-card/50">
			<div className="shrink-0 size-11 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary">
				{icon}
			</div>
			<div>
				<h3 className="font-semibold text-foreground mb-1">{title}</h3>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
		</div>
	)
}
