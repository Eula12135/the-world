# The World

**The World** 是一个纯本地运行、自带密钥（BYOK）、无任何中心服务器或账号体系的开源 AI 对话与小说世界观创作工具，同时支持 **PC 桌面端（Electron）** 与 **Android 端（Capacitor）**。

## 核心特性

1. **极简对话体验（参考 DeepSeek App）**
   - 左侧会话抽屉按置顶 / 今天 / 近 7 天 / 更早自动分组，支持搜索、置顶、重命名与导出 Markdown。
   - 完整支持推理模型 `<think>` / `reasoning_content` 思考过程折叠展示。
   - 支持编辑重发、重新生成、随时中断生成，以及一键将回答「追加到设定文档」。

2. **多模型厂商接入与官网直达**
   - 内置 **DeepSeek、硅基流动、阿里云百炼、月之暗面 Kimi、智谱 BigModel、火山方舟、OpenRouter、OpenAI、Anthropic Claude、Google Gemini、Ollama（本地离线）** 以及自定义 OpenAI 兼容端点。
   - 桌面端使用系统密钥库（Electron `safeStorage`）加密保存 API Key；Android 端在 WebView 跨域受限时自动切换 `CapacitorHttp` 原生请求。

3. **DeepSeek 官方聊天记录导入**
   - 原生支持解析 DeepSeek 官方导出的 `deepseek_data-*.zip`（Export v3）及旧版 `conversations.json`。
   - 自动还原分支对话主干、`THINK` 思考耗时、`CONTENT_RISK` 提示与搜索关键词记录，并自动检测重复导入。

4. **小说创作「世界观工坊」（纯框架 · 默认空白）**
   - **长文设定文档 + 题材参考模板**：只需输入作品名与题材即可从通用长篇、玄幻/仙侠、科幻、悬疑、都市、历史等模板起步，自由编辑 `## 章节`，自动生成目录大纲。
   - **导入已有设定文档 & AI 智能提取**：支持导入 `.md` / `.txt` / `.docx`（Word）或粘贴设定文本，可零消耗直接整理成章节文档，或一键调用模型抽取出「设定文档 + 角色卡 + 时间线 + 跨时间关系演进」。
   - **跨时间维度人物关系图谱**：结合时间线切片（如：`故事初始：挚友` → `某事件发生后：敌对`），支持横向时间轴拖拽/一键播放关系演变，以及 PC/手机双端拖拽节点画布与演进列表。
   - **渐进式披露 + 滚动前情摘要（长上下文管理）**：默认仅发送「全书目录索引 + 钉选常驻章节 + 与当前对话最相关的 Top 章节 + 截止当前时间线的有效关系（防剧透）」，长对话支持一键用 AI 浓缩早期对话为「前情摘要」。

5. **对话用途切换与多模态扩展框架（v0.3.0+）**
   - **三模式对话切换**：支持「通用助手 / 自定义人设（屏蔽默认 AI 助手前缀，纯按自写人设或本地人设预设对话）/ 扮演自建作品角色（第一人称 + 当下关系网）」，本地人设预设默认完全空白。
   - **角色形象生图**：角色卡支持本地上传压缩保存或对接 OpenAI `/v1/images/generations` 兼容接口（预置智谱免费 `cogview-3-flash`、硅基流动 `Kolors / FLUX`、本地 SD/ComfyUI 网关，并自动复用同域名文本 Key）。
   - **语音聊天框架（TTS / STT）**：支持免费离线的 PC/Android 原生系统朗读与语音识别，同时也支持接入硅基流动 `CosyVoice2` / `SenseVoiceSmall`（含免费额度）、Groq Whisper、OpenAI 或本地 `GPT-SoVITS / Kokoro` 接口。

6. **三模式应用内更新检测与局域网同步**
   - 内置 GitHub Releases（`owner/the-world`，通过 CI 构建时可自动写入默认仓库）、Gitee Releases（`gitee:owner/the-world`，国内直连免代理）以及静态/局域网 `latest.json` 清单。
   - 运行 `npm run serve:lan` 可在本地启动局域网分发页，手机填写 `http://<电脑局域网IP>:8787/latest.json` 即可在「设置 → 检查更新」直接获取新版 `.apk`。
   - 长篇作品设定上下文上限默认 **10 万字**，且支持设为 `0`（不限制字数）。

## 开源致谢

本项目在架构与长上下文设计上参考了以下优秀开源与社区实践：
- [Chatbox](https://github.com/chatboxai/chatbox)（Electron + Capacitor 跨端架构思路）
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio)（多厂商聚合与系统密钥安全思路）
- [OpenWrite](https://github.com/ilrein/openwrite) / [Storyteller](https://github.com/orielhaim/Storyteller) / [StoryMemory-Studio](https://github.com/Jackeyhate9/StoryMemory-Studio) / [Novel-Bot](https://github.com/xiaoxiaoxiaotao/novel-bot)（渐进式披露、Codex 演进与滚动记忆架构）

## 本地开发、打包与手机同步

> 环境要求：Node.js >= 22，pnpm >= 10，JDK 21 + Android SDK（本地编译 APK 时需要）。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 Web 或 PC 桌面端开发调试
pnpm dev
pnpm run dev:electron

# 3. 运行类型检查与单元测试
npm run typecheck
npm test

# 4. 构建 PC 桌面端安装包 (Windows / macOS / Linux)
npm run build && npm run build:electron
npx electron-builder --win

# 5. 同步并构建 Android Debug APK
npm run android:sync
cd android && ./gradlew assembleDebug --no-daemon

# 6. 通过 USB 覆盖安装更新到手机（保留原有本地数据，需开启手机 USB 调试）
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# 7. 或通过 Wi-Fi 局域网直接检测更新并下载 APK（无需 USB 线）
npm run serve:lan
```

也可以将代码推送到 GitHub（或 Gitee），打上 `v0.2.1` 等 Tag 后内置的 `.github/workflows/build.yml` 会自动将 `GITHUB_REPOSITORY` 写入安装包作为默认更新源、构建全平台安装包并自动发布 GitHub Release。

## 后续规划

待实装的功能设想（如可分享角色卡含立绘与语音等）记录在 [docs/ROADMAP.md](./docs/ROADMAP.md)。

## 已知限制

- **Android 端局域网 / 本地模型地址**：App 页面运行在 `https://localhost` 源下，填 `http://` 的地址（如 `http://192.168.1.10:11434/v1`）会被 WebView 当作混合内容拦截，随后自动回退为**原生 HTTP 非流式**请求——功能可用，但不再逐字输出。介意体验的话请在 Android 端使用 `https://` 端点，或改用桌面端/浏览器。
- **Android 6–9（API 23–28）**：「保存图片到相册」不可用（应用未申请存储权限），会提示保存失败；Android 10 及以上正常。
- **API Key 存储**：桌面端使用系统密钥库（Electron `safeStorage`）加密；Android 端没有等价的系统级密钥库，Key 以明文保存在应用私有存储（IndexedDB）中，未 root 的设备上其它应用无法读取。对外宣传请以本段为准，不要笼统写「加密存储」。

## 隐私、合规与开源协议

- **许可证**：[MIT License](./LICENSE)
- **纯本地框架声明**：The World 不提供任何后端服务器、账号体系、云同步或大模型算力服务；不内置任何预设角色卡或越狱提示词。所有 API Key、对话记录与小说设定均仅保存于用户自己的设备本地（IndexedDB）。数据备份默认不包含 API Key。使用第三方模型 API 时，请自行遵守对应厂商的服务条款与所在地法律法规。
