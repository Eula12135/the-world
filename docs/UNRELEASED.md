# 待发版改动

> 当前已发布版本：**0.6.1**（tag `v0.6.1`，2026-11-25）。
> 上一批改动已随 0.6.1 发布，这里重新开始记下一批。

---

## 待发布

（暂无）

---

## 发版检查清单（每次都要过）

1. **先更新 `release-notes.md`**。
   `publish-gitee.mjs` 读这个文件生成 `latest.json` 的 `notes`；忘了更新会出现「version 是新版、说明是上一版」的情况 —— 0.6.0 发版时就踩过，且该文件在 `.gitignore` 里，很容易漏。
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
   - Gitee：`npm run release:gitee`（token 从 `git remote get-url gitee` 里取，需要 `GITEE_TOKEN` 环境变量）
   - GitHub：`gh release create vX.Y.Z <apk> --title ... --notes-file release-notes.md`
     **APK 资产名必须是 `The-World-X.Y.Z-android.apk`**，否则 `latest.json` 里的地址会 404
6. 提交并推送 `latest.json`，再验证 raw 地址与两端资产字节数。
7. 注意：改动可能在特性分支上，推之前确认 `main` 已包含它们（0.6.1 时差点把基线推上去）。