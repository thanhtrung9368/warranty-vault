import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Apply google-services only when google-services.json is present.
// Lets the project build out-of-the-box; FCM stays disabled until a config
// file is dropped in (see android/README.md).
val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

// Play publishing is configured only when credentials are present, so an ordinary
// build — and CI running the tests — never needs a Play service account.
//
// In CI the service-account JSON arrives as ANDROID_PUBLISHER_CREDENTIALS (GPP
// reads it directly, so no key file is ever written to disk or committed).
// Locally, drop the key at app/play-service-account.json.
val hasPlayCredentials =
    !System.getenv("ANDROID_PUBLISHER_CREDENTIALS").isNullOrBlank() ||
        file("play-service-account.json").exists()
if (hasPlayCredentials) {
    apply(plugin = libs.plugins.play.publisher.get().pluginId)
    configure<com.github.triplet.gradle.play.PlayPublisherExtension> {
        // `internal` is the Play track that mirrors TestFlight: fast, small
        // audience, and it does not need a store listing review for updates.
        // The release workflow passes -PplayTrack=<track> to promote without a
        // code change; a plain local build gets the safe default.
        track.set((project.findProperty("playTrack") as String?) ?: "internal")
        defaultToAppBundles.set(true)
        // Every upload must bump versionCode, or Play rejects it. Failing on the
        // Gradle side is friendlier than a 400 from Google halfway through a run.
        resolutionStrategy.set(com.github.triplet.gradle.androidpublisher.ResolutionStrategy.FAIL)
    }
}

android {
    namespace = "com.warrly"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.warrly"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.0"

        // Default base URL for the Go API backend (api/cmd/server, port 4000).
        // Mobile clients hit Go directly — the Next.js website no longer serves
        // /api/v1/*. Override per build type or per-flavor when needed.
        // 10.0.2.2 is the Android emulator's loopback alias to the host machine
        // — perfect for `go run ./cmd/server` on the laptop.
        buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:4000\"")
    }

    // Ký release bằng keystore upload. File `keystore.properties` và `.jks`
    // KHÔNG vào git (xem .gitignore) — chúng là thứ duy nhất chứng minh app này
    // là của bạn. Mất cả hai thì Play App Signing mới cứu được bằng cách reset
    // upload key; mất luôn tài khoản Play là mất app.
    //
    // Không có file thì signingConfig vẫn tạo nhưng rỗng, và release build sẽ
    // báo lỗi rõ ràng thay vì lặng lẽ ký bằng debug key.
    signingConfigs {
        create("release") {
            val propsFile = rootProject.file("keystore.properties")
            if (propsFile.exists()) {
                val props = Properties().apply { propsFile.inputStream().use { load(it) } }
                storeFile = rootProject.file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // Allow cleartext for dev backend; release uses HTTPS-only.
            isMinifyEnabled = false
        }
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Plain-JVM unit tests (src/test). No Robolectric / instrumentation — the
    // Android framework stubs return default values instead of throwing so pure
    // logic that only grazes android.* (e.g. a `Log` call) still runs fast.
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.security.crypto)

    // App lock ("Khoá bằng sinh trắc học") — opt-in biometric + device-credential
    // gate, mirroring the iOS "Face ID & Touch ID" lock. `biometric` brings
    // androidx.fragment transitively; it is pinned explicitly (libs.versions.toml)
    // so MainActivity can host BiometricPrompt through a FragmentActivity without
    // tripping InvalidFragmentVersionForActivityResult.
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.fragment)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines)

    implementation(libs.coil.compose)

    // Firebase Cloud Messaging — token registration + inbound notifications.
    // The FCM SDK works without google-services.json (just no-ops on missing
    // config) for compile-time, but you need a real config + project to
    // actually send/receive pushes. See android/README.md.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    // JVM unit tests — run by `:app:testDebugUnitTest` (CI "Unit tests" step).
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
