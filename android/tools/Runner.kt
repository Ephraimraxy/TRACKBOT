import kotlin.test.Test

fun main() {
    val classes = listOf("TrackingPolicyTest", "PointQueueTest", "UploadRulesTest", "TrackerEngineTest").map { Class.forName("app.trackbot.driver.core.$it") }
    var passed = 0; var failed = 0
    for (c in classes) for (m in c.declaredMethods.filter { it.isAnnotationPresent(Test::class.java) }.sortedBy { it.name }) {
        val ctor = c.getDeclaredConstructor().also { it.isAccessible = true }
        try { m.isAccessible = true; m.invoke(ctor.newInstance()); passed++; println("PASS  ${c.simpleName}.${m.name}") }
        catch (e: java.lang.reflect.InvocationTargetException) { failed++; println("FAIL  ${c.simpleName}.${m.name}: ${e.targetException}") }
    }
    println("kotlin core tests: $passed passed, $failed failed")
    if (failed > 0) System.exit(1)
}
