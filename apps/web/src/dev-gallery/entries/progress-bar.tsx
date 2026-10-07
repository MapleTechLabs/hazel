import {
	ProgressBar,
	ProgressBarHeader,
	ProgressBarTrack,
	ProgressBarValue,
} from "~/components/ui/progress-bar"
import { GallerySection } from "../frame"

export const title = "Progress bar"

export function Gallery() {
	return (
		<>
			<GallerySection title="Determinate">
				<div className="w-72">
					<ProgressBar aria-label="Uploading" value={40}>
						<ProgressBarHeader>
							<span>Uploading</span>
							<ProgressBarValue />
						</ProgressBarHeader>
						<ProgressBarTrack />
					</ProgressBar>
				</div>
				<div className="w-72">
					<ProgressBar aria-label="Empty" value={0}>
						<ProgressBarTrack />
					</ProgressBar>
				</div>
				<div className="w-72">
					<ProgressBar aria-label="Complete" value={100}>
						<ProgressBarHeader>
							<span>Complete</span>
							<ProgressBarValue />
						</ProgressBarHeader>
						<ProgressBarTrack className="bg-muted" />
					</ProgressBar>
				</div>
			</GallerySection>
			<GallerySection title="Indeterminate">
				<div className="w-72">
					<ProgressBar aria-label="Loading" isIndeterminate>
						<ProgressBarTrack />
					</ProgressBar>
				</div>
			</GallerySection>
		</>
	)
}
