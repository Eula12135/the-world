# 「我」的用户身份（User Identity）设计稿

- 日期：2026-11-23
- 状态：待评审
- 适用版本：0.5.1 之后

---

## 1. 问题

当前对话支持选择 AI 扮演的角色，但没有任何机制定义"屏幕前的人是谁"：

- 角色扮演提示词只写「以角色第一人称**和用户**对话」，全文没有一句"用户是谁"（`contextBuilder.ts`）。
- 用户气泡右侧只有文字，没有名字、没有头像（`MessageItem.tsx`）。
- `ChatSession` 只有 `roleCharacterId`（AI 演谁），没有"我演谁"。
- 全仓库不存在 `userName` / 用户人设之类的字段。

结果是模型只能对着一个匿名"你"说话，称谓、关系、立场全靠自己脑补，这是"凭空出现的角色"这个体感问题的直接来源。

无世界观的独立角色卡问题最严重：有作品的卡里"我"往往是主角，作品文档已隐含身份，模型能猜；独立卡则一点线索都没有。

## 2. 目标与非目标

### 目标

1. 用户能指定"我以谁的身份进入对话"，并让模型明确知道。
2. 支持两种身份来源：直接引用一张角色卡（双卡对戏），或临时捏一个自建身份。
3. 关系属于（我 × 角色）的组合，不写死在任何一方。
4. 未使用该功能的会话，行为与现在完全一致。

### 非目标（第一版明确不做）

- 不把"我"并入人物关系图 / 时间线，不做关系相位随剧情推进。
- 不做"我"的分享格式与跨设备分享。
- 不做身份快照兜底："我"或角色卡被删除后，历史会话身份直接悬空降级为匿名。
- 不做作品隐含主角与所选身份的冲突消解，一律以用户所选为准。

## 3. 核心概念

### 3.1 身份来源有两种

| 场景 | 来源 | 语义 |
| --- | --- | --- |
| 双卡对戏（我演作品里的沈岚） | 引用 `Character` | 我演这个角色 |
| 突发奇想（我是他的邻居） | 自建 `UserPersona` | 我临时是这个身份 |

复制一份角色卡当身份的方案被否决：卡以后改了，身份副本不跟，会出现两个互相矛盾的"同一人"。

### 3.2 运行时统一成一个形状

```ts
export type UserIdentityKind = 'persona' | 'character';

export interface UserIdentityRef {
  kind: UserIdentityKind;
  id: string;
}

/** 渲染层与提示词层唯一消费的形状，不关心来源 */
export interface ResolvedUserIdentity {
  name: string;
  /** 角色该怎么称呼"我" */
  addressAs: string;
  /** 其他叫法，换称呼时更自然 */
  aliases?: string;
  identity: string;
  description: string;
  avatarImage?: string;
  avatarColor: string;
  /** 朗读「我」的台词时使用的音色；自建身份取自己的，引用角色卡时取该卡的 */
  voiceProfileId?: string;
  voiceName?: string;
  kind: UserIdentityKind;
  /** 溯源用的源实体 id */
  sourceId: string;
}
```

两个解析函数放在新文件 `src/services/userIdentity.ts`，避免 `contextBuilder.ts`（已 446 行）继续膨胀：

- `resolveUserIdentity(ref, personas, characters): ResolvedUserIdentity | null`
- `resolveSessionUserRelation(params): ResolvedUserRelation | null`

`contextBuilder` 与 `MessageItem` 只消费这两个结果，不感知来源分支。

## 4. 数据模型

### 4.1 新增 `UserPersona`

```ts
export interface UserPersona {
  id: string;
  name: string;
  /** 角色怎么称呼我；留空表示不指定，交给 AI 角色卡的 defaultAddress 决定（§5.4） */
  addressAs: string;
  aliases?: string;
  identity: string;
  description: string;
  avatarImage?: string;
  avatarColor: string;
  /** 朗读「我」的台词时使用的音色档案；留空则跟随全局默认声音 */
  voiceProfileId?: string;
  /** 未绑档案时的外部音色 ID 兜底 */
  voiceName?: string;
  /** 从哪张角色卡复制来的，仅作溯源，不是引用 */
  sourceCharacterId?: string;
  createdAt: number;
  updatedAt: number;
}
```

Dexie 新增表 `userPersonas`，DB 升到 v8。**纯新增表，不改动任何既有表结构**，老数据零迁移。

### 4.2 `Character` 新增关系钩子（可选）

```ts
userRelation?: {
  defaultAddress?: string;
  defaultRelationType?: RelationType;
  defaultRelationLabel?: string;
  defaultRelationDesc?: string;
  /** 用户可以是：他的同门 / 他早年失散的宿敌 */
  slotHint?: string;
};
```

用嵌套对象而非平级字段：`Character` 已有十个字段，再摊平会失控。全部可选，老卡无需迁移。

### 4.3 `ChatSession` 与 `DraftSessionConfig` 新增

```ts
/** 本次对话我以谁的身份进入 */
userIdentity?: UserIdentityRef;
/** 仅存用户显式改过的字段，不是完整关系 */
userRelationOverride?: {
  type?: RelationType;
  label?: string;
  description?: string;
  address?: string;
};
```

`userRelationOverride` 只存 override 而非完整关系，是为了让"继承上次"和"回到默认"都变成简单的复制与清空。

## 5. 解析规则

### 5.1 身份

- `kind === 'persona'`：直接映射 `UserPersona`，`identity` / `description` / `addressAs` 原样带出。`addressAs` 允许为空，语义是"我不指定称呼，交给角色卡决定"（见 §5.4）。
- `kind === 'character'`：`name` 取卡名，`identity` 取卡的身份，`description` 由性格与备注拼接，头像取卡。
- **`kind === 'character'` 时不读该卡的 `userRelation`**：那张卡上的钩子描述的是"AI 演这张卡时怎么叫用户"，与"我演这张卡"无关，读了就是张冠李戴。此分支下 `ResolvedUserIdentity.addressAs` 恒为空串，称呼完全交给 §5.4。
- **但音色要读那张卡**：我演这张卡，这张卡的声音就是"我"的声音，这是不同性质的字段。同一张卡上，`userRelation` 属于"AI 面向用户"的约定，`voiceProfileId` 属于"这个角色本身"，所以前者舍弃、后者继承。
- 源实体不存在（被删）：返回 `null`，会话降级为匿名，UI 提示"原身份已不存在"，但保留 ref 以便用户重新选择。

### 5.2 关系取值优先级

```
本会话 override（逐字段覆盖）
  ↓ 覆盖在
两卡之间已有的人物关系（仅当身份是角色卡且与 AI 角色同作品）
  ↓ 否则
AI 角色卡上的 userRelation 默认值
  ↓ 否则
无
```

第二级是双卡对戏的额外收益：同作品的两张卡在 `CharacterRelation` 里可能已有关系，直接复用 `resolveRelationAtPoint(rel, orderedEvents, pointEventId)`，**自动带时间点与反剧透**。

**方向规则（第二级专有）**，按顺序取第一条命中的：

1. `sourceId === roleCharacterId && targetId === 身份角色 id` —— AI 对"我"的视角，最优先。
2. `directed === false` 的无向边。
3. 只存在 `身份角色 id → roleCharacterId` 的单向边时：**不使用**，视为没有关系图默认值。

第 3 条是故意留空的。"沈岚暗恋林澈、林澈并不知情"这种设定，一旦把反向边透给 AI，角色就会知道他本不该知道的事。真要让他知道，用户自己去关系微调里写。

### 5.3 继承与失效

组合键：`` `${roleCharacterId}:${userIdentity.kind}:${userIdentity.id}` ``，两者都为空时不参与匹配。

| 时机 | 行为 |
| --- | --- |
| 新建会话 | 有同组合的历史会话 → 复制其 `userRelationOverride`；否则留空 |
| 中途切换 AI 角色或「我」 | override 立即失效（清空），再按新组合键走一次继承 |
| 切到通用助手 | **不清空**，只是不注入；切回来仍然有效 |
| 用户点「回到默认」 | 清空 override，且不做继承 |

切换时必须清空：否则你从"叫我师兄"的会话切到另一个角色，称呼会跟着跑过去。

### 5.4 称呼

```
会话 override.address
  → 身份 addressAs（仅 persona，且非空时）
  → roleCharacter.userRelation.defaultAddress
  → 身份 name
```

为什么 AI 角色卡的钩子排在身份自填之后：用户明确写下的称呼应当压过卡的默认值。而 persona 的 `addressAs` 留空即表示"不指定"，这时才轮到卡的 `defaultAddress` 生效 —— 独立卡上写 `defaultAddress: "旅人"`，用户新建 persona 只填了名字，林澈就会叫他"旅人"。

也正因为如此，§5.1 不能从身份卡上取 `addressAs`：AI 怎么称呼"我"，由 **AI 那张卡** 决定，不是由"我"那张卡决定。

## 6. 提示词注入

### 6.1 内容与注入范围

新增 `buildUserBlock(resolvedIdentity, resolvedRelation)`，产出：

```
【关于"我"（正在与你对话的人）】
- 称呼：小澈（日常这么叫）
- 其他叫法：阿澈
- 身份：大学同学，摄影社的
- 人设：……

【你我关系】
- 同门师兄妹 — 十五年前一同入山，此后各奔东西……

【扮演约束】
- 不要自行编造用户的姓名、外貌、身份或经历；不确定时以角色口吻直接问。
- 不要替用户描写动作、对话或心理活动。
```

注入位置：

- `character_role`：在 `buildRoleCharacterPrompt` 内，紧跟角色档案之后、补充情境之前。同时把首句「以角色第一人称身份和用户对话」改为带名字与称呼的表述，让第一句就有锚点。
- **只做 `character_role` 一个模式。** `assistant` 与 `custom_persona` 第一版不注入：入口只在"角色对话"详情区，另外两种模式没有选身份的界面，注入了用户也改不了；而且 `custom_persona` 已是遗留模式，v7 迁移正在把人往 `character_role` 搬。切到助手模式时字段保留但不注入，切回来仍然有效。
- **未选身份时完全不注入**，现有提示词逐字节不变。

### 6.2 关系去重

同一条关系有两条注入通路，必须保证只说一次：

- `buildRoleCharacterPrompt` 里的 `【你当前时间点的人物关系认知】`（遍历 `roleRelations`）
- `buildSessionSystemPrompt` 里的 `【当前时间点人物关系网】`（遍历全量 `relations`）

当 `userIdentity.kind === 'character'` 时，两处循环都要跳过"AI 角色 ↔ 身份角色"这条边，统一交给 `【你我关系】` 表达。

只改前者会漏：一旦开了世界上下文，后者照样把旧关系塞进去，模型会同时看到「对 沈岚：死敌」和「你我关系：旧友」，自相矛盾。

跳过的只限这条边。其它涉及身份角色的边（如「苏岚 ↔ 沈岚」）保留不动 —— 那是对整个世界的认知，不是对"我"的态度。

## 7. 渲染

- 用户气泡：右侧头像 + 上方小字名字，与 AI 侧对称。未选身份时保持现状。
- 用户气泡操作区新增「朗读」：用「我」的音色朗读自己这句台词（`voiceProfileId`，没有档案时回退全局默认声音）。双卡对戏时两边都能出声 —— AI 用它的声音，我用我这张卡的声音。
- 自动朗读的范围可配：`ttsAutoPlayTarget` 取 `assistant`（只读角色）、`user`（只读我）、`both`（两边都读），缺省按 `assistant` 兼容旧数据。开启后两侧朗读**串行排队**（`enqueueAutoPlay`），先播完「我」这句再播角色回复，不会互相打断。设置入口：设置 → 声音 → 朗读范围。
- 顶部关系条：`你（小澈）↔ 林澈（搭档）`；双卡时头像各用对应卡的立绘。
- 空状态文案：由「与『林澈』开启角色对话」改为「你以小澈的身份，与林澈对话」。

## 8. 交互

### 8.1 入口

放在 `SessionModeModal` 的"角色对话"详情区，新增「我以谁的身份对话」块：

- 分段切换：选一张角色卡 / 我的身份
- 列表 + 搜索；排除当前 AI 角色卡
- 新建身份：名字必填，其余可选（尽量三秒内能开聊）
- 关系微调：标签、描述、称呼、关系类型（复用 `RELATION_TYPE_META` 的中文词表）+「回到默认」

不额外增加顶部按钮：输入区已有两个触发器，再加会挤。该区块只在"角色对话"模式下可见，与 §6.1 的注入范围严格一致 —— 界面上没有入口的模式，底层也不注入。

### 8.2 分离

身份来源为角色卡时，显示"引用中"与「分离为独立身份」按钮：把当前解析结果写成新的 `UserPersona`（记 `sourceCharacterId` 作溯源），并把**当前会话**的 ref 换成 persona。其他会话仍引用原卡，UI 需明确提示这一点。

### 8.3 边角

| 情况 | 处理 |
| --- | --- |
| 两边选同一张卡 | AI 侧候选排除身份卡，身份侧候选排除 AI 角色卡 |
| 中途切换 AI 角色或「我」 | 清空 `userRelationOverride`，按新组合键重新继承（§5.3） |
| 关系图里只有反向单向边 | 不注入关系图默认值，由用户手动 override（§5.2） |
| 被引用的角色卡被删 | 身份解析返回 null，降级匿名 + 顶部提示，保留 ref |
| 被引用的 persona 被删 | 同上 |
| 老会话无 `userIdentity` | 完全保持现状，无任何注入与 UI 变化 |

## 9. 兼容与迁移

- DB v8 仅 `+ userPersonas` 表，无 upgrade 逻辑。
- `Character.userRelation`、`ChatSession.userIdentity` 均可选，老数据不填。
- 备份导出：`userPersonas` 进入 `exportService` 的备份集合；导入时 `userIdentity.kind === 'persona'` 的 ref 需要 id 重映射，`kind === 'character'` 不需要（角色卡本身已在备份内）。

## 10. 测试

- `resolveUserIdentity`：persona / character / 悬空 null；**character 分支不得读取身份卡的 `userRelation`**。
- `resolveSessionUserRelation`：四级优先、逐字段 override、双卡同作品命中关系图。
- 方向规则：正向边优先 / 无向边次之 / **反向单向边不得生效**。
- 称呼链：override → persona 自填 → AI 角色卡 `defaultAddress` → 名字，四档逐一验证。
- `contextBuilder`：有身份时注入两块 + 两条约束；**关系去重**断言同一条边只出现一次（分别覆盖开了世界上下文与没开两种情况）；无身份时提示词与改动前一致（快照对比）。
- 继承与失效：命中同组合时复制 override；切换角色或身份后 override 清空；切到 assistant 后不清空。
- DB v8：老数据在升级后不变。

## 11. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/types/index.ts` | 新增 `UserPersona`、`UserIdentityRef`、`ResolvedUserIdentity`；`Character.userRelation`；`ChatSession.userIdentity` / `userRelationOverride` |
| `src/store/types.ts` | `DraftSessionConfig` 增加同样两个字段；新增 `userPersonaSlice` 接口 |
| `src/db/database.ts` | v8 新增 `userPersonas` 表 |
| `src/services/userIdentity.ts` | 新增：两个解析函数 |
| `src/services/contextBuilder.ts` | `buildUserBlock()` + 单模式注入 + 两处关系去重跳过 |
| `src/store/slices/userPersonaSlice.ts` | 新增：CRUD + 继承 + 分离 |
| `src/components/Common/SessionModeModal.tsx` | 「我」的选择与管理区块；切换角色/身份时清空 override |
| `src/components/Chat/MessageItem.tsx` | 用户气泡头像与名字 |
| `src/components/Chat/ChatView.tsx` | 顶部关系条、空状态文案 |
| `src/components/Worlds/CharactersPanel.tsx` | 关系钩子编辑区 |
| `src/services/exportService.ts` | 备份含 `userPersonas`，persona ref 重映射 |
| `src/__tests__/` | 新增解析与继承测试，扩充 `contextBuilder.test.ts` |

## 12. 决策记录

| 议题 | 结论 | 理由 |
| --- | --- | --- |
| 关系是否写死进角色卡 | 否，改为"关系钩子 + 默认值" | 卡要能分享，写死关系会把导入者绑死 |
| 关系存哪 | 会话为准 + 新会话默认继承上次 | 兼顾连贯性与平行世界 |
| 身份实体 | 独立 `UserPersona` + 引用 `Character` 双来源 | 复制会产生两个互相矛盾的"同一人" |
| 引用还是快照 | 默认引用，允许手动分离 | 卡改动全局生效，需要独立时再断开 |
| 层数 | 两层（全局「我」/ 卡内钩子），会话层只做覆盖 | 多套可切换后，"会话覆盖"被自然吸收 |
| 删除兜底 | 不做快照，真删 | 先看效果，避免过度设计 |
| 关系字段形态 | 嵌套对象 | 避免 `Character` 平级字段膨胀 |
| 替换用户动的规则 | 保留硬约束 | 防止模型替用户写动作，是 RP 最常见的破戏点 |
| 身份卡的 `userRelation` 是否参与称呼 | 否 | 卡上的钩子语义是"AI 演这张卡时怎么叫用户"，与"我演这张卡"无关 |
| 称呼链顺序 | override → 身份自填 → AI 角色卡钩子 → 名字 | 用户明确设定压过卡的默认值，留空才交给卡决定 |
| 反向单向关系 | 不使用 | 防止把"我单方面隐藏的关系"透给 AI |
| 注入模式范围 | 仅 `character_role` | 入口只在角色模式，其它模式注入了也改不了；`custom_persona` 是遗留模式 |
| override 生命周期 | 绑定组合键，任一方变化即失效 | 否则称呼会跟着角色跑到新会话上 |

## 13. 评审修订记录

2026-11-24 对照现有代码做了一轮评审，修正 5 处：

1. **§5.1 语义错位** —— 原稿从身份角色卡上取 `addressAs`，但那张卡的钩子描述的是"AI 演它时怎么叫用户"。改为身份侧恒不读 `userRelation`，称呼走 §5.4 的四级链，由 AI 角色卡提供默认值。
2. **§6.2 关系重复注入** —— 原稿没意识到 `【当前时间点人物关系网】` 是第二条通路。改为两处都跳过"AI 角色 ↔ 身份角色"的边。
3. **§6.1 注入范围** —— 原稿三种模式都注入，但入口只在角色模式。收敛为只做 `character_role`。
4. **§5.2 有向关系** —— 原稿直接取两卡之间的边，会把"我单方面隐藏的关系"透给 AI。补方向规则。
5. **§5.3 override 生命周期** —— 原稿只写了新建会话的继承，漏了中途切换。提升为通则，任一方变化即失效。

2026-11-24 第二轮评审：

6. **「我」的音色** —— 原稿把"从被扮演的角色卡上取字段"一刀切禁掉了，理由是称呼会张冠李戴。但对于音色，取那张卡恰恰是对的：我演沈岚，沈岚的声音就是她的声音。于是：`userRelation` 仍然不读，`voiceProfileId` / `voiceName` 改为继承；`UserPersona` 也补上音色字段，用户气泡新增「朗读」，双卡对戏时两边都能出声。

2026-11-24 第三轮：

7. **自动朗读范围可选** —— 原先自动朗读只播 AI 回复。改为 `ttsAutoPlayTarget` 三档（只读角色 / 只读我 / 两边都读），并用串行队列保证先播完「我」再播角色，避免新语音打断旧语音（`speakText` 内部会 `stopSpeaking()`，不排队就会互相掐断）。

