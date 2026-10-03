package com.warrantyvault.app.ui.screens.wishlist

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.WishlistInput
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.share.ShareTarget
import com.warrantyvault.app.ui.components.SheetGroup
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WishlistEditSheet(
    api: ApiService,
    existing: WishlistItem?,
    onDismiss: () -> Unit,
    onSaved: (WishlistItem) -> Unit,
    onDeleted: (String) -> Unit,
    /**
     * Prefilled **create** (share target #10): the link captured from another
     * app's share sheet, plus whatever the sender wrote next to it. Read
     * exactly like [existing] — as the initial value of the two fields it can
     * fill — and ignored when [existing] is set, because an edit must show the
     * saved item, not a share.
     */
    prefill: ShareTarget.Product? = null,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val isEdit = existing != null

    var name by remember { mutableStateOf(existing?.name ?: prefill?.name ?: "") }
    var brand by remember { mutableStateOf(existing?.brand ?: "") }
    var category by remember { mutableStateOf(existing?.category ?: "") }
    var initialPrice by remember {
        mutableStateOf(existing?.initialPrice?.toString() ?: "")
    }
    var currentPrice by remember {
        mutableStateOf(existing?.currentPrice?.toString() ?: "")
    }
    var buyUrl by remember { mutableStateOf(existing?.buyUrl ?: prefill?.buyUrl ?: "") }
    var imageUrl by remember { mutableStateOf(existing?.imageUrl ?: "") }
    var targetDate by remember { mutableStateOf(existing?.targetDate?.take(10) ?: "") }
    var priority by remember { mutableStateOf(existing?.priority ?: WishlistPriority.WANT) }
    var status by remember { mutableStateOf(existing?.status ?: WishlistStatus.WATCHING) }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var reminderDays by remember {
        mutableStateOf(existing?.reminderIntervalDays?.toString() ?: "")
    }

    var submitting by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                if (isEdit) "Sửa sản phẩm" else "Thêm vào wishlist",
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )

            // Why the fields are already filled. Without this the prefilled
            // form looks like leftover state from a previous edit, and a share
            // taken on the login screen (held until sign-in) would have no
            // visible explanation at all.
            if (!isEdit && prefill != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.Link,
                        null,
                        tint = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.height(16.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "Điền sẵn từ link bạn chia sẻ — kiểm tra lại rồi lưu.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SheetGroup {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("Tên sản phẩm *") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = brand, onValueChange = { brand = it },
                    label = { Text("Hãng") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = category, onValueChange = { category = it },
                    label = { Text("Loại (tuỳ chọn)") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SheetGroup {
                OutlinedTextField(
                    value = initialPrice,
                    onValueChange = { initialPrice = it.filter { c -> c.isDigit() } },
                    label = { Text("Giá ban đầu (VND)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = currentPrice,
                    onValueChange = { currentPrice = it.filter { c -> c.isDigit() } },
                    label = { Text("Giá hiện tại (VND)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = buyUrl, onValueChange = { buyUrl = it },
                    label = { Text("URL mua hàng") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = imageUrl, onValueChange = { imageUrl = it },
                    label = { Text("URL ảnh") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SheetGroup {
                OutlinedTextField(
                    value = targetDate, onValueChange = { targetDate = it },
                    label = { Text("Ngày dự định mua (YYYY-MM-DD)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                PriorityDropdown(selected = priority, onSelected = { priority = it })
                StatusDropdown(selected = status, onSelected = { status = it })
                OutlinedTextField(
                    value = reminderDays,
                    onValueChange = { reminderDays = it.filter { c -> c.isDigit() } },
                    label = { Text("Nhắc lại sau N ngày (tuỳ chọn)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes, onValueChange = { notes = it },
                    label = { Text("Ghi chú") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            error?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(4.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }

            Button(
                onClick = {
                    scope.launch {
                        submitting = true; error = null
                        val input = WishlistInput(
                            name = name.trim(),
                            category = category.ifBlank { null },
                            brand = brand.ifBlank { null },
                            initialPrice = initialPrice.toIntOrNull(),
                            currentPrice = currentPrice.toIntOrNull(),
                            buyUrl = buyUrl.ifBlank { null },
                            imageUrl = imageUrl.ifBlank { null },
                            targetDate = targetDate.ifBlank { null },
                            priority = priority,
                            status = status,
                            notes = notes.ifBlank { null },
                            reminderIntervalDays = reminderDays.toIntOrNull(),
                        )
                        try {
                            val res = if (existing != null) {
                                api.updateWishlistItem(existing.id, input)
                            } else {
                                api.createWishlistItem(input)
                            }
                            onSaved(res.item)
                        } catch (e: Exception) {
                            error = e.toUserMessage(ApiClient.json)
                        } finally {
                            submitting = false
                        }
                    }
                },
                enabled = name.isNotBlank() && !submitting,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                ),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (submitting) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.height(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text(
                        if (isEdit) "Cập nhật" else "Lưu",
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            if (isEdit && existing != null) {
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            deleting = true; error = null
                            try {
                                api.deleteWishlistItem(existing.id)
                                onDeleted(existing.id)
                            } catch (e: Exception) {
                                error = e.toUserMessage(ApiClient.json)
                            } finally {
                                deleting = false
                            }
                        }
                    },
                    enabled = !deleting && !submitting,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        if (deleting) "Đang xoá..." else "Xoá",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PriorityDropdown(
    selected: WishlistPriority,
    onSelected: (WishlistPriority) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = selected.label,
            onValueChange = {},
            readOnly = true,
            label = { Text("Mức ưu tiên") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            WishlistPriority.entries.forEach { p ->
                DropdownMenuItem(
                    text = { Text(p.label) },
                    onClick = { onSelected(p); expanded = false },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StatusDropdown(
    selected: WishlistStatus,
    onSelected: (WishlistStatus) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = selected.label,
            onValueChange = {},
            readOnly = true,
            label = { Text("Trạng thái") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            WishlistStatus.entries.forEach { s ->
                DropdownMenuItem(
                    text = { Text(s.label) },
                    onClick = { onSelected(s); expanded = false },
                )
            }
        }
    }
}
