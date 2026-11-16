#!/usr/bin/env bash
# Runs the :core tests WITHOUT Gradle, for machines where Gradle cannot download the Kotlin plugin (a restricted mirror).
# Needs a Kotlin compiler classpath in $KOTLIN_CP (kotlin-compiler-embeddable, kotlin-stdlib, kotlin-script-runtime,
# kotlin-reflect, kotlin-daemon-embeddable, trove4j, annotations-13.0, kotlinx-coroutines-core-jvm) and $KOTLIN_STDLIB.
# On a normal machine just run `gradle :core:test`.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${KOTLIN_CP:?set KOTLIN_CP}" "${KOTLIN_STDLIB:?set KOTLIN_STDLIB}"
OUT="$(mktemp -d)"
java -cp "$KOTLIN_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -Xallow-kotlin-package -no-stdlib -no-reflect -jvm-target 17 \
  -d "$OUT" -cp "$KOTLIN_STDLIB" core/src/main/kotlin core/src/test/kotlin tools/KotlinTestShim.kt tools/Runner.kt
java -cp "$OUT:$KOTLIN_STDLIB" RunnerKt
