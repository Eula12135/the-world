# 待发版改动

> 当前已发布版本：**0.8.0**（tag `v0.8.0`，2026-11-26）。
> 上一批改动已随 0.8.0 发布，这里重新开始记下一批。

---

## 待发布

（暂无）

---

## 发版检查清单（每次都要过）

1. **先更新 `release-notes.md`**。
   `publish-gitee.mjs` 读这个文件生成 `latest.json` 的 `notes`；忘了会变成「版本是新的、说明是旧的」。该文件在 `.gitignore` 里，很容易漏。
2. 升 `package.json` 的 `version`（Android `versionCode` 自动派生为 `major*10000+minor*100+patch`）。
3. `npm run typecheck` 与 `npm test` 必须全绿。
4. 构建（**必须带更新源**）：
   ```powershell
   $env:VITE_UPDATE_REPO="https://gitee.com/qiutonger/the-world/raw/main/latest.json Eula12135/the-world"
   npm run dist:win
   npm run android:sync
   cd android; .\gradlew.bat assembleRelease; cd ..
   ```
5. 发布：
   - Gitee：`npm run release:gitee`（需要 `GITEE_TOKEN`；token 可能已被从 remote 里清掉，去后台取）
   - GitHub：`gh release create vX.Y.Z <apk>`
     **APK 资产名必须是 `The-World-X.Y.Z-android.apk`**，否则 404；`file#label` 只改显示名不改文件名。
     GitHub 501/502 时先别重传：资产很可能已经传上去了，用 `gh release view` 确认后再 `--clobber` 或 `--draft=false`。
6. 提交并推送 `latest.json`，然后**必须**跑：
   ```powershell
   npm run verify:release
   ```
   回读清单 + 下载 APK 比对哈希与 `versionCode`。**0.7.1 就栽在这**：清单写 0.7.1，远端 APK 是 0.7.0，用户装完版本不变。
7. tag 打到「版本号 + latest.json」那个提交，核对两端一致。
8. 推送偶发失败先重试一次（GitHub 波动时 main 和 tag 都会报错，通常几分钟后自愈）。

---

## 已修复：那次「神秘覆盖」

2026-11-25 23:52 的覆盖已定位：`.github/workflows/build.yml` 当时配置了 `on: push: tags: ['v*']`，
并带一个 `publish-release` 任务（`softprops/action-gh-release`）。推 tag 触发 CI 在云端构建
win/mac/linux + Android，然后把产物以同名覆盖到 Release，还会塞一份 `pageUrl` 指向 GitHub 的
`latest.json`；CI 的 `VITE_UPDATE_REPO` 是 `${{ vars.VITE_UPDATE_REPO || github.repository }}`，
未配置变量时打出来的包根本没有 Gitee 更新源。

对应证据：run 45648724983，触发 ref `v0.7.1`，15:47:05Z 开始，资产在 15:52:37–45Z 被上传。

处理：**删除 `publish-release` 任务，并去掉 tag 触发**。CI 现在只回答「能不能构建」，
发布一律走本地受控脚本 + `npm run verify:release` 校验。

## 未解决的隐患

- **2026-11-25 23:52 有一次外部上传**，把 v0.7.0 / v0.7.1 的 APK 覆盖成了旧版本，并往 release 里塞了 mac/linux 产物。
  仓库里没有脚本会做这件事，来源未查明。现状由 `verify:release` 兜底。
- v0.7.0 release 里还残留 3 个删不掉的 0.6.1 资产（GitHub 一直 500）：
  `the-world_0.6.1_amd64.deb`、`The.World-0.6.1-arm64.dmg`、`The.World.Setup.0.6.1.exe`。