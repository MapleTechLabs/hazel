import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	detectPlatform,
	downloadConfig,
	getDownloadUrl,
	type Platform,
	type ReleaseData,
	useLatestRelease,
} from "@/lib/download-config"
import { cn } from "@/lib/utils"

interface HeroDownloadButtonProps {
	release: ReleaseData | null
}

// Platform Icons
function AppleIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
		</svg>
	)
}

function WindowsIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M3 12V6.75l6-1.32v6.48L3 12zm17-9v8.75l-10 .15V5.21L20 3zM3 13l6 .09v6.81l-6-1.15V13zm17 .25V22l-10-1.91V13.1l10 .15z" />
		</svg>
	)
}

function LinuxIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139z" />
		</svg>
	)
}

function DownloadIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M12 3v12m0 0l-4-4m4 4l4-4M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"
			/>
		</svg>
	)
}

const platformIcons: Record<Platform, React.FC<{ className?: string }>> = {
	macos: AppleIcon,
	windows: WindowsIcon,
	linux: LinuxIcon,
}

export function HeroDownloadButton({ release: builtRelease }: HeroDownloadButtonProps) {
	const release = useLatestRelease(builtRelease)
	const [platform, setPlatform] = useState<Platform | null>(null)
	const [selectedArchId, setSelectedArchId] = useState<string>("")

	useEffect(() => {
		const detected = detectPlatform()
		setPlatform(detected.platform)

		// Set default architecture
		if (detected.platform) {
			const config = downloadConfig[detected.platform]
			const defaultArch =
				config.architectures.find((a) => a.id === detected.arch) ||
				config.architectures.find((a) => a.recommended) ||
				config.architectures[0]
			setSelectedArchId(defaultArch.id)
		}
	}, [])

	// Show loading state until platform is detected
	if (!platform) {
		return (
			<div className="w-full max-w-md mx-auto animate-pulse">
				<div className="h-32 bg-accent/50 rounded-xl" />
			</div>
		)
	}

	const config = downloadConfig[platform]
	const Icon = platformIcons[platform]
	const selectedArch = config.architectures.find((a) => a.id === selectedArchId) || config.architectures[0]
	const downloadUrl = getDownloadUrl(release, selectedArch)
	const hasRelease = release !== null && downloadUrl !== null

	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
			className="w-full max-w-md mx-auto"
		>
			<div
				className={cn(
					"relative flex flex-col items-center gap-4 p-6 rounded-2xl",
					"border border-secondary/30 bg-accent/30 backdrop-blur-sm",
					"shadow-[0_0_40px_rgba(215,140,80,0.15)]",
				)}
			>
				{/* Glow effect */}
				<div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-secondary/10 to-transparent" />

				{/* Platform header */}
				<div className="relative flex items-center gap-3">
					<div className="flex items-center justify-center rounded-xl bg-secondary/20 p-2.5">
						<Icon className="size-7 text-secondary" />
					</div>
					<div className="flex flex-col">
						<span className="text-xl font-semibold text-foreground">
							Download for {config.name}
						</span>
						<span className="text-sm text-muted-foreground">
							{hasRelease ? `Version ${release.version}` : "Coming Soon"}
						</span>
					</div>
				</div>

				{/* Architecture selector (if multiple options and release exists) */}
				{hasRelease && config.architectures.length > 1 && (
					<>
						<label htmlFor="hero-arch-select" className="sr-only">
							Select architecture for {config.name}
						</label>
						<select
							id="hero-arch-select"
							name="architecture"
							autoComplete="off"
							value={selectedArchId}
							onChange={(e) => setSelectedArchId(e.target.value)}
							className={cn(
								"w-full rounded-lg border border-border bg-background px-3 py-2",
								"text-sm text-foreground",
								"focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary",
							)}
						>
							{config.architectures.map((archOption) => (
								<option key={archOption.id} value={archOption.id}>
									{archOption.label}
									{archOption.recommended ? " (Recommended)" : ""}
								</option>
							))}
						</select>
					</>
				)}

				{/* Big download button */}
				{hasRelease ? (
					<Button
						asChild
						variant="secondary"
						size="lg"
						className="relative w-full h-12 text-base font-medium shadow-lg"
					>
						<a href={downloadUrl} download className="gap-2">
							<DownloadIcon className="size-5" />
							Download Now
						</a>
					</Button>
				) : (
					<Button
						variant="secondary"
						size="lg"
						disabled
						className="relative w-full h-12 text-base font-medium opacity-60"
					>
						<DownloadIcon className="size-5" />
						Coming Soon
					</Button>
				)}
			</div>
		</motion.div>
	)
}
