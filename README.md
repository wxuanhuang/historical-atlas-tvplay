# 时空巧记 · 电视大屏版（WebView 壳）

这是一个**只有 WebView 的安卓壳**，把 `index.html` + `data/` 打包进 APK：
点开即全屏、没有地址栏、不需要登录、断网也能用。

用 GitHub Actions **云端编译**，你本地不用装 Android Studio / Android SDK。

---

## 一、5 步拿到 APK

### 1. 注册 / 登录 GitHub
<https://github.com> （没有账号的话，邮箱注册即可，免费）

### 2. 新建一个仓库
右上角 **+ → New repository**

- Repository name：`timeline-atlas-tv`（随便起）
- 可见性：**Private（私有）** 也行，Actions 免费额度够用
- **不要**勾选 "Add a README file"
- 点 **Create repository**

### 3. 上传本目录的全部内容

**方法 A：网页拖拽（最简单）**

1. 把本 zip 解压，得到 `android-shell` 文件夹
2. 进入文件夹，**全选里面的所有内容**（包括 `.github` 这个隐藏文件夹）
3. 在 GitHub 仓库页面点 **Add file → Upload files**
4. 把内容拖进去 → 底部点 **Commit changes**

> ⚠️ Windows 默认不显示 `.github` 文件夹。资源管理器 →「查看」→ 勾选「隐藏的项目」才能看到。
> 少了 `.github` 就没有工作流，不会自动编译。

**方法 B：命令行（更可靠）**

```bash
cd android-shell
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/timeline-atlas-tv.git
git push -u origin main
```

### 4. 等编译（约 3–5 分钟）

上传后自动开始。在仓库页面点 **Actions** 标签：

- 看到黄色圆点 = 正在跑
- 绿色对勾 = 成功
- 红色叉 = 失败（点进去看日志，把红色部分发我）

也可以手动触发：Actions → 左侧 `Build TV APK` → 右上 **Run workflow**。

### 5. 下载 APK

点进那次成功的运行 → 页面最下方 **Artifacts** → 点 `timeline-atlas-tv-apk` → 下载 zip → 解压得到 **`app-debug.apk`**。

---

## 二、装到电视 / 盒子

1. APK 拷到 U 盘（FAT32 或 NTFS 都行），插到电视
2. 电视上打开「文件管理」，找到 `app-debug.apk`，点安装
3. 首次会提示「禁止安装未知来源应用」→ 去 **设置 → 安全 → 允许来自此来源的应用**，打开后再装
4. 装好后在电视「我的应用」里会出现 **时空巧记**（图标是系统指南针，可后续替换）

> 不同品牌路径略有差异：
> - 小米/Redmi：设置 → 账号与安全 → 允许安装未知来源应用
> - 海信/TCL/创维：设置 → 安全 → 未知来源
> - 索尼（Android TV）：设置 → 应用 → 特殊应用访问 → 安装未知应用

电视上也可以用 **当贝市场 / 沙发管家** 的「远程推送」功能，从手机直接推到电视安装。

---

## 三、遥控器怎么用

| 键 | 作用 |
|---|---|
| ← → | 上一个 / 下一个事件 |
| ↑ ↓ | 中国轴 ⇄ 外国轴 |
| OK / 确认 | 打开事件详情 |
| 返回 | 先关详情/面板/PDF；都没有才退出应用 |

---

## 四、以后更新内容怎么办

改了数据或 `index.html` 之后：

1. 用新文件覆盖 `app/src/main/assets/index.html` 和 `assets/data/`
2. 推送到 GitHub（网页上传也行：进入对应目录 → Upload files）
3. Actions 自动重新编译 → 重新下载 APK → 电视上覆盖安装

> 覆盖安装不会丢数据（页面本身不存用户数据）。

---

## 五、常见问题

**Q：Actions 红了，报 `SDK location not found`**
A：`.github/workflows/build-apk.yml` 里的 `android-actions/setup-android@v3` 那一步被删了或没生效，重新上传整个 `.github` 目录。

**Q：APK 装上后打开是白屏**
A：多半是电视的 WebView 内核太旧（本项目用了 d3 v7，需要 Chrome 80+）。
先看日志：电视装个「Logcat」类应用，或把电视的 **Android System WebView** 在应用商店更新一次。
仍不行的话，用外接盒子（小米盒子/当贝盒子，系统新）通常就好了。

**Q：遥控器按键没反应**
A：确认电视的「鼠标模式/指针模式」是关的。有些电视遥控器默认发的是鼠标事件，需要切回「按键模式」。

**Q：页面显示但不全屏**
A：壳里已经强制全屏；如果电视的画中画/系统栏还在，按一次返回再进一次应用（`onWindowFocusChanged` 会重新收）。

**Q：想改应用名 / 图标**
A：应用名在 `app/src/main/AndroidManifest.xml` 的 `android:label`；
图标把 PNG 放进 `app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` 并改成 `android:icon="@mipmap/ic_launcher"`。

---

## 六、目录说明

```
android-shell/
├── .github/workflows/build-apk.yml    ← 云编译配置（必须有）
├── settings.gradle.kts / build.gradle.kts / gradle.properties
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml        ← 应用名、图标、横屏、TV 启动器声明
│       ├── java/com/timeline/atlas/MainActivity.kt   ← 全屏 + 返回键 + WebView
│       └── assets/                    ← 你的网页（index.html + data/）
└── README.md
```

技术选择说明：**不引 androidx**，只用系统 `Activity` + `WebView`，依赖最少、构建最快、老设备兼容性最好。
