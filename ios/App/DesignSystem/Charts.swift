import SwiftUI

// ============================================================
// WarrantyVault iOS — lightweight charts
//
// SwiftUI ports of the custom SVG charts in ios-ui.jsx
// (BarChart / LineChart / Donut). No third-party chart library —
// these match the prototype's minimal, iOS-flavored look.
// ============================================================

/// A single labelled value used by the bar + line charts.
struct WVChartPoint: Identifiable {
    let id = UUID()
    let label: String
    let value: Double
}

/// A slice of a `WVDonut`.
struct WVDonutSlice: Identifiable {
    let id = UUID()
    let label: String
    let value: Double
    let color: Color
}

// MARK: - Bar chart

struct WVBarChart: View {
    var data: [WVChartPoint]
    var height: CGFloat = 140
    var color: Color = WVColor.brand
    var formatY: (Double) -> String = { String(Int($0)) }

    private let ticks = 3
    private let axisWidth: CGFloat = 34

    private var maxValue: Double { max(1, data.map(\.value).max() ?? 1) }

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            // y-axis labels
            VStack(alignment: .trailing, spacing: 0) {
                ForEach(0...ticks, id: \.self) { i in
                    Text(formatY(maxValue * (1 - Double(i) / Double(ticks))))
                        .font(.system(size: 9))
                        .foregroundStyle(WVColor.label3)
                        .frame(maxHeight: .infinity, alignment: i == 0 ? .top : .center)
                }
            }
            .frame(width: axisWidth, height: height - 20)

            VStack(spacing: 4) {
                ZStack {
                    // gridlines
                    VStack(spacing: 0) {
                        ForEach(0...ticks, id: \.self) { i in
                            Rectangle()
                                .fill(WVColor.sepThin)
                                .frame(height: 1)
                                .frame(maxHeight: .infinity, alignment: i == 0 ? .top : .center)
                        }
                    }
                    // bars
                    HStack(alignment: .bottom, spacing: 0) {
                        ForEach(data) { point in
                            VStack {
                                Spacer(minLength: 0)
                                Capsule(style: .continuous)
                                    .fill(color.opacity(0.9))
                                    .frame(
                                        width: 14,
                                        height: max(2, CGFloat(point.value / maxValue) * (height - 20))
                                    )
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
                .frame(height: height - 20)

                // x-axis labels
                HStack(spacing: 0) {
                    ForEach(data) { point in
                        Text(point.label)
                            .font(.system(size: 9))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 16)
            }
        }
        .frame(height: height)
    }
}

// MARK: - Line chart

struct WVLineChart: View {
    var data: [WVChartPoint]
    var height: CGFloat = 140
    var color: Color = WVColor.brand
    var formatY: (Double) -> String = { String(Int($0)) }

    private let axisWidth: CGFloat = 34

    private var maxValue: Double { data.map(\.value).max() ?? 1 }
    private var minValue: Double { data.map(\.value).min() ?? 0 }
    private var range: Double { max(1, maxValue - minValue) }

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            VStack(alignment: .trailing, spacing: 0) {
                ForEach(0...2, id: \.self) { i in
                    Text(formatY(maxValue - range * Double(i) / 2))
                        .font(.system(size: 9))
                        .foregroundStyle(WVColor.label3)
                        .frame(maxHeight: .infinity, alignment: i == 0 ? .top : .center)
                }
            }
            .frame(width: axisWidth, height: height - 20)

            VStack(spacing: 4) {
                GeometryReader { geo in
                    let w = geo.size.width
                    let h = geo.size.height
                    let step = data.count > 1 ? w / CGFloat(data.count - 1) : w
                    let points = data.enumerated().map { idx, p -> CGPoint in
                        let x = CGFloat(idx) * step
                        let y = h - CGFloat((p.value - minValue) / range) * h
                        return CGPoint(x: x, y: y)
                    }

                    ZStack {
                        // gridlines
                        VStack(spacing: 0) {
                            ForEach(0...2, id: \.self) { i in
                                Rectangle()
                                    .fill(WVColor.sepThin)
                                    .frame(height: 1)
                                    .frame(maxHeight: .infinity, alignment: i == 0 ? .top : .center)
                            }
                        }
                        if points.count > 1 {
                            // area fill
                            Path { path in
                                path.move(to: CGPoint(x: points[0].x, y: h))
                                for p in points { path.addLine(to: p) }
                                path.addLine(to: CGPoint(x: points.last!.x, y: h))
                                path.closeSubpath()
                            }
                            .fill(LinearGradient(
                                colors: [color.opacity(0.3), color.opacity(0)],
                                startPoint: .top, endPoint: .bottom))
                            // line
                            Path { path in
                                path.move(to: points[0])
                                for p in points.dropFirst() { path.addLine(to: p) }
                            }
                            .stroke(color, style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                        }
                        // dots
                        ForEach(Array(points.enumerated()), id: \.offset) { _, p in
                            Circle()
                                .fill(WVColor.bg2)
                                .frame(width: 6, height: 6)
                                .overlay(Circle().stroke(color, lineWidth: 2))
                                .position(p)
                        }
                    }
                }
                .frame(height: height - 20)

                HStack(spacing: 0) {
                    ForEach(data) { point in
                        Text(point.label)
                            .font(.system(size: 9))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 16)
            }
        }
        .frame(height: height)
    }
}

// MARK: - Donut chart

struct WVDonut: View {
    var data: [WVDonutSlice]
    var size: CGFloat = 140

    private var total: Double { max(1, data.map(\.value).reduce(0, +)) }

    var body: some View {
        Canvas { context, canvasSize in
            let center = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
            let radius = min(canvasSize.width, canvasSize.height) / 2 - 8
            let inner = radius * 0.62
            var startAngle = -90.0

            for slice in data {
                let sweep = slice.value / total * 360
                let endAngle = startAngle + sweep
                var path = Path()
                path.addArc(center: center, radius: radius,
                            startAngle: .degrees(startAngle),
                            endAngle: .degrees(endAngle), clockwise: false)
                path.addArc(center: center, radius: inner,
                            startAngle: .degrees(endAngle),
                            endAngle: .degrees(startAngle), clockwise: true)
                path.closeSubpath()
                context.fill(path, with: .color(slice.color))
                startAngle = endAngle
            }
        }
        .frame(width: size, height: size)
    }
}
