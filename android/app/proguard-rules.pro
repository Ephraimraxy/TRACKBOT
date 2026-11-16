# The web page calls these methods by name through the JavaScript bridge.
-keepclassmembers class app.trackbot.driver.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
