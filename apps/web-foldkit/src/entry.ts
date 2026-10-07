import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "./styles.css"

import { Runtime } from "foldkit"
import { galleryComponentOf, startGallery } from "./gallery/boot"
import { init, Message, Model, subscriptions, update, view } from "./main"
import { HazelRpcLive } from "./rpc"

const container = document.getElementById("app")!

const startApplication = () =>
	Runtime.run(
		Runtime.makeApplication({
			Model,
			init,
			update,
			view,
			subscriptions,
			resources: HazelRpcLive,
			container,
			routing: {
				onUrlRequest: (request) => Message.ClickedLink({ request }),
				onUrlChange: (url) => Message.ChangedUrl({ url }),
			},
			devTools: { Message },
		}),
	)

// `/dev/gallery/<name>` boots one UI primitive's gallery program instead of the app (parity scenarios).
const galleryComponent = galleryComponentOf(location.pathname)
if (galleryComponent === undefined) startApplication()
else startGallery(galleryComponent, container)
