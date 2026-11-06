plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.timeline.atlas"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.timeline.atlas"
        minSdk = 21              // 兼容 2015 年之后的安卓电视 / 盒子
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            // 想发正式包再配签名；电视侧载用 debug 包即可
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    // assets 里的 data/*.js 已经是文本，避免被压缩算法误伤
    androidResources {
        noCompress += listOf("pdf")
    }
}

dependencies {
    // 刻意不引 androidx：只用系统 Activity + WebView，构建更快、依赖更少
}
