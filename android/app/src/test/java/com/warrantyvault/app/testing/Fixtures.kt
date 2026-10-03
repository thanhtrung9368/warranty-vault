package com.warrantyvault.app.testing

import com.warrantyvault.app.network.ActionCounts
import com.warrantyvault.app.network.ActionItem
import com.warrantyvault.app.network.ActionQueue
import com.warrantyvault.app.network.Attachment
import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceStats
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.ReminderDevice
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.SubscriptionAudit
import com.warrantyvault.app.network.SubscriptionAuditFinding
import com.warrantyvault.app.network.SubscriptionAuditThresholds
import com.warrantyvault.app.network.SubscriptionStats
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.UpcomingReminder
import com.warrantyvault.app.network.UserStats
import com.warrantyvault.app.network.Warranty
import com.warrantyvault.app.network.WarrantyType
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStats
import com.warrantyvault.app.network.WishlistStatus

/** Shared minimal builders so tests only spell out the fields they assert on. */
object Fixtures {

    fun device(
        id: String = "dev-1",
        name: String = "iPhone 15 Pro",
        category: String = "PHONE",
        status: DeviceStatus = DeviceStatus.ACTIVE,
        warranties: List<Warranty> = emptyList(),
        effectiveWarrantyEnd: String? = null,
        attachmentCount: Int = 0,
        brand: String? = "Apple",
        purchasePrice: Int = 30_000_000,
        soldAt: String? = null,
        soldPrice: Int? = null,
        returnWindowDays: Int? = null,
        receivedAt: String? = null,
        returnDeadline: String? = null,
    ) = Device(
        id = id,
        userId = "user-1",
        name = name,
        category = category,
        brand = brand,
        purchaseDate = "2024-03-01",
        purchasePrice = purchasePrice,
        status = status,
        notes = null,
        soldAt = soldAt,
        soldPrice = soldPrice,
        returnWindowDays = returnWindowDays,
        receivedAt = receivedAt,
        returnDeadline = returnDeadline,
        warranties = warranties,
        effectiveWarrantyEnd = effectiveWarrantyEnd,
        attachmentCount = attachmentCount,
    )

    /**
     * A device with a recorded exchange window (migration 0010) — the shape a
     * web/iOS edit leaves behind, and the one an Android save must not erase.
     */
    fun returnWindowDevice(
        returnWindowDays: Int? = 30,
        receivedAt: String? = "2026-03-02T00:00:00",
        returnDeadline: String? = "2026-04-01T00:00:00",
    ) = device(
        returnWindowDays = returnWindowDays,
        receivedAt = receivedAt,
        returnDeadline = returnDeadline,
    )

    /** A recorded sale — the server always writes the pair together. */
    fun soldDevice(soldPrice: Int = 25_000_000, soldAt: String = "2026-03-01T00:00:00") =
        device(soldAt = soldAt, soldPrice = soldPrice)

    fun attachment(
        id: String = "att-1",
        fileName: String = "hoa-don.pdf",
        fileType: String = "application/pdf",
        description: String? = null,
    ) = Attachment(
        id = id,
        fileName = fileName,
        fileType = fileType,
        fileSize = 2048,
        description = description,
        uploadedAt = "2025-01-02T03:04:05",
    )

    fun warranty(id: String = "war-1", deviceId: String = "dev-1") = Warranty(
        id = id,
        deviceId = deviceId,
        type = WarrantyType.STANDARD,
        startDate = "2024-03-01",
        endDate = "2026-03-01",
        months = 24,
    )

    fun subscription(
        id: String = "sub-1",
        name: String = "Netflix",
        status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
        cycle: BillingCycle = BillingCycle.MONTHLY,
        renewalDate: String? = "2025-01-01",
        price: Int = 260_000,
        intervalDays: Int? = null,
        brand: String? = null,
        plan: String? = null,
        notes: String? = null,
        createdAt: String? = null,
    ) = Subscription(
        id = id,
        name = name,
        brand = brand,
        plan = plan,
        billingCycle = cycle,
        intervalDays = intervalDays,
        price = price,
        startedAt = "2024-01-01",
        renewalDate = renewalDate,
        status = status,
        notes = notes,
        createdAt = createdAt,
    )

    fun wishlistItem(
        id: String = "wish-1",
        name: String = "Steam Deck",
        category: String? = null,
        priority: WishlistPriority = WishlistPriority.WANT,
        status: WishlistStatus = WishlistStatus.WATCHING,
        currentPrice: Int? = 12_000_000,
        targetDate: String? = null,
        brand: String? = null,
        notes: String? = null,
        createdAt: String? = null,
    ) = WishlistItem(
        id = id,
        name = name,
        category = category,
        priority = priority,
        status = status,
        currentPrice = currentPrice,
        targetDate = targetDate,
        brand = brand,
        notes = notes,
        createdAt = createdAt,
    )

    fun upcomingReminder(
        id: String = "war-1",
        deviceId: String = "dev-1",
        endDate: String = "2025-06-01",
    ) = UpcomingReminder(
        id = id,
        deviceId = deviceId,
        device = ReminderDevice(id = deviceId, name = "iPhone 15 Pro", category = "PHONE"),
        type = WarrantyType.STANDARD.name,
        startDate = "2023-06-01",
        endDate = endDate,
        months = 24,
    )

    fun stats(
        devices: Int = 3,
        subscriptions: Int = 2,
        wishlist: Int = 1,
        purchasePrice: Long = 30_000_000,
        /** `null` models a Go build that predates `devices.totalWarrantyCost`. */
        warrantyCost: Long? = null,
    ) = UserStats(
        devices = DeviceStats(
            total = devices,
            byStatus = mapOf("ACTIVE" to devices),
            totalPurchasePrice = purchasePrice,
            totalWarrantyCost = warrantyCost,
        ),
        subscriptions = SubscriptionStats(total = subscriptions, totalMonthlyVnd = 260_000),
        wishlist = WishlistStats(total = wishlist, totalCurrentPriceWatching = 12_000_000),
    )

    // ---- "Việc cần xử lý" (GET /api/v1/actions) ----

    fun actionItem(
        itemKey: String = "WARRANTY_EXPIRED:war-1",
        kind: String = "WARRANTY_EXPIRED",
        severity: String = "HIGH",
        title: String = "Bảo hành đã hết hạn",
        detail: String = "Gói Tiêu chuẩn của «iPhone 15 Pro» đã hết hạn ngày 01/03/2026 (3 ngày trước).",
        deviceId: String? = "dev-1",
        warrantyId: String? = "war-1",
        subscriptionId: String? = null,
        wishlistItemId: String? = null,
        dueDate: String? = "2026-03-01T00:00:00",
        amountVnd: Long? = null,
        snoozedUntil: String? = null,
    ) = ActionItem(
        itemKey = itemKey,
        kind = kind,
        severity = severity,
        title = title,
        detail = detail,
        deviceId = deviceId,
        warrantyId = warrantyId,
        subscriptionId = subscriptionId,
        wishlistItemId = wishlistItemId,
        dueDate = dueDate,
        amountVnd = amountVnd,
        snoozedUntil = snoozedUntil,
    )

    /**
     * A queue whose `counts` describe ONLY the actionable rows, exactly as the
     * server computes it — the fixture deliberately lets a test hand in snoozed
     * rows and a smaller `counts`, which is the invariant the badge depends on.
     */
    fun actionQueue(
        items: List<ActionItem> = listOf(actionItem()),
        counts: ActionCounts? = null,
        snoozedCount: Int = 0,
        note: String = "Danh sách này chỉ gồm những việc app TỰ SUY RA từ dữ liệu bạn đã nhập.",
    ) = ActionQueue(
        generatedAt = "2026-03-04T00:00:00Z",
        items = items,
        counts = counts ?: countsOf(items.filterNot { it.isSnoozed }),
        snoozedCount = snoozedCount,
        note = note,
    )

    /** Counts over a set of rows — the same tally the server does. */
    fun countsOf(rows: List<ActionItem>): ActionCounts = ActionCounts(
        total = rows.size,
        high = rows.count { it.severity == "HIGH" },
        medium = rows.count { it.severity == "MEDIUM" },
        low = rows.count { it.severity == "LOW" },
    )

    // ---- Tự soát gói đăng ký (GET /api/v1/subscriptions/audit) ----

    fun auditThresholds(
        quietMinAutoCharges: Int = 3,
        quietMinMonths: Int = 6,
        upcomingRenewalDays: Int = 14,
        priceRiseMinPercent: Int = 5,
        duplicateNormalized: Boolean = true,
    ) = SubscriptionAuditThresholds(
        quietMinAutoCharges = quietMinAutoCharges,
        quietMinMonths = quietMinMonths,
        upcomingRenewalDays = upcomingRenewalDays,
        priceRiseMinPercent = priceRiseMinPercent,
        duplicateNormalized = duplicateNormalized,
    )

    /** `QUIET_AUTO_RENEW` — the wording is the server's, never "không dùng". */
    fun quietAuditFinding(
        subscriptionId: String = "sub-1",
        name: String = "Netflix",
        chargedTotalVnd: Long = 4_680_000,
        chargeCount: Long = 18,
        monthlyVnd: Long = 260_000,
        severity: String = "HIGH",
    ) = SubscriptionAuditFinding(
        findingKey = "QUIET_AUTO_RENEW:$subscriptionId",
        kind = "QUIET_AUTO_RENEW",
        severity = severity,
        title = "Gói tự trừ tiền đã lâu mà không thấy ghi nhận gì",
        detail = "«$name» đã tự động trừ $chargeCount lần, tổng 4.680.000 ₫, " +
            "lần đầu từ 01/09/2024 — và bạn chưa từng tự ghi khoản nào cho gói này.",
        subscriptionIds = listOf(subscriptionId),
        names = listOf(name),
        monthlyVnd = monthlyVnd,
        chargedTotalVnd = chargedTotalVnd,
        chargeCount = chargeCount,
        lastRecordedAt = "2026-02-01T00:00:00",
        nextRenewalAt = "2026-03-10T00:00:00",
        daysUntilRenewal = 6,
    )

    /** `PRICE_INCREASED`. `material = false` is the "minor rise" case. */
    fun priceAuditFinding(
        subscriptionId: String = "sub-2",
        name: String = "Spotify",
        previousAmountVnd: Long = 59_000,
        amountVnd: Long = 69_000,
        increaseVnd: Long? = 10_000,
        increasePercent: Int? = 17,
        material: Boolean? = true,
        monthlyVnd: Long = 69_000,
        severity: String = "MEDIUM",
    ) = SubscriptionAuditFinding(
        findingKey = "PRICE_INCREASED:$subscriptionId",
        kind = "PRICE_INCREASED",
        severity = severity,
        title = "Giá gói đã tăng",
        detail = "«$name» tăng từ 59.000 ₫ lên 69.000 ₫ (+10.000 ₫, +17%) " +
            "ở kỳ thanh toán ngày 01/03/2026.",
        subscriptionIds = listOf(subscriptionId),
        names = listOf(name),
        monthlyVnd = monthlyVnd,
        lastRecordedAt = "2026-03-01T00:00:00",
        previousAmountVnd = previousAmountVnd,
        amountVnd = amountVnd,
        increaseVnd = increaseVnd,
        increasePercent = increasePercent,
        material = material,
    )

    /** `DUPLICATE` — two ids, two names, one signal. Title follows the signal. */
    fun duplicateAuditFinding(
        idA: String = "sub-3",
        idB: String = "sub-4",
        nameA: String = "iCloud+",
        nameB: String = "icloud +",
        reason: String = "SAME_NAME",
        monthlyVnd: Long = 40_000,
        severity: String = "LOW",
    ) = SubscriptionAuditFinding(
        findingKey = "DUPLICATE:$idA+$idB",
        kind = "DUPLICATE",
        severity = severity,
        title = if (reason == "SAME_NAME") "Hai gói trùng tên" else "Hai gói cùng hãng và cùng loại",
        detail = if (reason == "SAME_NAME") {
            "«$nameA» và «$nameB» đang cùng hoạt động và trùng tên (khác cách viết)."
        } else {
            "«$nameA» và «$nameB» đang cùng hoạt động, cùng hãng và cùng loại."
        },
        subscriptionIds = listOf(idA, idB),
        names = listOf(nameA, nameB),
        monthlyVnd = monthlyVnd,
        reason = reason,
    )

    fun subscriptionAudit(
        findings: List<SubscriptionAuditFinding> = listOf(quietAuditFinding()),
        counts: ActionCounts? = null,
        advisory: Boolean = true,
        thresholds: SubscriptionAuditThresholds? = auditThresholds(),
        note: String = "Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi, không phải kết luận về " +
            "việc bạn có dùng hay không: app không đọc được giao dịch ngân hàng.",
    ) = SubscriptionAudit(
        generatedAt = "2026-03-04T00:00:00Z",
        findings = findings,
        counts = counts ?: ActionCounts(
            total = findings.size,
            high = findings.count { it.severity == "HIGH" },
            medium = findings.count { it.severity == "MEDIUM" },
            low = findings.count { it.severity == "LOW" },
        ),
        advisory = advisory,
        thresholds = thresholds,
        note = note,
    )
}
