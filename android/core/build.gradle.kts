plugins {
    id("org.jetbrains.kotlin.jvm")
}

// The standard library version matches the compiler.
kotlin { coreLibrariesVersion = "2.0.21" }

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("passed", "failed", "skipped") }
}
