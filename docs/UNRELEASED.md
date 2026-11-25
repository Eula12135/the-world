# 待发版改动

> 当前已发布版本：**0.7.1**（tag `v0.7.1`，2026-11-25）。
> 上一批改动已随 0.7.1 发布，这里重新开始记下一批。

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
   - Gitee：`npm run release:gitee`，需要 `GITEE_TOKEN` 环境变量。
     **注意**：`git remote get-url gitee` 里的 token 可能被清掉，届时从 gitee 后台取。
   - GitHub：`gh release create vX.Y.Z <apk> --title ... --notes-file release-notes.md`
     **APK 资产名必须是 `The-World-X.Y.Z-android.apk`**，否则 `latest.json` 里的地址会 404；
     `gh release create file#label` 里的 `#label` 只改显示名、不改文件名。
     **GitHub 偶发 502 时先别重试上传**：很可能资产已经传上去了，
     先用 `gh release view` 查 `assets`，再决定 `gh release edit --draft=false` 还是补传。
6. 提交并推送 `latest.json`，然后**必须**跑一次发布校验：
   ```powershell
   npm run verify:release
   ```
   它会回读远端清单、两个下载地址，并把 APK 下下来比对哈希与 `versionCode`。
   **0.7.1 就是栽在这步**：清单写着 0.7.1，远端 APK 却是 0.7.0，用户装完版本没变。
   GitHub 资产没建好时它会提示「尚未就绪」并不失败，建好后重跑即可。
7. 注意：改动可能在特性分支上，推之前确认 `main` 已包含它们（0.6.1 时差点把基线推上去）。
8. 发完把 tag 打到「版本号 + latest.json」那个提交上，核对两端 tag 一致。
9. 推送偶发失败时先重试一次 —— GitHub 故障期间 `main` 和 tag 推送都会报错，但通常几分钟后自行恢复。