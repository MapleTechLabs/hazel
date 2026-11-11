import { siteConfig } from "@/lib/config"
import { Marquee } from "@/components/ui/marquee"
import { cn } from "@/lib/utils"

const firstRow = siteConfig.testimonials.slice(0, siteConfig.testimonials.length / 2)
const secondRow = siteConfig.testimonials.slice(siteConfig.testimonials.length / 2)

function TestimonialCard({
	img,
	name,
	role,
	description,
}: {
	img: string
	name: string
	role: string
	description: React.ReactNode
}) {
	return (
		<figure
			className={cn(
				"relative w-80 shrink-0 cursor-pointer overflow-hidden rounded-xl border p-4",
				"border-border bg-background hover:bg-accent/50",
				"transition-colors duration-200",
			)}
		>
			<div className="flex flex-row items-center gap-3">
				<img className="rounded-full size-10" width={40} height={40} alt={name} src={img} />
				<div className="flex flex-col">
					<figcaption className="text-sm font-medium text-primary">{name}</figcaption>
					<p className="text-xs text-muted-foreground">{role}</p>
				</div>
			</div>
			<blockquote className="mt-3 text-sm text-muted-foreground leading-relaxed">
				{description}
			</blockquote>
		</figure>
	)
}

export function TestimonialSection() {
	return (
		<section
			id="testimonials"
			className="flex flex-col items-center justify-center gap-10 py-20 w-full overflow-hidden"
		>
			<div className="flex flex-col items-center gap-3 px-6">
				<h2 className="text-3xl md:text-4xl font-medium tracking-tighter text-center text-primary">
					Loved by developers worldwide
				</h2>
				<p className="text-muted-foreground text-center max-w-xl">
					Join thousands of teams who have made Hazel their home for collaboration.
				</p>
			</div>

			<div className="relative flex w-full flex-col items-center justify-center overflow-hidden">
				<Marquee pauseOnHover className="[--duration:60s]">
					{firstRow.map((testimonial) => (
						<TestimonialCard key={testimonial.id} {...testimonial} />
					))}
				</Marquee>
				<Marquee reverse pauseOnHover className="[--duration:60s]">
					{secondRow.map((testimonial) => (
						<TestimonialCard key={testimonial.id} {...testimonial} />
					))}
				</Marquee>
				<div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-background" />
				<div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-background" />
			</div>
		</section>
	)
}
