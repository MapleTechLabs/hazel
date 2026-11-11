import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { PlatformCard } from "@/components/react/PlatformCard"
import { detectPlatform, downloadConfig, type Platform, type ReleaseData } from "@/lib/download-config"
import { cn } from "@/lib/utils"

interface PlatformDownloadSectionProps {
	release: ReleaseData | null
}

export function PlatformDownloadSection({ release }: PlatformDownloadSectionProps) {
	const [detectedPlatform, setDetectedPlatform] = useState<Platform | null>(null)
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		const { platform } = detectPlatform()
		setDetectedPlatform(platform)
		setIsLoading(false)
	}, [])

	const platforms: Platform[] = ["macos", "windows", "linux"]
	// Show all platforms except the detected one (which is shown in the hero)
	const otherPlatforms = detectedPlatform ? platforms.filter((p) => p !== detectedPlatform) : platforms

	// Show loading state briefly
	if (isLoading) {
		return (
			<section className="w-full max-w-4xl mx-auto px-4 py-12">
				<div className="animate-pulse">
					<div className="h-8 w-64 mx-auto bg-accent/50 rounded mb-4" />
					<div className="h-4 w-96 mx-auto bg-accent/30 rounded mb-8" />
					<div className="grid gap-4 md:grid-cols-2 max-w-2xl mx-auto">
						<div className="h-48 bg-accent/50 rounded-xl" />
						<div className="h-48 bg-accent/50 rounded-xl" />
					</div>
				</div>
			</section>
		)
	}

	return (
		<section className="w-full max-w-4xl mx-auto px-4 py-12">
			<motion.div
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4, delay: 0.1 }}
				className="mb-8 text-center"
			>
				<h2 className="text-xl font-medium tracking-tight text-foreground">
					Download for other platforms
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					{detectedPlatform
						? `Not on ${downloadConfig[detectedPlatform].name}? Get Hazel Desktop for your platform.`
						: "Select your operating system to download Hazel Desktop."}
				</p>
			</motion.div>

			<div
				className={cn(
					"grid gap-4 max-w-2xl mx-auto",
					otherPlatforms.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3",
				)}
			>
				{otherPlatforms.map((platform, index) => (
					<PlatformCard
						key={platform}
						platform={platform}
						config={downloadConfig[platform]}
						release={release}
						isPrimary={false}
						index={index}
					/>
				))}
			</div>

			{/* Additional info */}
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.4, delay: 0.5 }}
				className={cn(
					"mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground",
				)}
			>
				<a
					href="https://github.com/HazelChat/hazel/releases"
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1.5 hover:text-secondary transition-colors"
				>
					<svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
					</svg>
					View all releases
				</a>
				<span className="text-border">|</span>
				<a href="/changelog" className="hover:text-secondary transition-colors">
					What's new in this release
				</a>
			</motion.div>
		</section>
	)
}
