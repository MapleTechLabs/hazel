import type { ReactNode } from "react"
import { galleryStyles } from "./gallery.styles"

/** Mirrored by `apps/web-foldkit/src/gallery/frame.ts`; the two must produce the same DOM. */
export function GalleryFrame({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className={galleryStyles.page}>
			<h1 className={galleryStyles.title}>{title}</h1>
			<div className={galleryStyles.sections}>{children}</div>
		</div>
	)
}

export function GallerySection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className={galleryStyles.section} aria-label={title}>
			<h2 className={galleryStyles.sectionTitle}>{title}</h2>
			<div className={galleryStyles.row}>{children}</div>
		</section>
	)
}
