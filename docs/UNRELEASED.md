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

### 3. 生图取景跟随尺寸（头像不再画成全身）

- 问题：生图尺寸选「1024x1024（头像）」，出来的却是全身像 —— 内置提示词当年写死了「角色立绘」「半身」，跟尺寸完全脱钩。
- 改动：新增 `src/utils/imageFraming.ts`，把三档尺寸和取景绑在一处：
  - `1024x1024` → 头像特写（只画头肩，明确排除腰部以下）
  - `768x1024` → 半身立绘（取景到膝盖以上）
  - `1024x768` → 横版场景（角色与环境同框）
  - 非预设尺寸按宽高比归类（竖版→半身、横版→场景、方→头像），自定义尺寸也不会画错
- `buildCharacterImagePrompt()` 增加 `size` 参数；AI 提炼（`generateImagePrompt`）也把取景写进 system prompt，并在末尾追加构图 + 负向约束（模型自己写了就不重复追加）。
- 设置页的尺寸选项改用同一份定义；角色编辑页显示「当前取景」，避免选了尺寸却不知道会画成什么。
- 测试：新增 5 个用例（预设映射、按比例兜底、本地拼装、AI 提炼追加、clause 复用）。

### 4. UI 收敛一轮（token + 角色卡取景/画风）

- 字号从 14 档收到 4 档（11.5 / 13 / 15 / 17，另有 20 只用于空状态 hero）；圆角从 4 档收到 2 档（卡片 12、控件 8，加胶囊）
- `--text-muted` 从 `#9ca3af`（白底 2.54:1）提到 `#6b7280`（4.83:1）；新增 `--accent-strong`（小字号强调文字）、`--danger / --warn / --success` 语义色。组件里内联的 red/emerald/amber 还没迁移，留作下一轮
- 角色形象卡重做：取景三档胶囊 + 画风胶囊（默认 / 不指定 / 厚涂 / 国风工笔 / 更多）+ 提示词折叠一行；整体高度比改版前还矮一点
- 新增可选字段 `Character.imageFramingId` / `imageStyleId`：不填就跟随全局生图设置，老角色卡行为不变
- 切胶囊会按新值重拼提示词；用户手动改过提示词后不再自动覆盖（`imgPromptDirty`）
- 顺带清掉身份里引号被剥离后残留的「（外号，）」

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
