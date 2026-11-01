export type Platform = "macos" | "windows" | "linux"

// GitHub release types
export interface GitHubAsset {
	name: string
	browser_download_url: string
}

interface GitHubRelease {
	tag_name: string
	assets: GitHubAsset[]
	published_at: string
}

export interface ReleaseData {
	version: string
	assets: GitHubAsset[]
}

// Fetch latest release from GitHub API
export async function fetchLatestRelease(): Promise<ReleaseData | null> {
	try {
		const res = await fetch("https://api.github.com/repos/HazelChat/hazel/releases/latest")
		if (!res.ok) return null
		const data: GitHubRelease = await res.json()
		return {
			version: data.tag_name.replace(/^v/, ""),
			assets: data.assets,
		}
	} catch {
		return null
	}
}

// Find asset URL by pattern
export function findAssetUrl(assets: GitHubAsset[], pattern: RegExp): string | null {
	const asset = assets.find((a) => pattern.test(a.name))
	return asset?.browser_download_url ?? null
}

export interface ArchitectureOption {
	id: string
	label: string
	pattern: RegExp
	recommended?: boolean
}

export interface PlatformConfig {
	name: string
	icon: Platform
	architectures: ArchitectureOption[]
	requirements: {
		os: string
		processor: string
		memory: string
		storage: string
		additional?: string
	}
}

export const downloadConfig: Record<Platform, PlatformConfig> = {
	macos: {
		name: "macOS",
		icon: "macos",
		architectures: [
			{
				id: "arm64",
				label: "Apple Silicon (M1/M2/M3/M4)",
				pattern: /Hazel.*aarch64.*\.dmg$/i,
			},
			{
				id: "x64",
				label: "Intel",
				pattern: /Hazel.*x64.*\.dmg$/i,
			},
		],
		requirements: {
			os: "macOS 10.15 (Catalina) or later",
			processor: "Apple Silicon or Intel 64-bit",
			memory: "512 MB RAM",
			storage: "150 MB available space",
		},
	},
	windows: {
		name: "Windows",
		icon: "windows",
		architectures: [
			{
				id: "x64",
				label: "64-bit (x64)",
				pattern: /Hazel.*x64.*setup.*\.exe$/i,
				recommended: true,
			},
		],
		requirements: {
			os: "Windows 10 (1803) or later",
			processor: "64-bit processor",
			memory: "512 MB RAM",
			storage: "150 MB available space",
			additional: "WebView2 Runtime (auto-installed)",
		},
	},
	linux: {
		name: "Linux",
		icon: "linux",
		architectures: [
			{
				id: "appimage",
				label: "AppImage (Universal)",
				pattern: /Hazel.*\.AppImage$/i,
			},
			{
				id: "deb",
				label: "Debian/Ubuntu (.deb)",
				pattern: /Hazel.*\.deb$/i,
			},
		],
		requirements: {
			os: "Ubuntu 18.04+, Fedora 33+, or equivalent",
			processor: "64-bit processor",
			memory: "512 MB RAM",
			storage: "150 MB available space",
			additional: "WebKitGTK 4.1+",
		},
	},
}

// Get download URL for a specific architecture from release assets
export function getDownloadUrl(release: ReleaseData | null, arch: ArchitectureOption): string | null {
	if (!release) return null
	return findAssetUrl(release.assets, arch.pattern)
}

export function detectPlatform(): { platform: Platform | null; arch: string } {
	if (typeof window === "undefined") {
		return { platform: null, arch: "x64" }
	}

	const ua = navigator.userAgent.toLowerCase()
	const platform = navigator.platform?.toLowerCase() || ""

	// Detect OS
	if (platform.includes("mac") || ua.includes("mac")) {
		// Default to Apple Silicon since most modern Macs use it
		// Intel users can manually select their architecture
		return { platform: "macos", arch: "arm64" }
	}

	if (platform.includes("win") || ua.includes("win")) {
		return { platform: "windows", arch: "x64" }
	}

	if (platform.includes("linux") || ua.includes("linux")) {
		return { platform: "linux", arch: "x64" }
	}

	return { platform: null, arch: "x64" }
}
