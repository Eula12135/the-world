# 发版流程（Release）

> **当前状态**：GitHub Actions 因账号限制暂不可用（Actions 被锁、Packages 被禁），发版先按本文手动执行。
> 账号恢复后，直接 `git tag vX.Y.Z && git push origin vX.Y.Z` 即可由 `.github/workflows/build.yml` 全自动构建并发布。

---

## 0. 先理解更新机制（很重要）

App 内的「检查更新」支持三种来源，多个源可用空格 / 逗号 / 换行分隔，按顺序回退：

```
https://gitee.com/qiutonger/the-world/raw/main/latest.json Eula12135/the-world
```

- 该地址是在**构建时**通过 `VITE_UPDATE_REPO` 环境变量烘进包里的
  （`vite.config.ts` → `import.meta.env.VITE_UPDATE_REPO` → `updateChecker.ts` 的 `DEFAULT_UPDATE_SOURCE`）
- 优先使用 `latest.json`（国内直连 Gitee Raw 读取版本号与说明；Windows 安装包走 Gitee，Android APK 走 GitHub Releases 以保证 `.apk` MIME 正确）
- 当作为仓库 API 兜底时，桌面端挑选 `*setup*.exe`，Android 端挑选 `*.apk`
- 版本号来自 `package.json` 的 `version`，构建时注入成 `__APP_VERSION__`（**唯一来源，不要在代码里硬编码**）

> ⚠️ **每次构建都必须带上 `VITE_UPDATE_REPO`**。
> 漏了的话包里的更新源是空字符串，App 永远不会提示更新——而且这个错误在界面上看不出来。

### 更新源优先级（0.3.10 起）

```
1. https://gitee.com/qiutonger/the-world/raw/main/latest.json   ← 清单，可动态换下载源
2. gitee:qiutonger/the-world                                     ← Gitee Release API
3. Eula12135/the-world                                           ← GitHub Release API
```

清单里按平台分流，**原因很重要**：

| 平台 | 下载来源 | MIME |
|---|---|---|
| Android | **GitHub** | `application/vnd.android.package-archive` ✅ |
| Windows | Gitee | `application/vnd.microsoft.portable-executable` ✅ |

**Gitee 用 `Content-Type: application/zip` 提供 `.apk`**，浏览器会把它当压缩包、追加 `.zip`，
换浏览器/改文件名都没用（浏览器按 MIME 判定）。所以 APK 必须走 GitHub。

> ⚠️ **Gitee raw 有约 4 分钟的 CDN 缓存**：发版后立即提交 `latest.json`，
> 客户端要过几分钟才能看到新版本。验证时如果读到旧版本，等一会再试，别以为没生效。

---

## 1. 升版本号

只改 `package.json` 里的 `version` 一处，例如 `0.3.7` → `0.3.8`。

Android 的 `versionCode` / `versionName` 由 `android/app/build.gradle` 从 `package.json` **自动派生**（`major*10000 + minor*100 + patch`，0.3.7 → 307），不再需要手动同步。

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
$env:VITE_UPDATE_REPO="https://gitee.com/qiutonger/the-world/raw/main/latest.json Eula12135/the-world"
npm run dist:win
# 产物：release/The World Setup <version>.exe  /  release/The World <version>.exe

# Android（正式发布签名，需本机存在 android/keystore.properties）
$env:VITE_UPDATE_REPO="https://gitee.com/qiutonger/the-world/raw/main/latest.json Eula12135/the-world"
npm run android:sync
cd android; .\gradlew.bat assembleRelease; cd ..
# 产物：android/app/build/outputs/apk/release/app-release.apk
# 调试包（debug 签名，用于本地 adb install -r 测试）：.\gradlew.bat assembleDebug
```

macOS / Linux 只能在对应平台上构建：

```bash
npm run dist:mac     # 需 macOS
npm run dist:linux   # 需 Linux 或 Docker
```

---

## 4. 发布 Release

**主源是 Gitee（国内免代理）**，GitHub 只作兜底。

```powershell
# 需要 Gitee 私人令牌（勾选 projects 权限）
$env:GITEE_TOKEN="你的私人令牌"
npm run release:gitee
```

`scripts/publish-gitee.mjs` 会一次做完：

- 检查安装包体积（**超过 100 MB 直接报错**，Gitee 单文件上限）
- 创建 Release（已存在则复用）
- 上传 Windows 安装包 + blockmap + Android APK
- **只保留最近 2 个版本**，更早的自动删除（免费仓库容量约 500 MB，一个版本占 ~94 MB）

GitHub 兜底源照旧：

```powershell
gh release create v0.3.8 `
  "release/The World Setup 0.3.8.exe" `
  "release/The World Setup 0.3.8.exe.blockmap" `
  "$env:TEMP\The-World-0.3.8-android.apk" `
  --title "The World v0.3.8" --notes-file .\notes.md
```

> 历史备注：0.3.5 及更早发版时，90 MB 文件经代理上传会卡死，只能走浏览器；
> 配好「Gitee/上传域名直连」覆写后，命令行 22 秒即可完成（见文末）。

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

### 大文件上传卡住（已解决）

**根因**：本机网络经 TUN 代理，上传 90 MB 以上文件时 `gh release upload` 与 `curl` 都会卡死（小文件正常：4.4 MB 约 30 秒）。浏览器上传虽然能成，但 82 MB 要 20 分钟。

**解决办法**：在 Clash Party（Mihomo Party）里加一条覆写，只让上传/下载相关的 GitHub 子域名直连：

```yaml
+rules:
  - "DOMAIN,uploads.github.com,DIRECT"
  - "DOMAIN,api.github.com,DIRECT"
  - "DOMAIN-SUFFIX,githubusercontent.com,DIRECT"
  - "DOMAIN-SUFFIX,github-releases.githubusercontent.com,DIRECT"
```

注意 **不要**用 `DOMAIN-SUFFIX,github.com,DIRECT` —— 实测本机线路下 `github.com` 本体直连会 TLS 握手失败，`git push/pull` 会挂；而 `api.github.com` 和 `uploads.github.com` 直连正常。

效果：`gh release create` 上传 90 MB 安装包耗时 **22 秒**（约 3.5 MB/s，比走代理快 24 倍）。

覆写文件位置（Clash Party 会把它复制成 `<id>.yaml`，**改原始文件无效，要改副本或重新导入**）：

```
%APPDATA%\mihomo-party\override\github-direct.yaml     ← 源文件
%APPDATA%\mihomo-party\override\<id>.yaml              ← 实际生效的副本
```

### 发版顺序的一个坑

`gh release create` 会在**当前 HEAD** 上打 tag。所以务必**先提交版本号变更再发版**，否则 tag 指向的上一个 commit 不含 version bump（v0.3.5 就踩了这个坑，功能无影响，但 tag 与 `package.json` 不同步）。

### 未做代码签名

所有安装包均未签名，Windows SmartScreen 会提示「未知发布者」。需引导用户点「更多信息 → 仍要运行」。
若要消除该提示，需要购买 OV/EV 代码签名证书并配置到 `electron-builder` 的 `win.certificateFile`。
