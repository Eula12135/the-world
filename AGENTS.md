# 项目约定（务必先读）

本文件是本仓库的工作约定。**任何模型/协作者接手时，以下规则优先于"把功能做完"的默认冲动。**

---

## 1. 发版权限归项目所有者（最重要）

**不要自作主张发布新版本。**

- ✅ 允许：随时改代码、跑 `npm run build` 做本地预览、打包给自己测试
- ❌ 禁止（除非用户在当前对话里明确说"可以发了"）：
  - 修改 `package.json` 的 `version`
  - 执行 `gh release create` / `npm run release:gitee`
  - 修改并推送 `latest.json`
  - 构建并分发 `app-release.apk` 给用户/他人

**工作流是**：改代码 → 本地构建/预览 → 用户确认满意 → 用户说可以发 → 才升版本号并发布。

历史教训：曾因"每加一个功能就发一版"，在短时间内连续发了 8 个版本（0.3.4 → 0.4.0），
用户明确要求改为由他决定发版节奏。

---

## 2. 版本号只有一个来源

`package.json` 的 `version`。Android 的 `versionCode` / `versionName` 由
`android/app/build.gradle` **自动派生**（`major*10000 + minor*100 + patch`，如 0.4.0 → 400）。

发版时必须**先提交版本号变更，再发布**，否则 tag 指向的 commit 不含 version bump。

---

## 3. 发布前的固定检查

```powershell
npm run typecheck   # 必须 0 错误
npm test            # 必须全绿
```

另外核验产物：签名指纹、`versionCode`、包内是否含更新源与当前版本号。

---

## 4. 更新机制

```
1. https://gitee.com/qiutonger/the-world/raw/main/latest.json   （清单，按平台分流）
2. Eula12135/the-world                                          （GitHub 兜底）
```

- **APK 必须指向 GitHub**：Gitee 用 `Content-Type: application/zip` 提供 `.apk`，
  浏览器会当压缩包下载（加 `.zip`、点开只弹解压）
- Windows 安装包指向 Gitee（`.exe` 的 MIME 正确且国内快）
- Gitee raw 有约 **4 分钟 CDN 缓存**，发版后清单生效有延迟

构建时必须带更新源：

```powershell
$env:VITE_UPDATE_REPO="https://gitee.com/qiutonger/the-world/raw/main/latest.json Eula12135/the-world"
```

---

## 5. 签名

- Android 正式签名：`android/keystore/the-world-release.jks` + `android/keystore.properties`
- **两者都不入库**（已在 `.gitignore`），丢失即无法再更新该 App
- 发布用 `assembleRelease`，不要分发 debug 包

---

## 6. 其它

- 商店/分发渠道尚未上架，当前为手动分发
- 详见 [RELEASE.md](./RELEASE.md) 的完整发版流程
