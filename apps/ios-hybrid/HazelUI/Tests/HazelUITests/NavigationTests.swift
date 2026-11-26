import SwiftUI
import UIKit
import XCTest
@testable import HazelUI

/// Lane S4: `hz:navigation` keeps its children (the route) and the `NavigationStack` in sync both
/// ways. A push from the Model shows natively; a native pop raises `pop` so the Model can follow.
@MainActor
final class NavigationTests: XCTestCase {
    private var window: UIWindow?

    override func tearDown() async throws {
        window?.isHidden = true
        window = nil
    }

    func testRouteChange() {
        XCTAssertEqual(NavigationRoute.path(of: [1, 2, 3]), [2, 3])
        XCTAssertEqual(NavigationRoute.change(route: [1, 2, 3], path: [2, 3]), .none)
        XCTAssertEqual(NavigationRoute.change(route: [1, 2, 3], path: [2]), .pop(depth: 1))
        XCTAssertEqual(NavigationRoute.change(route: [1, 2, 3], path: []), .pop(depth: 2))
        XCTAssertEqual(NavigationRoute.change(route: [1, 2], path: [2, 9]), .resync)
        XCTAssertEqual(NavigationRoute.change(route: [1, 2, 3], path: [3]), .resync)
    }

    /// Ids: 1 navigation, 2 root screen, 3 its text; 10 the pushed screen, 11 its text.
    private func mount(handlesPop: Bool) -> Data {
        var ops = [
            #"["create",1,"hz:navigation"]"#,
            #"["create",2,"hz:screen"]"#, #"["props",2,{"title":"Channels"}]"#,
            #"["create",3,"hz:text"]"#, #"["text",3,"root"]"#, #"["insert",2,3,null]"#,
            #"["insert",1,2,null]"#, #"["insert",0,1,null]"#,
        ]
        if handlesPop { ops.insert(#"["events",1,["pop"]]"#, at: 1) }
        return Fixture.batch(seq: 1, ops: ops)
    }

    private let push = Fixture.batch(seq: 2, ops: [
        #"["create",10,"hz:screen"]"#, #"["props",10,{"title":"general","back":true}]"#,
        #"["create",11,"hz:text"]"#, #"["text",11,"pushed"]"#, #"["insert",10,11,null]"#,
        #"["insert",1,10,null]"#,
    ])

    private func host(_ tree: Tree) async -> UIViewController {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        let controller = UIHostingController(rootView: TreeView(tree: tree))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        await settle(controller)
        return controller
    }

    private func settle(_ controller: UIViewController, rounds: Int = 6) async {
        for _ in 0..<rounds {
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    /// The `UINavigationController` SwiftUI hosts the stack in.
    private func stack(in controller: UIViewController) -> UINavigationController? {
        if let nav = controller as? UINavigationController { return nav }
        for child in controller.children { if let nav = stack(in: child) { return nav } }
        return nil
    }

    private func pops(_ sent: [Inbound]) -> [JSONValue] {
        sent.compactMap { if case let .fire(1, "pop", payload, _) = $0 { payload } else { nil } }
    }

    func testModelPushShowsAndNativePopRaisesPop() async throws {
        let tree = Tree()
        var sent: [Inbound] = []
        tree.outbound = { sent.append($0) }
        try tree.apply(WireDecoder.decode(mount(handlesPop: true)))
        let controller = await host(tree)
        let nav = try XCTUnwrap(stack(in: controller), "a NavigationStack hosts a UINavigationController")
        XCTAssertEqual(nav.viewControllers.count, 1)

        // Model to native: the Model pushes a screen; the stack shows it.
        try tree.apply(WireDecoder.decode(push))
        await settle(controller)
        XCTAssertEqual(nav.viewControllers.count, 2, "a push from the Model shows natively")
        XCTAssertEqual(pops(sent), [])

        // Native to Model: the system back (a swipe or the back button) pops; `pop {depth: 1}` goes out.
        nav.popViewController(animated: false)
        await settle(controller)
        XCTAssertEqual(pops(sent), [["depth": 1]], "a native pop raises pop")
        XCTAssertEqual(nav.viewControllers.count, 1)

        // The Model follows: it removes the screen, and nothing more is raised or pushed.
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 3, ops: [#"["remove",10]"#])))
        await settle(controller)
        XCTAssertEqual(nav.viewControllers.count, 1)
        XCTAssertEqual(pops(sent), [["depth": 1]])

        // And a second push still shows.
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 4, ops: [
            #"["create",20,"hz:screen"]"#, #"["props",20,{"title":"design"}]"#, #"["insert",1,20,null]"#,
        ])))
        await settle(controller)
        XCTAssertEqual(nav.viewControllers.count, 2)
    }

    func testModelPopShowsWithoutRaisingPop() async throws {
        let tree = Tree()
        var sent: [Inbound] = []
        tree.outbound = { sent.append($0) }
        try tree.apply(WireDecoder.decode(mount(handlesPop: true)))
        try tree.apply(WireDecoder.decode(push))
        let controller = await host(tree)
        let nav = try XCTUnwrap(stack(in: controller))
        XCTAssertEqual(nav.viewControllers.count, 2, "a route of two mounts pushed")

        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 3, ops: [#"["remove",10]"#])))
        await settle(controller)
        XCTAssertEqual(nav.viewControllers.count, 1, "a pop from the Model shows natively")
        XCTAssertEqual(pops(sent), [], "the Model's own pop is not echoed back")
    }

    func testUnhandledNativePopRestoresTheRoute() async throws {
        let tree = Tree()
        var sent: [Inbound] = []
        tree.outbound = { sent.append($0) }
        try tree.apply(WireDecoder.decode(mount(handlesPop: false)))
        try tree.apply(WireDecoder.decode(push))
        let controller = await host(tree)
        let nav = try XCTUnwrap(stack(in: controller))
        XCTAssertEqual(nav.viewControllers.count, 2)

        nav.popViewController(animated: false)
        await settle(controller)
        XCTAssertEqual(pops(sent), [["depth": 1]])
        XCTAssertEqual(nav.viewControllers.count, 2, "no one handles pop: the stack returns to the route")
    }
}
