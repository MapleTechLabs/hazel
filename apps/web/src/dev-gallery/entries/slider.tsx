import { Label } from "~/components/ui/field"
import { Slider, SliderOutput, SliderTrack } from "~/components/ui/slider"
import { GallerySection } from "../frame"

export const title = "Slider"

export function Gallery() {
	return (
		<>
			<GallerySection title="Sliders">
				<div className="w-72">
					<Slider defaultValue={40}>
						<div className="flex items-center justify-between">
							<Label>Volume</Label>
							<SliderOutput />
						</div>
						<SliderTrack />
					</Slider>
				</div>
				<div className="w-72">
					<Slider defaultValue={[20, 70]}>
						<div className="flex items-center justify-between">
							<Label>Price range</Label>
							<SliderOutput />
						</div>
						<SliderTrack />
					</Slider>
				</div>
			</GallerySection>
			<GallerySection title="States">
				<div className="w-72">
					<Slider defaultValue={60} isDisabled>
						<div className="flex items-center justify-between">
							<Label>Disabled</Label>
							<SliderOutput />
						</div>
						<SliderTrack />
					</Slider>
				</div>
				<div className="h-40">
					<Slider defaultValue={30} orientation="vertical" aria-label="Vertical">
						<SliderTrack />
					</Slider>
				</div>
			</GallerySection>
		</>
	)
}
