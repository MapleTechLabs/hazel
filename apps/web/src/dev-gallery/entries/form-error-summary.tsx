import { FormErrorSummary } from "~/components/ui/form-error-summary"
import { GallerySection } from "../frame"

export const title = "Form error summary"

export function Gallery() {
	return (
		<>
			<GallerySection title="Default title">
				<div className="w-96">
					<FormErrorSummary
						errors={[
							{ field: "Name", message: "Name is required." },
							{ field: "Email", message: "Enter a valid email address." },
						]}
					/>
				</div>
			</GallerySection>
			<GallerySection title="Custom title">
				<div className="w-96">
					<FormErrorSummary
						title="Could not save the channel"
						errors={[{ field: "Slug", message: "This slug is taken." }]}
					/>
				</div>
			</GallerySection>
			<GallerySection title="No errors">
				<FormErrorSummary errors={[]} />
			</GallerySection>
		</>
	)
}
