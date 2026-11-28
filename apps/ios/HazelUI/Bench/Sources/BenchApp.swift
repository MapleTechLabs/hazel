import Darwin
import HazelUI
import os
import SwiftUI
import UIKit

/// G7's bench: `-option A|B|C|S`, `-initial N` (messages loaded at mount), `-nojit YES`.
@main
struct BenchApp: App {
    init() {
        // JavaScriptCore reads its options once, at the first VM: set before any JSContext exists.
        if UserDefaults.standard.bool(forKey: "nojit") { setenv("JSC_useJIT", "false", 1) }
    }

    var body: some Scene {
        WindowGroup { BenchScreen().ignoresSafeArea() }
    }
}

struct BenchScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> BenchController { BenchController() }
    func updateUIViewController(_ controller: BenchController, context: Context) {}
}

let log = Logger(subsystem: "sh.hazel.ui-bench", category: "g7")

/// Memory the process is charged for (what jetsam counts).
func footprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : -1
}

final class BenchController: UIViewController {
    private let list = MessageListView()
    private let hud = UILabel()
    private let tree = Tree()
    private lazy var source = ListSource(tree: tree)
    private var bench: JSBench!
    private var option = JSBench.Option.c
    private var hudTimer: Timer?
    private var lastLine = ""
    private var reacted = 2999
    private var loadingOlder = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        option = JSBench.Option(rawValue: UserDefaults.standard.string(forKey: "option") ?? "C") ?? .c
        let initial = UserDefaults.standard.integer(forKey: "initial")
        list.frame = view.bounds
        list.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(list)

        hud.numberOfLines = 0
        hud.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        hud.textColor = .white
        hud.backgroundColor = UIColor.black.withAlphaComponent(0.7)
        hud.isUserInteractionEnabled = false
        view.addSubview(hud)

        let bar = UIStackView(arrangedSubviews: [
            button("New") { [weak self] in self?.newMessage() },
            button("React") { [weak self] in self?.react() },
            button("Older") { [weak self] in self?.older() },
            button("Reset") { [weak self] in self?.resetCounters() },
        ])
        bar.axis = .horizontal
        bar.distribution = .fillEqually
        bar.backgroundColor = UIColor.systemGray6
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bar.heightAnchor.constraint(equalToConstant: 84),
        ])

        list.onReachStart = { [weak self] in self?.older() }
        list.onViewport = { [weak self] first, last in
            guard let self, self.option == .b else { return }
            self.bench.fireAsync("viewport", #"{"first":\#(first),"last":\#(last)}"#) { taken in
                DispatchQueue.main.async { self.apply(taken, label: "viewport") }
            }
        }

        FrameMonitor.shared.start()
        let memBefore = footprintMB()
        let clock = ContinuousClock()
        let t0 = clock.now
        let url = Bundle.main.url(forResource: "g7bench", withExtension: "js")!
        bench = JSBench(script: try! String(contentsOf: url, encoding: .utf8))
        let evalMs = JSBench.ms(clock.now - t0)
        let started = clock.now
        bench.startAsync(option, initial: initial > 0 ? initial : 3000) { taken in
            DispatchQueue.main.async {
                let applied = clock.now
                self.list.onShown = {
                    let line = String(format: "G7_APP %@ %@ mount: script %.0f ms, %d ops, %d bytes, js %.1f, take %.1f, decode %.1f ms (JS thread); main apply+entries+set %.1f ms; first frame %.1f ms after start; memory %.0f -> %.0f MB",
                                      self.option.rawValue, JSBench.jitDisabled ? "no-JIT" : "JIT", evalMs, taken.ops, taken.bytes, taken.jsMs, taken.takeMs, taken.decodeMs,
                                      JSBench.ms(self.mainMs), JSBench.ms(clock.now - started), memBefore, footprintMB())
                    log.log("\(line, privacy: .public)")
                    self.lastLine = line
                }
                self.mainMs = self.applyBatches(taken)
                _ = applied
            }
        }

        hudTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateHud() }
        }
    }

    private var mainMs: Duration = .zero

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        hud.frame = CGRect(x: 0, y: view.safeAreaInsets.top, width: view.bounds.width, height: 74)
        list.bottomInset = 84
        list.topInset = view.safeAreaInsets.top + 74
    }

    private func button(_ title: String, _ action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system, primaryAction: UIAction { _ in action() })
        b.setTitle(title, for: .normal)
        b.accessibilityIdentifier = "bench-\(title.lowercased())"
        return b
    }

    /// Applies batches on the main thread; returns the time it took.
    @discardableResult
    private func applyBatches(_ taken: JSBench.Taken) -> Duration {
        let clock = ContinuousClock()
        let t0 = clock.now
        var dirty: Set<Int> = []
        var changed = false
        for batch in taken.batches {
            do { try tree.apply(batch) } catch { log.error("apply failed: \(String(describing: error), privacy: .public)") }
            if let d = source.refresh() { dirty.formUnion(d); changed = true }
        }
        if changed { list.set(keys: source.keys, entries: source.entries, dirty: dirty) }
        return clock.now - t0
    }

    private func apply(_ taken: JSBench.Taken, label: String) {
        let rendersBefore = list.stats.renders
        let main = applyBatches(taken)
        let line = String(format: "G7_APP %@ %@: %d ops, %d bytes, js %.2f, take %.2f, decode %.2f ms (JS thread); main %.2f ms; at bottom %@",
                          option.rawValue, label, taken.ops, taken.bytes, taken.jsMs, taken.takeMs, taken.decodeMs, JSBench.ms(main), list.isAtBottom ? "yes" : "no")
        log.log("\(line, privacy: .public)")
        lastLine = line
        // Which rows redrew for it, once their bitmaps land.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            log.log("G7_APP \(label, privacy: .public) redrew \(self.list.stats.renders - rendersBefore, privacy: .public) rows")
        }
    }

    private func newMessage() {
        bench.fireAsync("bench", #"{"kind":"new"}"#) { taken in DispatchQueue.main.async { self.apply(taken, label: "new message") } }
    }

    private func react() {
        let id = String(format: "m%06d", reacted)
        bench.fireAsync("bench", #"{"kind":"react","id":"\#(id)"}"#) { taken in DispatchQueue.main.async { self.apply(taken, label: "reaction") } }
    }

    private func older() {
        guard !loadingOlder else { return }
        loadingOlder = true
        bench.fireAsync("reachStart") { taken in
            DispatchQueue.main.async {
                self.loadingOlder = false
                if taken.ops > 1 { self.apply(taken, label: "older page") }
            }
        }
    }

    private func resetCounters() {
        logTotals()
        FrameMonitor.shared.reset()
        list.resetStats()
        log.log("G7_APP counters reset")
    }

    private func updateHud() {
        let t = FrameMonitor.shared.totals
        let s = list.stats
        let text = String(format: " %@ %@ | %d Hz | frames %d drops %d long %d worst %.1f ms\n blanks %d renders %d bitmaps %.0f MB | mem %.0f MB | rows %d\n %@",
                          option.rawValue, JSBench.jitDisabled ? "no-JIT" : "JIT", t.hz, t.frames, t.drops, t.longFrames, t.worstMs,
                          s.blanks, s.renders, Double(s.bitmapBytes) / 1_048_576, footprintMB(), list.count, String(lastLine.dropFirst(7).prefix(160)))
        hud.text = text
    }
}

extension BenchController {
    /// The frame totals so far, logged on Reset (agent-driven runs grep `G7_FRAMES`).
    func logTotals() {
        let t = FrameMonitor.shared.totals
        log.log("G7_FRAMES frames \(t.frames, privacy: .public) drops \(t.drops, privacy: .public) long \(t.longFrames, privacy: .public) worst \(t.worstMs, privacy: .public) hz \(t.hz, privacy: .public) busy worst \(t.busyWorstMs, privacy: .public) ms, turns over 8.3 ms \(t.busyOver8ms, privacy: .public), over 4 ms \(t.busyOver4ms, privacy: .public), blanks \(self.list.stats.blanks, privacy: .public) blank frames \(self.list.stats.blankFrames, privacy: .public)")
    }
}
