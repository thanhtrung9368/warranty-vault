package com.warrly.ui.screens.devices

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.FlashOff
import androidx.compose.material.icons.outlined.FlashOn
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.warrly.R
import java.util.concurrent.Executors

/**
 * The camera surface behind the scan action on the serial field: a full-screen
 * dialog with a CameraX preview, ML Kit reading every frame, and a list of
 * candidate values the user taps to fill `serialNumber`.
 *
 * ## Why a Dialog and not a route
 *
 * The form itself is a `ModalBottomSheet` owned by `DevicesScreen` /
 * `DeviceDetailScreen`. Adding a third navigation state for "the camera is open"
 * would have to be threaded through both hosts for a surface that lives for
 * seconds. A full-width `Dialog` is a second window on top of the sheet, so the
 * form (with everything the user already typed) is untouched underneath, and
 * dismissing the scanner returns to it with no state to restore.
 *
 * ## Both models, and why
 *
 *  * **Barcode** (`com.google.mlkit:barcode-scanning`, bundled): IMEI labels are
 *    Code128; phone boxes also carry EAN-13, accessories a QR, and some brands a
 *    DataMatrix. The formats are restricted to exactly those five
 *    ([BARCODE_OPTIONS]) so the engine is not decoding every symbology it knows
 *    several times per second.
 *  * **Printed text** (`com.google.mlkit:text-recognition`, bundled Latin): the
 *    serial is often printed rather than encoded — `S/N: …` on a laptop box, the
 *    IMEI under a battery. Without this mode the feature would silently only
 *    work for some brands. It is a second, heavy model: ~11 MB of native code
 *    per ABI in the release APK (the App Bundle splits by ABI, so a device
 *    downloads one). The alternative was to ship a scanner that fails on the
 *    exact label users most often cannot read — and the field remains editable
 *    either way.
 *
 * Both are the **bundled** artifacts, so a scan works with no Play Services and
 * no first-use model download — a service centre's Wi-Fi is not where this
 * feature should fail.
 *
 * ## What this file deliberately does not decide
 *
 * It never writes to the API. `onPicked` hands a string to the form's existing
 * `serial` state; the user can edit it and still has to tap Save. There is no
 * code path from a camera frame to `POST /devices`.
 *
 * ## Not covered by the unit tests
 *
 * CameraX + ML Kit need a camera and a real frame pipeline, which a JVM unit test
 * does not have (the module has no Robolectric and no instrumentation tests).
 * Everything from a decoded value onwards is [SerialScan] and is tested there.
 */
@Composable
internal fun SerialScannerDialog(
    onDismiss: () -> Unit,
    /** The chosen value. The caller closes the dialog and puts it in the form. */
    onPicked: (String) -> Unit,
) {
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme

    var mode by rememberSaveable { mutableStateOf(ScanMode.BARCODE) }
    var candidates by remember { mutableStateOf<List<String>>(emptyList()) }
    var cameraFailed by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var torchOn by remember { mutableStateOf(false) }

    // The view is created once. `PreviewView` starts a display listener, so
    // recreating it on every recomposition would leak handlers.
    val previewView = remember(context) {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }
    val lifecycleOwner = remember(context) { context.findActivity() as? LifecycleOwner }
    val mainExecutor = remember(context) { ContextCompat.getMainExecutor(context) }
    // One thread for frame analysis: CameraX hands frames over on this executor
    // and ML Kit's `process()` is called from it, so the main thread never
    // touches pixels.
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }

    val analyzer = remember {
        SerialFrameAnalyzer(
            onBarcodes = { values ->
                candidates = SerialScan.mergeCandidates(
                    candidates,
                    SerialScan.barcodeCandidates(values),
                )
            },
            onText = { text ->
                candidates = SerialScan.mergeCandidates(
                    candidates,
                    SerialScan.textCandidates(text),
                )
            },
        )
    }

    // The analyzer reads `mode` on its worker thread; the switch is a plain
    // field write (volatile), not a use-case rebuild, so changing modes does not
    // restart the camera.
    LaunchedEffect(mode) { analyzer.mode = mode }

    DisposableEffect(Unit) {
        onDispose {
            analyzer.close()
            analysisExecutor.shutdown()
        }
    }

    DisposableEffect(lifecycleOwner, previewView) {
        val owner = lifecycleOwner
        if (owner == null) {
            // No Activity (a preview/host without one): the camera cannot be
            // bound, and the panel below already tells the user to type it in.
            cameraFailed = true
            return@DisposableEffect onDispose { }
        }
        var provider: ProcessCameraProvider? = null
        var disposed = false
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener(
            {
                if (disposed) return@addListener
                runCatching {
                    val bound = future.get()
                    provider = bound
                    if (!bound.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
                        cameraFailed = true
                        return@runCatching
                    }
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(analysisExecutor, analyzer)
                    bound.unbindAll()
                    camera = bound.bindToLifecycle(
                        owner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }.onFailure {
                    // No emulator/device in CI, so logcat is the only diagnostic a
                    // real failure (no camera, camera in use by another app, a
                    // vendor HAL) leaves behind. The UI still degrades to typing.
                    Log.w(TAG, "could not bind the camera", it)
                    cameraFailed = true
                }
            },
            mainExecutor,
        )
        onDispose {
            disposed = true
            runCatching { camera?.cameraControl?.enableTorch(false) }
            runCatching { provider?.unbindAll() }
            provider = null
            camera = null
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = cs.surface) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 8.dp, top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        stringResource(R.string.scan_title),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    if (camera?.cameraInfo?.hasFlashUnit() == true) {
                        IconButton(
                            onClick = {
                                val next = !torchOn
                                runCatching { camera?.cameraControl?.enableTorch(next) }
                                    .onFailure { Log.w(TAG, "torch toggle failed", it) }
                                torchOn = next
                            },
                        ) {
                            Icon(
                                if (torchOn) Icons.Outlined.FlashOn else Icons.Outlined.FlashOff,
                                stringResource(
                                    if (torchOn) R.string.scan_torch_off else R.string.scan_torch_on,
                                ),
                            )
                        }
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Filled.Close, stringResource(R.string.scan_close))
                    }
                }

                Row(
                    Modifier.padding(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = mode == ScanMode.BARCODE,
                        onClick = {
                            mode = ScanMode.BARCODE
                            candidates = emptyList()
                        },
                        label = { Text(stringResource(R.string.scan_mode_barcode)) },
                    )
                    FilterChip(
                        selected = mode == ScanMode.TEXT,
                        onClick = {
                            mode = ScanMode.TEXT
                            candidates = emptyList()
                        },
                        label = { Text(stringResource(R.string.scan_mode_text)) },
                    )
                }

                Box(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .background(Color.Black),
                    contentAlignment = Alignment.Center,
                ) {
                    if (cameraFailed) {
                        Text(
                            stringResource(R.string.scan_camera_failed),
                            color = Color.White,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(24.dp),
                        )
                    } else {
                        AndroidView(
                            factory = { previewView },
                            modifier = Modifier.fillMaxSize(),
                        )
                        Text(
                            stringResource(
                                if (mode == ScanMode.BARCODE) R.string.scan_hint_barcode
                                else R.string.scan_hint_text,
                            ),
                            color = Color.White,
                            fontSize = 13.sp,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(16.dp),
                        )
                    }
                }

                Column(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 320.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        stringResource(R.string.scan_found),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.onSurfaceVariant,
                    )
                    if (candidates.isEmpty()) {
                        Text(
                            stringResource(R.string.scan_nothing_found),
                            fontSize = 12.sp,
                            color = cs.onSurfaceVariant,
                        )
                    } else {
                        // `candidates` is capped at SerialScan.MAX_CANDIDATES, so
                        // this is a short list, not a scrolling feed.
                        candidates.forEach { value ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { onPicked(value) }
                                    .padding(horizontal = 8.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    value,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 14.sp,
                                    color = cs.onSurface,
                                    modifier = Modifier.weight(1f),
                                )
                                Spacer(Modifier.width(12.dp))
                                Text(
                                    stringResource(R.string.scan_use),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = cs.primary,
                                )
                            }
                        }
                    }
                    Text(
                        stringResource(R.string.scan_never_saved),
                        fontSize = 11.sp,
                        color = cs.onSurfaceVariant,
                    )
                    TextButton(
                        onClick = onDismiss,
                        contentPadding = PaddingValues(0.dp),
                    ) {
                        Text(stringResource(R.string.scan_manual))
                    }
                }
            }
        }
    }
}

/**
 * What the camera looks for. Two modes on purpose: a box label can carry the
 * IMEI both as a Code128 barcode and as printed digits, and which one is legible
 * depends on the print, the light and the angle.
 */
private enum class ScanMode { BARCODE, TEXT }

/** Logcat tag for the camera path — the only diagnostic on a device. */
private const val TAG = "SerialScanner"

/**
 * One frame in, one ML Kit call out.
 *
 * Both models are created once and closed by [close]; `process()` is asynchronous
 * and the `ImageProxy` is closed **once**, in `addOnCompleteListener`, whether the
 * call succeeded or failed. Closing it in the success listener only would leak a
 * buffer (and stall the pipeline) on every unreadable frame.
 *
 * The result is a callback rather than a state object because this class must not
 * know about Compose; the dialog owns the state.
 */
private class SerialFrameAnalyzer(
    private val onBarcodes: (List<String>) -> Unit,
    private val onText: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    /**
     * Read from the analysis thread, written from the main thread when the user
     * switches mode.
     */
    @Volatile
    var mode: ScanMode = ScanMode.BARCODE

    private val barcodeScanner = BarcodeScanning.getClient(BARCODE_OPTIONS)
    private val textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    /**
     * `ImageProxy.getImage()` is marked with AndroidX's `@ExperimentalGetImage`,
     * which is an `androidx.annotation.RequiresOptIn` marker — **not** Kotlin's
     * `kotlin.RequiresOptIn`, so Kotlin's `@OptIn` has no effect on it (the
     * compiler says so). The AndroidX `@OptIn` is the one lint's
     * `UnsafeOptInUsageError` understands.
     */
    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        try {
            when (mode) {
                ScanMode.BARCODE -> barcodeScanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        onBarcodes(barcodes.mapNotNull { it.rawValue })
                    }
                    .addOnCompleteListener { imageProxy.close() }

                ScanMode.TEXT -> textRecognizer.process(image)
                    .addOnSuccessListener { result -> onText(result.text) }
                    .addOnCompleteListener { imageProxy.close() }
            }
        } catch (t: Throwable) {
            // `process()` can throw synchronously on a recycled image; the proxy
            // still has to be released or the pipeline stops delivering frames.
            Log.w(TAG, "frame analysis failed", t)
            imageProxy.close()
        }
    }

    fun close() {
        runCatching { barcodeScanner.close() }
        runCatching { textRecognizer.close() }
    }

    private companion object {
        /**
         * The five symbologies this feature needs, and no others:
         * Code128 (IMEI/serial labels), EAN-13 and EAN-8 (retail boxes), QR
         * (some brands print one next to the S/N), DataMatrix (the small square
         * codes on laptop labels). Restricting the list keeps per-frame work down.
         */
        val BARCODE_OPTIONS: BarcodeScannerOptions = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_CODE_128,
                Barcode.FORMAT_EAN_13,
                Barcode.FORMAT_EAN_8,
                Barcode.FORMAT_QR_CODE,
                Barcode.FORMAT_DATA_MATRIX,
            )
            .build()
    }
}

/**
 * The Activity behind a Context, unwrapping the `ContextThemeWrapper` a Dialog
 * gives its content. Used only to obtain the `LifecycleOwner` CameraX binds to.
 */
internal fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}

/**
 * Opens this app's page in system Settings — the only route back once the camera
 * permission has been permanently denied. Returns `false` when no Settings
 * activity could be opened, so the caller can say so instead of appearing to do
 * nothing.
 */
internal fun openAppSettings(context: Context): Boolean {
    val intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.fromParts("package", context.packageName, null),
    )
    // Only needed when the Context is not an Activity; harmless otherwise.
    if (context.findActivity() == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
        context.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}
