export const WORLD_GENRES = [
  '玄幻',
  '仙侠',
  '科幻',
  '都市',
  '悬疑',
  '历史',
  '奇幻',
  '其他',
] as const;

export interface WorldTemplate {
  id: string;
  name: string;
  description: string;
  genres: string[];
  document: string;
}

export interface DocSection {
  heading: string;
  body: string;
  charCount: number;
  lineStart: number;
}

export const WORLD_TEMPLATES: WorldTemplate[] = [
  {
    id: 'general',
    name: '通用长篇 10 章设定模板',
    description: '涵盖世界概述、地理、体系、势力、历史、文化、法则与主线冲突',
    genres: ['奇幻', '其他'],
    document: `## 一、世界概述
> 提示：用 2~3 句话概括这个世界最核心的设定，以及它与现实世界最大的不同。


## 二、时代与地理
> 提示：写明故事所处的时代背景、主要疆域版图、气候地貌与核心地标。


## 三、力量 / 科技体系
> 提示：能力或技术从哪里来？如何划分等级？使用它们需要付出什么代价或限制？


## 四、势力与组织
> 提示：列出最主要的几股势力，各自的诉求、资源与相互关系。


## 五、历史年表
> 提示：影响当前格局的 3~5 个重大历史节点，以及它们留下的后遗症。


## 六、社会与文化
> 提示：普通人的日常生活、社会阶层、信仰、风俗与经济运转方式。


## 七、规则与禁忌
> 提示：这个世界绝对不能违反的硬性规则或物理/社会禁忌（AI 创作时须严格遵守）。


## 八、主要角色简表
> 提示：简述核心人物定位与彼此牵绊（详细人物可同时记录在右侧「角色卡」中）。


## 九、核心冲突与主线
> 提示：整部作品要解决的根本矛盾是什么？主角团面临的最大危机是什么？


## 十、文风与写作禁忌
> 提示：叙事视角（第一/第三人称）、语言风格、节奏偏好，以及希望 AI 避免的写法。

`,
  },
  {
    id: 'xianxia',
    name: '玄幻 / 仙侠修真模板',
    description: '专为修仙、境界体系、宗门势力、天地法则与因果劫难设计',
    genres: ['玄幻', '仙侠'],
    document: `## 一、世界观与灵气本质
> 提示：天地元气/灵力的来源、分布是否正在枯竭或异变？凡人与修士的根本差异是什么？


## 二、境界划分与修行代价
> 提示：从低到高列出核心修行境界、突破条件、寿元变化与走火入魔/天劫风险。


## 三、天地地理与秘境
> 提示：划分几大洲域、险地绝域、代表性灵脉与秘境遗迹。


## 四、宗门、世家与皇朝
> 提示：正道宗门、魔门/散修联盟、世俗皇朝之间的资源争夺与利益平衡。


## 五、上古秘辛与纪元更迭
> 提示：曾经断代的古史、陨落的强者或遗留的因果伏笔。


## 六、法宝、丹药与货币体系
> 提示：灵石/丹药/法器如何流通与评级？稀缺资源掌握在谁手里？


## 七、天道铁律与禁忌
> 提示：不可逆转的天地法则（如因果反噬、界域壁垒、飞升限制等）。


## 八、核心人物与主线脉络
> 提示：主角的起点、金手指/执念，以及卷入的宏观风暴。


## 九、文风要求
> 提示：偏传统古典仙侠、冷峻群像还是节奏明快的升级流？

`,
  },
  {
    id: 'scifi',
    name: '科幻 / 星际 / 赛博模板',
    description: '聚焦技术树边界、太空/赛博空间结构、社会制度与人机伦理',
    genres: ['科幻'],
    document: `## 一、核心科幻假设 (What-If)
> 提示：如果哪一项关键技术突破或宇宙规律改变，引发了整个世界的连锁重构？


## 二、科技树与物理边界
> 提示：能源、航行（是否超光速）、AI、义体/基因改造各自发展到了哪一步？什么是目前仍做不到的？


## 三、空间版图与生态环境
> 提示：星图航线、殖民地/空间站分布、或者近未来都市的上下层地理划分。


## 四、政体、公司与阵营博弈
> 提示：联邦、巨型企业、独立舰队或地下反抗组织的权力结构与矛盾。


## 五、重大历史与灾难节点
> 提示：例如第一次接触、智械危机、大迁徙或协议战争等转折点。


## 六、普通人的生活与阶级分化
> 提示：技术红利如何分配？底层与精英在寿命、教育、接入权上的差距。


## 七、硬性物理与逻辑限制
> 提示：光速延迟、热力学散热、生态闭环等不可违背的硬约束，避免剧情写崩。


## 八、核心矛盾与文风要求
> 提示：偏硬核推演、太空歌剧还是社会派赛博朋克？

`,
  },
  {
    id: 'mystery',
    name: '悬疑 / 推理 / 规则怪谈模板',
    description: '重点记录案发舞台、隐藏真相、线索清单与各人物不在场证明',
    genres: ['悬疑'],
    document: `## 一、舞台背景与封闭条件
> 提示：故事发生在哪座城市/建筑/封闭场所？为什么人物无法轻易逃离或求助？


## 二、核心谜团与表面现象
> 提示：最初呈现给读者和侦探的离奇现象、案件或异常规则是什么？


## 三、幕后真相（仅对 AI 可见）
> 提示：真实凶手/幕后推手的完整作案动机、手法与时间差设计（注意防止在正文过早剧透）。


## 四、关键线索与误导红鲱鱼
> 提示：列出必须合理埋下的真线索，以及用来干扰判断的假线索。


## 五、人物秘密与动机网
> 提示：每个在场人物各自隐瞒了什么秘密？谁和受害者/核心事件有利益冲突？


## 六、诡计/规则的硬性限制
> 提示：故事中绝对不能出现超自然机械降神，或者怪谈必须严格遵守哪些触发条件？


## 七、叙事节奏与视角要求
> 提示：限知视角还是多线视角？是否需要严格遵循「公平推理」原则？

`,
  },
  {
    id: 'urban',
    name: '都市 / 现代现实 / 群像模板',
    description: '适合现代情感、职场商战、都市异能或现实主义群像小说',
    genres: ['都市'],
    document: `## 一、故事舞台与城市气质
> 提示：故事发生在真实城市还是虚构都市？具体的行业圈层、街区氛围与季节感。


## 二、现实规则与隐秘设定（如有）
> 提示：若是纯现实题材写行业背景与社会规则；若有微超自然元素，写明它如何隐藏在现代社会下。


## 三、核心圈层与人际关系网
> 提示：主角身处的家庭、公司、学界或利益集团，各方的资源与痛点。


## 四、主角困境与成长弧光
> 提示：主角当下最现实的渴望与枷锁是什么？故事想探讨什么主题？


## 五、生活质感与文风要求
> 提示：偏细腻日常、凌厉商战还是幽默轻快？对话是否追求口语化和潜台词？

`,
  },
  {
    id: 'history',
    name: '历史 / 架空权谋模板',
    description: '梳理朝代制度、官制兵制、版图气候、礼法民俗与时代局限',
    genres: ['历史'],
    document: `## 一、时代坐标与天下大势
> 提示：参照哪个历史时期或从哪个分歧点架空？当前是开国、盛世、中衰还是乱世？


## 二、疆域州郡与交通关隘
> 提示：都城、边疆重镇、漕运/粮道与兵家必争之地的位置关系。


## 三、政治制度与军制经济
> 提示：中枢权力如何制衡（皇权/相权/藩镇/世族）？兵源、税赋与货币怎么运转？


## 四、礼法、宗族与社会风貌
> 提示：婚姻、科举/举荐、衣食住行、称谓避讳等时代细节。


## 五、核心人物与派系博弈
> 提示：朝堂与地方的主要派系，各自的政治诉求与底线。


## 六、考据底线与文风要求
> 提示：禁止出现哪些跨时代现代词汇或违背当时生产力的技术？文风偏白话还是半文白？

`,
  },
  {
    id: 'blank',
    name: '空白自由文档',
    description: '不套用任何固定大纲，从一张白纸自由书写你的世界观',
    genres: [],
    document: `## 一、世界设定\n\n`,
  },
];

export function getRecommendedTemplateId(genre: string): string {
  const hit = WORLD_TEMPLATES.find((t) => t.genres.includes(genre));
  return hit ? hit.id : 'general';
}

/**
 * 第一个标题之前的内容（卷名、简介、卷首语）会被归到这个合成章节，
 * 否则它既进不了目录索引也进不了提示词，属于静默丢数据。
 */
export const PREAMBLE_HEADING = '（前言）';

/**
 * 把世界观长文按 markdown 标题切成章节。
 * - 支持 `#` 与 `##` 两级标题（`###` 及更深视为正文内容）
 * - 第一个标题之前的内容作为「（前言）」章节保留
 */
export function parseDocumentSections(doc: string): DocSection[] {
  const lines = (doc || '').split(/\r?\n/);
  const sections: DocSection[] = [];
  let currentHeading: string | null = null;
  let currentStart = 0;
  let buffer: string[] = [];
  const preambleLines: string[] = [];

  const flush = () => {
    if (currentHeading !== null) {
      const body = buffer.join('\n').trim();
      sections.push({
        heading: currentHeading,
        body,
        charCount: body.length,
        lineStart: currentStart,
      });
    }
  };

  lines.forEach((line, idx) => {
    const match = line.match(/^(#{1,2})\s+(.+)$/);
    if (match) {
      flush();
      currentHeading = match[2].trim();
      currentStart = idx;
      buffer = [];
    } else if (currentHeading !== null) {
      buffer.push(line);
    } else {
      preambleLines.push(line);
    }
  });
  flush();

  const preamble = preambleLines.join('\n').trim();
  if (preamble) {
    sections.unshift({
      heading: PREAMBLE_HEADING,
      body: preamble,
      charCount: preamble.length,
      lineStart: 0,
    });
  }

  return sections;
}
