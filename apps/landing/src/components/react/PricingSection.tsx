import { siteConfig } from "@/lib/config"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

export function PricingSection() {
	const { pricing } = siteConfig

	return (
		<section
			id="pricing"
			className="flex flex-col items-center justify-center gap-10 pb-20 pt-10 px-6 md:px-0 w-full"
		>
			<div className="flex flex-col items-center gap-3">
				<h2 className="text-3xl md:text-4xl font-medium tracking-tighter text-center text-primary">
					{pricing.title}
				</h2>
				<p className="text-muted-foreground text-center max-w-xl">{pricing.description}</p>
			</div>

			<div className="flex justify-center max-w-sm w-full">
				{pricing.pricingItems.map((item) => (
					<div
						key={item.name}
						className="relative flex flex-col p-6 bg-background rounded-2xl border border-border w-full"
					>
						<div className="mb-4">
							<h3 className="text-lg font-semibold text-primary">{item.name}</h3>
							<p className="text-sm text-muted-foreground">{item.description}</p>
						</div>
						<div className="mb-6">
							<span className="text-4xl font-bold text-primary">{item.price}</span>
							<span className="text-muted-foreground">/{item.period}</span>
						</div>
						<ul className="space-y-3 mb-6 flex-grow">
							{item.features.map((feature) => (
								<li
									key={feature}
									className="flex items-center gap-2 text-sm text-muted-foreground"
								>
									<Check className="size-4 text-green-500 shrink-0" />
									{feature}
								</li>
							))}
						</ul>
						<a
							href={item.href}
							className={cn(
								"w-full h-10 flex items-center justify-center rounded-full text-sm font-medium transition-colors",
								item.buttonColor,
							)}
						>
							{item.buttonText}
						</a>
					</div>
				))}
			</div>
		</section>
	)
}
