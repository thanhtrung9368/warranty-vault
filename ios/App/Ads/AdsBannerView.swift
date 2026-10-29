#if canImport(UIKit)
import GoogleMobileAds
import SwiftUI
import UIKit
import WarrlyKit

// ============================================================
// AdaptiveBannerView + AdsBannerSlot — the free tier's banner.
//
// Two rules earned from the owner's other app are enforced here:
//
//  1. **Mounted once, kept mounted.** The banner lives in a `safeAreaInset` at
//     the bottom of the Devices screen, OUTSIDE the scroll view. It is never
//     unmounted by scrolling: unmounting fired a fresh ad request per
//     play/stop cycle in the other app and burned fill.
//
//  2. **`updateUIView` does not reload on every SwiftUI update.** Typing in the
//     search field re-evaluates the Devices body many times a second; a load
//     per update would be a request storm. A reload happens only when the
//     available width really changed (rotation) or when the personalisation
//     decision flipped (ATT answered).
//
// The slot is 50 pt tall BEFORE an ad exists and stays 50 pt after it loads
// (`ScreenMetrics.adBannerSlotHeight`), and the adaptive creative is letterboxed
// inside it: `inlineAdaptiveBanner(width:maxHeight:)` lets the width adapt
// without ever resizing the slot, so the list never shifts under the user.
// ============================================================

struct AdaptiveBannerView: UIViewRepresentable {
    let adUnitID: String
    let isNonPersonalised: Bool
    /// Width of the slot the banner was given, in points.
    let width: CGFloat

    func makeCoordinator() -> Coordinator {
        Coordinator(isNonPersonalised: isNonPersonalised)
    }

    func makeUIView(context: Context) -> BannerView {
        let banner = BannerView(adSize: Self.adSize(for: width))
        banner.delegate = context.coordinator
        banner.load(Self.request(isNonPersonalised: isNonPersonalised))
        return banner
    }

    func updateUIView(_ banner: BannerView, context: Context) {
        let newSize = Self.adSize(for: width)
        let widthChanged = abs(banner.adSize.size.width - newSize.size.width) > 0.5
        let policyChanged = context.coordinator.isNonPersonalised != isNonPersonalised
        guard widthChanged || policyChanged else { return }

        context.coordinator.isNonPersonalised = isNonPersonalised
        banner.adSize = newSize
        banner.load(Self.request(isNonPersonalised: isNonPersonalised))
    }

    /// Full-width adaptive size, capped at the slot height.
    ///
    /// `max(width, 320)` because the sizing helper rejects a zero/negative
    /// width during the first layout pass; 320 is the narrowest iPhone width
    /// the app supports and is corrected on the next `updateUIView`.
    static func adSize(for width: CGFloat) -> AdSize {
        inlineAdaptiveBanner(
            width: max(width, 320),
            maxHeight: ScreenMetrics.adBannerSlotHeight
        )
    }

    /// `npa=1` is the documented non-personalised signal.
    static func request(isNonPersonalised: Bool) -> Request {
        let request = Request()
        guard isNonPersonalised else { return request }
        let extras = Extras()
        extras.additionalParameters = ["npa": "1"]
        request.register(extras)
        return request
    }

    @MainActor
    final class Coordinator: NSObject, BannerViewDelegate {
        /// Mirrors the last request's personalisation so `updateUIView` can tell
        /// a real change from a body re-evaluation.
        var isNonPersonalised: Bool

        init(isNonPersonalised: Bool) {
            self.isNonPersonalised = isNonPersonalised
        }

        func bannerViewDidReceiveAd(_ bannerView: BannerView) {
#if DEBUG
            print("[Ads] banner loaded (npa=\(isNonPersonalised ? 1 : 0))")
#endif
        }

        func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: Error) {
#if DEBUG
            // A failure keeps the reserved slot empty. Do NOT reload here: an
            // automatic retry loop on a no-fill or offline device is a request
            // storm, and AdMob's own banner refresh already retries.
            print("[Ads] banner failed: \(error.localizedDescription)")
#endif
        }
    }
}

/// The 50 pt reserved slot at the bottom of the Devices list.
///
/// Promises:
///  * the slot has the SAME height before the SDK starts, while an ad loads,
///    and after a load failure — no layout shift, no jump when fill arrives;
///  * nothing is rendered at all for a paid account (`isAdFree`);
///  * the banner is hidden, but the slot kept, when the ad unit id is missing
///    (a build misconfiguration — see `AdsConfig.bannerUnitID`).
struct AdsBannerSlot: View {
    @EnvironmentObject private var ads: AdsController

    var body: some View {
        if ads.isAdFree {
            EmptyView()
        } else {
            slot
        }
    }

    private var slot: some View {
        GeometryReader { proxy in
            Group {
                if ads.isSDKReady, let unitID = AdsConfig.bannerUnitID {
                    AdaptiveBannerView(
                        adUnitID: unitID,
                        isNonPersonalised: ads.requestsNonPersonalisedAds,
                        width: proxy.size.width
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                } else {
                    Color.clear
                }
            }
        }
        .frame(height: ScreenMetrics.adBannerSlotHeight)
        .frame(maxWidth: .infinity)
        .background(WVColor.bg2)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(WVColor.sepThin)
                .frame(height: 0.5)
        }
    }
}
#endif
