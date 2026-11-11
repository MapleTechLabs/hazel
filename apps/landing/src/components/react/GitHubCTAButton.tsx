import { GitHubStarsProvider } from "@/components/react/GitHubStarsProvider"
import { Icons } from "@/components/react/Icons"
import { StarCount } from "@/components/react/StarCount"

interface GitHubCTAButtonProps {
	href: string
	text: string
}

export function GitHubCTAButton({ href, text }: GitHubCTAButtonProps) {
	return (
		<GitHubStarsProvider>
			<a
				href={href}
				className="h-10 flex items-center justify-center gap-2 px-5 text-sm font-normal tracking-wide text-primary rounded-full transition-colors ease-out active:scale-95 bg-white dark:bg-background border border-[#E5E7EB] dark:border-[#27272A] hover:border-[#9CA3AF] dark:hover:border-[#52525B] hover:bg-white/80 dark:hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			>
				<Icons.github className="size-4" />
				{text}
				<StarCount variant="badge" showIcon />
			</a>
		</GitHubStarsProvider>
	)
}
