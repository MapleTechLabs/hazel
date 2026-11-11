import { siteConfig } from "@/lib/config"

const { companyShowcase } = siteConfig

export function CompanyShowcaseComp() {
	return (
		<div className="z-20 grid w-full max-w-7xl grid-cols-2 items-center justify-center overflow-hidden border-border border-y md:grid-cols-4">
			{companyShowcase.companyLogos.map((logo) => (
				<a
					href={logo.href}
					className="group before:-left-1 after:-top-1 relative flex h-28 w-full items-center justify-center p-4 before:absolute before:top-0 before:z-10 before:h-screen before:w-px before:bg-border before:content-[''] after:absolute after:left-0 after:z-10 after:h-px after:w-screen after:bg-border after:content-['']"
					key={logo.id}
				>
					<div className="transition-all duration-200 [cubic-bezier(0.165,0.84,0.44,1)] translate-y-0 group-hover:-translate-y-4 duration-300 flex items-center justify-center w-full h-full">
						{logo.logo}
					</div>
					<div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-8 group-hover:translate-y-4 transition-all duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)]">
						<span className="flex items-center gap-2 text-sm font-medium text-secondary">
							Learn More
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="w-4 h-4"
							>
								<path d="M5 12h14"></path>
								<path d="m12 5 7 7-7 7"></path>
							</svg>
						</span>
					</div>
				</a>
			))}
		</div>
	)
}
