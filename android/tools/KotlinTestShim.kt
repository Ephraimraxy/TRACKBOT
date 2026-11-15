package kotlin.test

@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class Test

fun <T> assertEquals(expected: T, actual: T, message: String? = null) { if (expected != actual) throw AssertionError((message ?: "") + " expected:<$expected> but was:<$actual>") }
fun assertTrue(actual: Boolean, message: String? = null) { if (!actual) throw AssertionError(message ?: "expected true") }
fun assertFalse(actual: Boolean, message: String? = null) { if (actual) throw AssertionError(message ?: "expected false") }
fun assertNull(actual: Any?, message: String? = null) { if (actual != null) throw AssertionError(message ?: "expected null but was $actual") }
