plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.timeline.atlas"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.timeline.atlas"
        minSdk = 23              // Android 6.0 起（API 21/22 的 WebView 兼容性差，且占比已很低）
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
        multiDexEnabled = true
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
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
    androidResources {
        noCompress += listOf("pdf")
    }
    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }
}

dependencies {
    // 显式声明 Kotlin 标准库：默认会自动加，但显式写死可避免某些 AGP/Kotlin 组合下
    // stdlib 没被打进 APK，导致启动即 NoClassDefFoundError（表现就是"点开立刻退回桌面"）
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    // 仍然不引 androidx：只用系统 Activity + WebView
}
