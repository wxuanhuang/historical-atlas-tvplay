package com.timeline.atlas

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 时空巧记 · 大屏壳
 *
 * 1. 只有一个 WebView，加载 assets/index.html（离线可用，不依赖网络与账号）
 * 2. 沉浸式全屏 + 屏幕常亮 + 横屏
 * 3. 遥控器：DPAD / OK 直接以键盘事件进入网页，交给 index.html 里的 __tvNav
 * 4. 返回键：先问网页 window.__tvBack()，页内没东西可关才退出应用
 * 5. 2026-11-06 新增：启动前检测系统 WebView 内核版本。
 *    本项目用到 d3 v7（含可选链 ?.），需要 Chromium 80+；低于此版本会白屏。
 *    现在会先给出可读的原因和处置建议，而不是让用户对着白屏猜。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    /** 本项目的最低内核要求（d3 v7 用到可选链） */
    private val MIN_CHROME = 80

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterFullscreen()

        val (pkgName, versionName, major) = webViewInfo()
        android.util.Log.i("Atlas", "WebView package=$pkgName version=$versionName major=$major")

        if (major in 1 until MIN_CHROME) {
            showKernelWarning(pkgName, versionName, major)
            return
        }
        startWeb(versionName)
    }

    /** 读取系统 WebView 的包名与版本。API 26+ 有官方接口，更低版本退回 PackageManager 查询。 */
    private fun webViewInfo(): Triple<String, String, Int> {
        var pkgName = ""
        var version = ""
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val p = WebView.getCurrentWebViewPackage()
            pkgName = p?.packageName ?: ""
            version = p?.versionName ?: ""
        }
        if (version.isEmpty()) {
            val candidates = listOf("com.google.android.webview", "com.android.webview", "com.android.chrome")
            for (c in candidates) {
                try {
                    val pi = packageManager.getPackageInfo(c, 0)
                    pkgName = c
                    version = pi.versionName ?: ""
                    break
                } catch (e: PackageManager.NameNotFoundException) { /* 继续找 */ }
            }
        }
        val major = version.substringBefore('.').trim().toIntOrNull() ?: 0
        return Triple(pkgName, version, major)
    }

    /** 内核过旧：给出明确原因和三条出路，附带「仍然尝试打开」 */
    private fun showKernelWarning(pkgName: String, versionName: String, major: Int) {
        val pad = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0E2230"))
            setPadding(pad, pad, pad, pad)
            gravity = Gravity.CENTER_VERTICAL
        }
        fun text(s: String, size: Float, color: String): TextView =
            TextView(this).apply {
                text = s
                setTextColor(Color.parseColor(color))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
                setLineSpacing(0f, 1.45f)
            }

        root.addView(text("浏览器内核版本过低", 26f, "#F3D896"))
        root.addView(text(
            "当前系统 WebView：$pkgName  $versionName（Chromium $major）\n" +
            "本应用需要 Chromium $MIN_CHROME 及以上，否则页面会白屏。",
            16f, "#E8D8B0"))
        root.addView(text(
            "\n三个办法：\n" +
            "1) 电视「应用商店」里更新「Android System WebView」或「Chrome」；\n" +
            "2) 设置 → 应用 → 显示系统应用 → Android System WebView → 卸载更新（部分机型可回退到可更新状态）；\n" +
            "3) 换一个外接电视盒子（系统较新），把本 APK 装到盒子上。",
            15f, "#C9B894"))

        val btn = Button(this).apply {
            text = "仍然尝试打开"
            setOnClickListener {
                (root.parent as? android.view.ViewGroup)?.removeView(root)
                startWeb(versionName)
            }
        }
        val lp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = pad }
        root.addView(btn, lp)
        setContentView(root)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun startWeb(versionName: String) {
        web = WebView(this)
        web.setBackgroundColor(0xFF0E2230.toInt())
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // 把内核版本透传给页面，出问题时可在控制台/日志里看到
                view.evaluateJavascript("window.__WV='$versionName'", null)
            }
        }
        web.loadUrl("file:///android_asset/index.html")
        web.requestFocus(View.FOCUS_DOWN)
    }

    private fun enterFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterFullscreen()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (!::web.isInitialized) { finish(); return true }
            web.evaluateJavascript("(window.__tvBack && window.__tvBack()) ? 'true' : 'false'") { r ->
                if (r == null || !r.contains("true")) finish()
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() { super.onPause(); if (::web.isInitialized) web.onPause() }
    override fun onResume() { super.onResume(); if (::web.isInitialized) web.onResume() }
    override fun onDestroy() { if (::web.isInitialized) web.destroy(); super.onDestroy() }
}
