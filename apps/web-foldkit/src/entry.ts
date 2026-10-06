import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "./styles.css"

import { Runtime } from "foldkit"
import { init, Message, Model, subscriptions, update, view } from "./main"
import { HazelRpcLive } from "./rpc"

const application = Runtime.makeApplication({
	Model,
	init,
	update,
	view,
	subscriptions,
	resources: HazelRpcLive,
	container: document.getElementById("app")!,
	routing: {
		onUrlRequest: (request) => Message.ClickedLink({ request }),
		onUrlChange: (url) => Message.ChangedUrl({ url }),
	},
	devTools: { Message },
})

Runtime.run(application)
