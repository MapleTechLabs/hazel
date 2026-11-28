// Draws each SVG in a folder as a square PNG with CoreSVG (the renderer the asset catalog used), so
// HazelUI ships plain bitmaps rather than an asset catalog (`export-icons.ts`).
//   swift scripts/rasterize-icons.swift <svg folder> <png folder> <pixels>
import AppKit

let arguments = CommandLine.arguments
guard arguments.count == 4, let pixels = Int(arguments[3]) else {
    FileHandle.standardError.write("usage: rasterize-icons.swift <svg folder> <png folder> <pixels>\n".data(using: .utf8)!)
    exit(2)
}
let input = URL(fileURLWithPath: arguments[1]), output = URL(fileURLWithPath: arguments[2])
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let files = try FileManager.default.contentsOfDirectory(atPath: input.path).filter { $0.hasSuffix(".svg") }.sorted()
for file in files {
    guard let image = NSImage(contentsOf: input.appendingPathComponent(file)),
          let bitmap = NSBitmapImageRep(
              bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
              hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
          )
    else { FileHandle.standardError.write("cannot draw \(file)\n".data(using: .utf8)!); exit(1) }
    bitmap.size = NSSize(width: pixels, height: pixels)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
    try png.write(to: output.appendingPathComponent(file.replacingOccurrences(of: ".svg", with: ".png")))
}
print("\(files.count) icons -> \(output.path)")
