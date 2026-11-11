import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { downloadConfig, type Platform } from "@/lib/download-config"

// Platform Icons (simplified versions)
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

const platformIcons: Record<Platform, React.FC<{ className?: string }>> = {
	macos: AppleIcon,
	windows: WindowsIcon,
	linux: LinuxIcon,
}

export function SystemRequirements() {
	const platforms: Platform[] = ["macos", "windows", "linux"]

	return (
		<Accordion type="single" collapsible defaultValue="macos" className="w-full">
			{platforms.map((platform) => {
				const config = downloadConfig[platform]
				const Icon = platformIcons[platform]
				const { requirements } = config

				return (
					<AccordionItem key={platform} value={platform}>
						<AccordionTrigger className="hover:no-underline">
							<div className="flex items-center gap-3">
								<Icon className="size-5 text-secondary" />
								<span>{config.name}</span>
							</div>
						</AccordionTrigger>
						<AccordionContent>
							<div className="grid gap-3 pl-8">
								<div className="flex items-start gap-3">
									<span className="text-muted-foreground min-w-[100px]">
										Operating System
									</span>
									<span className="text-foreground">{requirements.os}</span>
								</div>
								<div className="flex items-start gap-3">
									<span className="text-muted-foreground min-w-[100px]">Processor</span>
									<span className="text-foreground">{requirements.processor}</span>
								</div>
								<div className="flex items-start gap-3">
									<span className="text-muted-foreground min-w-[100px]">Memory</span>
									<span className="text-foreground">{requirements.memory}</span>
								</div>
								<div className="flex items-start gap-3">
									<span className="text-muted-foreground min-w-[100px]">Storage</span>
									<span className="text-foreground">{requirements.storage}</span>
								</div>
								{requirements.additional && (
									<div className="flex items-start gap-3">
										<span className="text-muted-foreground min-w-[100px]">
											Additional
										</span>
										<span className="text-foreground">{requirements.additional}</span>
									</div>
								)}
							</div>
						</AccordionContent>
					</AccordionItem>
				)
			})}
		</Accordion>
	)
}
