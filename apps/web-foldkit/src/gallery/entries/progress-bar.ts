import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { progressBar, progressBarHeader, progressBarTrack, progressBarValue } from "../../ui/progress-bar"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGallery: {} })
type Message = typeof Message.Type

const view = (_model: Model, h: HtmlBuilder<Message>) => {
	const sized = (child: ReturnType<typeof progressBar>) => h.div([h.Class("w-72")], [child])
	return galleryFrame(h, "Progress bar", [
		gallerySection(h, "Determinate", [
			sized(
				progressBar(h, { ariaLabel: "Uploading", value: 40 }, [
					progressBarHeader(h, {}, [h.span([], ["Uploading"]), progressBarValue(h, { value: 40 })]),
					progressBarTrack(h, { value: 40 }),
				]),
			),
			sized(progressBar(h, { ariaLabel: "Empty", value: 0 }, [progressBarTrack(h, { value: 0 })])),
			sized(
				progressBar(h, { ariaLabel: "Complete", value: 100 }, [
					progressBarHeader(h, {}, [h.span([], ["Complete"]), progressBarValue(h, { value: 100 })]),
					progressBarTrack(h, { value: 100, className: "bg-muted" }),
				]),
			),
		]),
		gallerySection(h, "Indeterminate", [
			sized(
				progressBar(h, { ariaLabel: "Loading", isIndeterminate: true }, [
					progressBarTrack(h, { isIndeterminate: true }),
				]),
			),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Progress bar", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
