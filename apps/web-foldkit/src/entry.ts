import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "./styles.css"

import { Layer } from "effect"
import { Runtime } from "foldkit"
import { setSessionBearerProvider } from "~/lib/session-bearer"
import { initTauri } from "~/lib/tauri"
import { isDesktop } from "./platform/desktop"
import { desktopSessionBearer } from "./platform/desktop-auth"
import { Flags, flags, init, Message, Model, subscriptions, update, view } from "./main"
import { NotificationSinks } from "./app/notification-sinks"
import { ResourcesLive } from "./rpc"
import * as PendingAnnouncement from "./ui/aria/pending-announcement"

const container = document.getElementById("app")!

const startApplication = () =>
	Runtime.run(
		Runtime.makeApplication({
			Model,
			Flags,
			init,
			update,
			view,
			subscriptions,
			// The sinks own audio and native notifications, so they are built here, in the browser only.
			resources: Layer.mergeAll(ResourcesLive, NotificationSinks.layer, PendingAnnouncement.layer),
			container,
			routing: {
				onUrlRequest: (request) => Message.ClickedLink({ request }),
				onUrlChange: (url) => Message.ChangedUrl({ url }),
			},
			devTools: { Message },
		}),
		{ flags },
	)

// The desktop app has no API cookie: its requests carry its own session as a bearer.
if (isDesktop) setSessionBearerProvider(desktopSessionBearer)
startApplication()
// Desktop only: native notification permission (a no-op in the browser).
void initTauri()
