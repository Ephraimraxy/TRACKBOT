pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
    // Versions are only downloaded for the modules that are actually built.
    plugins {
        id("org.jetbrains.kotlin.jvm") version "2.0.21"
        id("org.jetbrains.kotlin.android") version "2.0.21"
        id("com.android.application") version "8.7.3"
    }
}
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        google()
    }
}

rootProject.name = "trackbot-driver"

// The tracking logic (queue, batching, policy, upload rules) is plain Kotlin and builds and tests anywhere.
include(":core")
// The Android app needs the Android SDK. It is included only when one is available (ANDROID_HOME) or -PwithApp is given.
if (System.getenv("ANDROID_HOME") != null || System.getenv("ANDROID_SDK_ROOT") != null || providers.gradleProperty("withApp").isPresent) {
    include(":app")
}
