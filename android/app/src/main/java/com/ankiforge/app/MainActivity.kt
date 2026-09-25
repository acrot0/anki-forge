package com.ankiforge.app

import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * WebView 壳：加载 GitHub Pages 上的体验页（含 PWA 缓存），本地引擎与
 * FSRS 学习进度全部在页面内运行。文件选择（导入 Word/PDF/图片 OCR）
 * 通过 onShowFileChooser 桥接到系统文件选择器——没有它页面里的
 * <input type=file> 在 WebView 里打不开，这是导入功能的生命线。
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = if (result.resultCode == RESULT_OK && result.data != null) {
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            } else null
            fileCallback?.onReceiveValue(uris ?: arrayOf())
            fileCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage：FSRS 学习进度
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = false  // TTS 自动发音
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams?
            ): Boolean {
                fileCallback = callback
                val intent = params?.createIntent() ?: return false
                try {
                    fileChooser.launch(intent)
                } catch (e: Exception) {
                    fileCallback = null
                    return false
                }
                return true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                // 站内（GitHub Pages）留在应用；外链交给系统浏览器
                val host = request?.url?.host ?: return false
                return host != "acrot0.github.io"
            }
        }
        setContentView(webView)
        webView.loadUrl("https://acrot0.github.io/anki-forge/")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
