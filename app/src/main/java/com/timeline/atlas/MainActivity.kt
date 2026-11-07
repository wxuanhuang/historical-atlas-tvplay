package com.timeline.atlas

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 时空巧记 · 大屏 / 触屏壳
 *
 * 2026-11-06 关键改动：**启动阶段打点**
 *   "点开图标立刻退回桌面" 这种情况，进程会被系统直接杀掉，屏幕上什么都不会留下。
 *   所以每走一步都同步写一次 SharedPreferences（commit 会立即落盘），
 *   下次打开时如果发现上次没走到 "ok"，就把停住的位置显示出来 —— 这样不用连电脑抓日志。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val MIN_CHROME = 80

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prev = lastMark()
        if (prev != null && prev != "ok") {
            showLastStop(prev)
            return
        }
        try {
            boot()
        } catch (t: Throwable) {
            showFatal("启动阶段异常", t)
        }
    }

    private fun boot() {
        mark("① 进入界面")

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterFullscreen()
        mark("② 全屏设置完成")

        val info = webViewInfo()
        mark("③ 读到 WebView：${info.second}（Chromium ${info.third}）")
        Log.i("Atlas", "package=${info.first} version=${info.second} major=${info.third}")

        if (info.third in 1 until MIN_CHROME) {
            showKernelWarning(info.first, info.second, info.third)
            return
        }
        startWeb(info.second)
    }

    /* ---------- 启动打点 ---------- */
    private fun mark(step: String) {
        try {
            getSharedPreferences("boot", Context.MODE_PRIVATE)
                .edit().putString("last", step).commit()      // commit 是同步写盘
        } catch (t: Throwable) { /* 打点失败不影响主流程 */ }
    }
    private fun lastMark(): String? = try {
        getSharedPreferences("boot", Context.MODE_PRIVATE).getString("last", null)
    } catch (t: Throwable) { null }
    private fun clearMark() = mark("ok")

    private fun showLastStop(step: String) {
        try {
            AlertDialog.Builder(this)
                .setTitle("上次启动没有走完")
                .setMessage(
                    "停在了：\n$step\n\n" +
                    "请把这句话截图发我。常见原因：\n" +
                    "· 系统把「Android System WebView」卸载/禁用了\n" +
                    "· 应用被安全中心拦截（小米/荣耀/OPPO 常见）\n" +
                    "· APK 里 assets 没打进去"
                )
                .setPositiveButton("继续启动") { _, _ ->
                    try { boot() } catch (t: Throwable) { showFatal("启动失败", t) }
                }
                .setNegativeButton("退出") { _, _ -> finish() }
                .show()
        } catch (t: Throwable) { Log.e("Atlas", "显示上次停机点失败", t) }
    }

    /** 读取系统 WebView 的包名与版本 */
    private fun webViewInfo(): Triple<String, String, Int> {
        var pkgName = ""
        var version = ""
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val p = WebView.getCurrentWebViewPackage()
                pkgName = p?.packageName ?: ""
                version = p?.versionName ?: ""
            }
            if (version.isEmpty()) {
                val candidates = listOf(
                    "com.google.android.webview",
                    "com.android.webview",
                    "com.android.chrome",
                    "com.huawei.webview"
                )
                for (c in candidates) {
                    try {
                        val pi = packageManager.getPackageInfo(c, 0)
                        pkgName = c
                        version = pi.versionName ?: ""
                        break
                    } catch (e: PackageManager.NameNotFoundException) { /* 继续找 */ }
                }
            }
        } catch (t: Throwable) {
            Log.w("Atlas", "读取 WebView 版本失败", t)
        }
        val major = version.substringBefore('.').trim().toIntOrNull() ?: 0
        return Triple(pkgName, version, major)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun startWeb(versionName: String) {
        mark("④ 创建 WebView")

        web = WebView(this)
        web.setBackgroundColor(0xFF0E2230.toInt())
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
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
                view.evaluateJavascript("window.__WV='$versionName'", null)
                clearMark()                       // 走到这里 = 一切正常
            }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                super.onReceivedError(view, req, err)
                if (req.isForMainFrame) {
                    mark("⑤ 页面加载失败：${err.errorCode}")
                    showLoadError(req.url.toString(), err.errorCode.toString(), err.description.toString())
                }
            }
        }
        mark("⑤ 开始加载 assets/index.html")
        web.loadUrl("file:///android_asset/index.html")
        web.requestFocus(View.FOCUS_DOWN)
    }

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
            "本应用需要 Chromium $MIN_CHROME 及以上，否则页面会白屏。", 16f, "#E8D8B0"))
        root.addView(text(
            "\n三个办法：\n" +
            "1) 应用商店里更新「Android System WebView」或「Chrome」；\n" +
            "2) 设置 → 应用 → 显示系统应用 → Android System WebView → 卸载更新；\n" +
            "3) 换一个外接电视盒子（系统较新）。", 15f, "#C9B894"))

        val btn = Button(this).apply {
            text = "仍然尝试打开"
            setOnClickListener {
                (root.parent as? android.view.ViewGroup)?.removeView(root)
                try { startWeb(versionName) } catch (t: Throwable) { showFatal("加载页面失败", t) }
            }
        }
        root.addView(btn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = pad })
        setContentView(root)
        mark("③' 内核过低提示页")
    }

    private fun showLoadError(url: String, code: String, desc: String) {
        try {
            AlertDialog.Builder(this)
                .setTitle("页面加载失败")
                .setMessage("URL：\n$url\n\n错误码：$code\n$desc\n\n" +
                    "多半是 APK 里没有打包进 assets/index.html，或 data/ 目录缺失。")
                .setPositiveButton("知道了", null)
                .show()
        } catch (t: Throwable) { Log.e("Atlas", "显示错误弹窗失败", t) }
    }

    private fun showFatal(title: String, t: Throwable) {
        Log.e("Atlas", title, t)
        val trace = Log.getStackTraceString(t).take(1200)
        mark("✗ $title: ${t.javaClass.simpleName}")
        try {
            AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(trace)
                .setPositiveButton("关闭") { _, _ -> finish() }
                .setCancelable(false)
                .show()
        } catch (e: Throwable) {
            val tv = TextView(this).apply {
                text = "$title\n\n$trace"
                setTextColor(Color.parseColor("#F3D896"))
                setBackgroundColor(Color.parseColor("#0E2230"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(40, 40, 40, 40)
            }
            setContentView(tv)
        }
    }

    private fun enterFullscreen() {
        try {
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
        } catch (t: Throwable) {
            Log.w("Atlas", "全屏设置失败（不影响使用）", t)
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
