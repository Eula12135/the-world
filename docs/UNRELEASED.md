# 待发版改动

> 当前已发布版本：**0.6.0**（tag `v0.6.0`）。
> 以下改动已进 main，但**尚未发版**。按你的节奏攒够一批再统一发，不频繁打扰用户。

---

## 待发布（v0.6.1 候选）

### 1. 生图提示词剔除台词与剧情（本地规则）

- 提交：`4189458`
- 问题：角色卡的「性格 / 补充备注」里常混着台词、口头禅和剧情，原来被整段塞进画面提示词，生图会拿台词当画面指令。
- 改动：新增 `extractVisualTraits()` —— 先剥掉引号内台词，再按标点切句，只保留含视觉线索（年龄/性别/外貌/服饰/气质）的句子；「外貌：银白长发」这类带标签的写法取冒号后内容。
- 影响面：`buildCharacterImagePrompt`，以及生图面板的「按设定快速拼装」。

### 2. 生图提示词改用文本模型提炼

- 提交：`8f29f94`
- 新增 `imagePromptService`，角色卡生图面板新增「**AI 提炼画面**」按钮（本地拼装保留为次要选项）。
- 给模型的约束：只取可画的信息，明确禁止台词/剧情/人物关系/无法具象的性格评价，资料没写的外貌不编造。
- 代价：消耗一次文本模型调用。

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
   - Gitee：`npm run release:gitee`（token 可从 `git remote get-url gitee` 里取）
   - GitHub：`gh release create vX.Y.Z ...`（APK 必须发这里，Gitee 的 APK MIME 不对）
6. 提交并推送 `latest.json`，再验证 raw 地址与两端资产字节数。
7. 本地 `release/` 只保留最近两版（Gitee 侧脚本也会只留 2 个）。

---

## 仓库清理约定

- `release/`：构建产物，已 gitignore。旧版本可删，保留最近两版即可。
- `imports/`：本地导入测试留下的素材（世界备份、截图、设定集），已 gitignore，不入库。
- `docs/designs/`：设计与决策记录，只增不删 —— 里面记了「为什么当时这么定」。
