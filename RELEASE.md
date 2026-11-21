# 发版流程（Release）

> **当前状态**：GitHub Actions 因账号限制暂不可用（Actions 被锁、Packages 被禁），发版先按本文手动执行。
> 账号恢复后，直接 `git tag vX.Y.Z && git push origin vX.Y.Z` 即可由 `.github/workflows/build.yml` 全自动构建并发布。

---

## 0. 先理解更新机制（很重要）

App 内的「检查更新」不是从商店拉的，而是直接读 GitHub Releases：

```
GET https://api.github.com/repos/Eula12135/the-world/releases/latest
```

- 这个仓库地址是在**构建时**通过 `VITE_UPDATE_REPO` 环境变量烘进包里的
  （`vite.config.ts` → `import.meta.env.VITE_UPDATE_REPO` → `updateChecker.ts` 的 `DEFAULT_UPDATE_SOURCE`）
- 桌面端挑选 `*setup*.exe`，Android 端挑选 `*.apk`
- 版本号来自 `package.json` 的 `version`，构建时注入成 `__APP_VERSION__`（**唯一来源，不要在代码里硬编码**）

> ⚠️ **每次构建都必须带上 `VITE_UPDATE_REPO`**。
> 漏了的话包里的更新源是空字符串，App 永远不会提示更新——而且这个错误在界面上看不出来。

---

## 1. 升版本号

只改 `package.json` 里的 `version` 一处，例如 `0.3.4` → `0.3.5`。

---

## 2. 本地校验

```powershell
npm run typecheck
npm test
```

---

## 3. 构建产物

```powershell
# 桌面端（Windows 安装包 + 免安装单文件）
$env:VITE_UPDATE_REPO="Eula12135/the-world"
npm run dist:win
# 产物：release/The World Setup <version>.exe  /  release/The World <version>.exe

# Android（debug 签名，可直接 adb install -r 覆盖升级）
$env:VITE_UPDATE_REPO="Eula12135/the-world"
npm run android:sync
cd android; .\gradlew.bat assembleDebug; cd ..
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

macOS / Linux 只能在对应平台上构建：

```bash
npm run dist:mac     # 需 macOS
npm run dist:linux   # 需 Linux 或 Docker
```

---

## 4. 发布 Release

```powershell
# 小文件用命令行传（快、可靠）
gh release create v0.3.5 `
  "release/The World Setup 0.3.5.exe.blockmap" `
  "android/app/build/outputs/apk/debug/app-debug.apk#The-World-0.3.5-android.apk" `
  --title "The World v0.3.5" `
  --notes-file .\notes.md
```

**90 MB 级的 `Setup.exe` 走浏览器上传**，原因见「已知问题」：

打开 `https://github.com/Eula12135/the-world/releases/edit/v0.3.5`，
把 `release/The World Setup 0.3.5.exe` 拖到页面下方附件区保存。

---

## 5. 验证（别跳过）

```powershell
# 1) latest 接口返回的版本和资产
gh api repos/Eula12135/the-world/releases/latest --jq '"tag=\(.tag_name)  assets=[\([.assets[].name]|join(", "))]"'

# 2) 资产真实可下载（看 Content-Length，不下载正文）
curl.exe -sSI -L "https://github.com/Eula12135/the-world/releases/download/v0.3.5/The.World.Setup.0.3.5.exe" |
  Select-String "^HTTP/|^Content-Length"
```

期望：`HTTP 200` 且 `Content-Length` 与本地文件字节数一致。

---

## 6. 用户在客户端怎么升级

| 平台 | 方式 |
|---|---|
| Android | App 内「设置 → 检查更新」→ 下载 APK → 拉起系统安装器（需允许一次「未知来源安装」，权限已在 manifest 声明） |
| Windows | App 内检测到新版本 → 点「下载更新」→ 跳转 Release 页面下载安装包 |
| macOS / Linux | 同上，跳转 Release 页面 |

**注意**：从「没有内置更新源的旧版本」升级到「有更新源的新版本」，**必须手动安装一次**（首次自举），之后才能在 App 内闭环更新。

---

## 已知问题

### GitHub Actions 不可用

账号 `Eula12135` 的 Actions 与 Packages 被限制，报错：

- Actions：`The job was not started because your account is locked due to a billing issue.`
- Packages：`GitHub Packages 目前已禁用该账户`

已确认与欠费无关（账单 $0、免费版、无失败发票），属于账号级限制，只能走客服人工复核。

### 大文件上传卡住

本机网络经 TUN 代理，上传 90 MB 以上文件时 `gh release upload` 与 `curl` 都会卡死（小文件正常：4.4 MB 约 30 秒）。因此大文件统一用浏览器上传。

### 未做代码签名

所有安装包均未签名，Windows SmartScreen 会提示「未知发布者」。需引导用户点「更多信息 → 仍要运行」。
若要消除该提示，需要购买 OV/EV 代码签名证书并配置到 `electron-builder` 的 `win.certificateFile`。
