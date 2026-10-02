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

android {
    namespace = "com.warrantyvault.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.warrantyvault.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        // Default base URL for the Go API backend (api/cmd/server, port 4000).
        // Mobile clients hit Go directly — the Next.js website no longer serves
        // /api/v1/*. Override per build type or per-flavor when needed.
        // 10.0.2.2 is the Android emulator's loopback alias to the host machine
        // — perfect for `go run ./cmd/server` on the laptop.
        buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:4000\"")
    }

    buildTypes {
        debug {
            // Allow cleartext for dev backend; release uses HTTPS-only.
            isMinifyEnabled = false
        }
        release {
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
