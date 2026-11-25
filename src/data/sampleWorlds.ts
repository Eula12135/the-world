import type { Character, CharacterRelation, RelationType, TimelineEvent } from '../types';
import { createId } from '../utils/platform';

export interface SampleCharacterSpec {
  key: string;
  name: string;
  identity: string;
  personality: string;
  status: string;
  relationsNote: string;
  notes: string;
  avatarColor: string;
  posX: number;
  posY: number;
  userRelation: NonNullable<Character['userRelation']>;
}

export interface SampleTimelineEventSpec {
  key: string;
  timeLabel: string;
  title: string;
  details: string;
  characterKeys: string[];
}

export interface SampleRelationPhaseSpec {
  /** 为空表示故事初始阶段；填事件 key 表示从该事件发生后转折为此状态 */
  fromEventKey?: string;
  type: RelationType;
  label: string;
  strength: 1 | 2 | 3;
  description: string;
}

export interface SampleRelationSpec {
  sourceKey: string;
  targetKey: string;
  directed: boolean;
  phases: SampleRelationPhaseSpec[];
}

export interface SampleWorldPreset {
  id: string;
  name: string;
  badge: string;
  authorNote: string;
  genre: string;
  summary: string;
  pinnedSections: string[];
  document: string;
  characters: SampleCharacterSpec[];
  timelineEvents: SampleTimelineEventSpec[];
  relations: SampleRelationSpec[];
}

export const SAMPLE_WORLD_PRESETS: SampleWorldPreset[] = [
  {
    id: 'sherlock_221b',
    name: '贝克街221B：雾都探案录',
    badge: '阿瑟·柯南·道尔（1930 逝世 · 公版原著考据）',
    authorNote:
      '严格依据柯南·道尔《福尔摩斯探案全集》原著考据：涵盖《血字的研究》《四签名》《波西米亚丑闻》《最后一案》与《空屋》五部核心篇章的时间线与人物关系演进。',
    genre: '悬疑',
    summary:
      '1881—1894 维多利亚晚期伦敦，世界唯一咨询侦探夏洛克·福尔摩斯与华生医生、艾琳·艾德勒、莫里亚蒂教授及麦考夫之间的宿命博弈。',
    pinnedSections: ['一、时代背景与维多利亚雾都', '八、叙事视角与原著防 OOC 铁律'],
    document: `## 一、时代背景与维多利亚雾都
19 世纪末（1881—1894 年）的英国伦敦，正处于维多利亚时代晚期大英帝国的鼎盛与暗影交界处。泰晤士河终年弥漫着煤烟与黄雾，鹅卵石街道上双轮汉森马车（Hansom Cab）与四轮出租马车穿行不息，煤气街灯在雾气中投下昏黄的光晕。

这是一个科学实证主义刚刚兴起、而旧式贵族体面与底层罪恶激烈碰撞的年代。电报局（Telegram）与早晚多版发行的《泰晤士报》《每日电讯报》构成了伦敦的神经网络；苏格兰场（Scotland Yard）虽已建立刑事侦查部，但在面对高智商的跨国密谋、贵族勒索与完美不在场证明时往往束手无策——由此诞生了全世界唯一一位「咨询侦探」（Consulting Detective）。

## 二、核心舞台与伦敦地标
### 1. 贝克街 221B（221B Baker Street）
位于一楼（英式 First Floor，即二层）的合租公寓，由房东哈德森太太（Mrs. Hudson）管理。拾级而上共 17 级台阶。起居室朝向贝克街，设有两扇高大的落地窗：
- **壁炉架**：用弹簧折刀钉着未拆封的信件，堆放着装在波斯拖鞋里的老切格（Shag）烟草、烟斗架，墙壁上留有用华生的左轮手枪打出的一排爱国者「V.R.」（Victoria Regina，维多利亚女王缩写）弹孔。
- **化学实验角**：摆满曲颈瓶、本生灯、试管与刺鼻的盐酸、重硫酸试剂，福尔摩斯常在此检验血迹或烟灰。
- **资料柜与剪报簿**：按字母顺序索引的巨大剪报百科全书，记录着整个欧洲大陆与伦敦的旧案、讣告与人物档案。

### 2. 第欧根尼俱乐部（The Diogenes Club）
位于白厅（Whitehall）附近的波尔摩（Pall Mall）街，由麦考夫·福尔摩斯参与创立，汇聚了全伦敦最孤僻、最不愿与人交谈的绅士。会规极其严苛：除「访客室」（Stranger's Room）外，任何会员在俱乐部内绝对禁止相互交谈，违纪三次即被开除。

### 3. 莱辛巴赫瀑布（Reichenbach Falls）
位于瑞士梅林根（Meiringen）附近的深渊绝壁。奔腾的融雪洪流坠入深不见底的黑色水潭，水雾终年腾起如浓烟，悬崖边仅有一条湿滑狭窄的泥土小径通往尽头，是 1891 年福尔摩斯与莫里亚蒂教授宿命决战之地。

## 三、演绎法与刑侦学科体系
福尔摩斯在《血字的研究》中明确划定了自己的知识边界——「人的大脑就像一间空阁楼，愚蠢的人把遇到的各种杂物都塞进去，而工匠只挑选对自己有用的工具」。
- **最高精密度掌握**：英国法律、化学分析（尤擅血液与毒物）、犯罪史（熟记近一个世纪每一桩奇案的细节）、140 种雪茄/烟斗丝/香烟灰的辨识、伦敦各区泥土颜色与车轮印痕、不同职业在手指与袖口留下的老茧、密码破译、巴顿术（Bartitsu，英式绅士防身格斗术）、击剑、拳击与小提琴演奏。
- **刻意忽略的学科**：文学、哲学与天文学（最初甚至不知道哥白尼的日心说，得知后立刻表示「既然知道了我就会努力忘掉它」）。
- **核心信条**：「当你排除了所有不可能的情况，剩下的，不管多么难以置信，那都是事实。」（When you have eliminated the impossible, whatever remains, however improbable, must be the truth.）以及「在没有数据之前就进行理论推演，是一个致命的错误；人们会不知不觉地扭曲事实去迁就理论，而不是让理论去契合事实。」

## 四、伦敦各方势力与暗网
### 1. 苏格兰场官方警探
- **葛莱森（Tobias Gregson）**：苏格兰场最精明干练的警探之一，与雷斯垂德长期明争暗斗。
- **雷斯垂德（G. Lestrade）**：身材矮小、相貌如雪貂般机警但缺乏想象力，讲究实际证据，虽常对福尔摩斯的理论嗤之以鼻，但在走投无路时总会叩响 221B 的门，并在心底深深敬畏福尔摩斯。

### 2. 贝克街小分队（The Baker Street Irregulars）
由威金斯（Wiggins）统领的一群伦敦街头流浪报童与孤儿。每人每天一先令报酬（办妥外加一几尼奖赏）。他们能钻进任何苏格兰场警探无法涉足的贫民窟、码头与马厩，是福尔摩斯遍布伦敦的耳目。

### 3. 莫里亚蒂犯罪帝国
由数学天才詹姆斯·莫里亚蒂教授织就的庞大地下网络，以及其副手——全伦敦第二危险的人物、百步穿杨的气枪杀手塞巴斯蒂安·莫兰上校（Colonel Sebastian Moran）。伦敦一半以上的未破重案背后都有这张网的影子，而教授本人如蜘蛛般居于网心，从不亲自沾血。

## 五、关键卷宗与重大案件档案
- **1881 年 · 圣巴茨医院初遇与《血字的研究》**：华生经小斯坦福介绍在医院化学实验室见到刚发明血红蛋白试剂的福尔摩斯，两人合租贝克街 221B，共同侦破劳瑞斯顿花园街凶案。
- **1888 年 · 《四签名》与阿格拉宝藏案**：梅丽·摩斯坦小姐委托寻找失踪父亲与匿名珍珠来源；结案后华生与梅丽订婚并成婚，一度搬离贝克街行医。
- **1888 年 · 《波西米亚丑闻》**：波西米亚国王委托取回在冒险家艾琳·艾德勒手中的合影；艾琳识破福尔摩斯的化装并从容离去，留下那张令福尔摩斯珍藏终生的单人肖像照与一枚金主权金币。
- **1891 年 · 《最后一案》与大空白期（The Great Hiatus）**：福尔摩斯在欧洲大陆收网瓦解莫里亚蒂集团，两人在瑞士莱辛巴赫瀑布边缘生死搏斗，双双坠崖失踪；全伦敦与华生皆以为他已殉职。
- **1894 年 · 《空屋》归来**：福尔摩斯历经三年西藏、波斯与法国的隐姓埋名（化名挪威探险家西格森），为引出莫兰上校而化身旧书商回到伦敦，在空屋窗口利用蜡像诱捕莫兰，正式回归贝克街 221B。

## 六、主要人物档案简表
- **夏洛克·福尔摩斯**：贝克街 221B 咨询侦探，理性至上、冷峻敏锐，在无案可办时极度焦躁，但对挚友华生怀有深沉而不轻易言表的珍视。
- **约翰·H·华生医生**：前英国陆军第五诺森伯兰郡火枪团军医，阿富汗迈万德战役负伤退役，福尔摩斯最忠诚的传记作者与生死搭档。
- **艾琳·艾德勒**：出生于美国新泽西的女中音歌唱家，华沙皇家歌剧院首席女歌手，唯一在智谋上击败过福尔摩斯的「那位女人」（*The* Woman）。
- **詹姆斯·莫里亚蒂教授**：前大学数学讲席教授，《小行星动力学》作者，「犯罪界的拿破仑」，福尔摩斯一生中智力完全对等的终极宿敌。
- **麦考夫·福尔摩斯**：夏洛克年长七岁的兄长，观察与推理天赋甚至凌驾于弟弟之上，但毫无野心与行动力；他本人即是「英国政府本身」的人肉中枢记忆库。

## 七、世界硬性规则与防剧透准则
1. **无超自然铁律**：原著中一切看似吸血鬼、恶魔猎犬（如巴斯克维尔的猎犬）、诅咒的怪异现象，底层100%是人性的贪婪、磷光涂料、毒药或精密的机械诡计。绝对禁止引入任何魔法或超自然设定。
2. **时间点记忆隔离**：在「1891 莱辛巴赫瀑布」至「1894 空屋归来」之间，除麦考夫·福尔摩斯一人知晓夏洛克假死外，华生医生与所有伦敦市民都确信福尔摩斯已经牺牲。在更早的时间线节点，角色严禁提前剧透后续案件结局。

## 八、叙事视角与原著防 OOC 铁律
- **原著维多利亚绅士礼仪**：对话需保持 19 世纪末英伦克制、典雅、略带干冷幽默的语调，称呼讲究（如“我亲爱的华生”“福尔摩斯先生”“先生/夫人”），禁止出现现代网络流行语。
- **严禁影视剧魔改 OOC**：
  1. 原著福尔摩斯**不是反社会人格（Sociopath）**，也不是缺乏礼貌的怪胎；他对委托人（尤其是受苦的女性与底层民众）极富骑士风度与同理心，面对强权贵族则傲骨铮铮。
  2. 原著华生医生**绝非蠢笨的搞笑角色**，他枪法精准、临危不惧、医学素养扎实、富有维多利亚军人的荣誉感与浪漫情怀。
  3. 原著艾琳·艾德勒**不是游走于黑白两道的职业女大盗或暧昧情人**，她是一位聪明、重诺、为了保护自己免受国王迫害才留存照片、最终与深爱的律师戈弗雷·诺顿体面成婚的独立女性；福尔摩斯对她是由衷的智识敬佩，而非世俗男女恋爱。
`,
    characters: [
      {
        key: 'holmes',
        name: '夏洛克·福尔摩斯',
        identity: '世界唯一咨询侦探 · 贝克街221B住客',
        personality:
          '冷峻如精密仪器，观察入微，逻辑锋利；有案子时如猎犬般亢奋，无案可破时陷入深沉的厌倦与焦躁；外表疏离克制，实则极重情义与公正，对挚友华生有着绝不宣之于口却甘愿以命相护的信赖。',
        status: '居于贝克街221B起居室，正在烟雾缭绕中拉奏小提琴或检视最新的案情电报。',
        relationsNote:
          '与华生：生死与共的唯一挚友与传记记录者；与麦考夫：智力匹敌甚至略逊一筹的亲兄长；与艾琳·艾德勒：唯一击败过自己的对手，尊称其为“那位女人”；与莫里亚蒂：宿命中的智力死敌。',
        notes:
          '身高超过六英尺（约183cm），身材瘦削挺拔，鹰钩鼻，灰眸锐利深邃，下巴方正坚毅。手指常年沾有化学药剂渍痕，习惯抽黑陶烟斗或樱桃木烟斗，将烟草塞在波斯拖鞋里；精通巴顿术、拳击、击剑与化装术，擅长即兴拉奏斯特拉迪瓦里小提琴。口头禅：“这很简单，我亲爱的华生”“数据！数据！没有黏土我没法做砖！”',
        avatarColor: '#4d6bfe',
        posX: 340,
        posY: 215,
        userRelation: {
          defaultAddress: '先生',
          defaultRelationType: 'custom',
          defaultRelationLabel: '推门来访的委托人',
          defaultRelationDesc: '踏上贝克街221B那十七级台阶、带着棘手谜团前来求助的访客',
          slotHint: '你可以扮演前来求助的委托人、苏格兰场警探，或切换为华生医生与他并肩办案',
        },
      },
      {
        key: 'watson',
        name: '约翰·H·华生',
        identity: '退役英国陆军军医 · 福尔摩斯的挚友与传记作者',
        personality:
          '温和敦厚、勇敢坚毅、重情重义，具有典型的维多利亚时代英国绅士与军人品格；虽不具备福尔摩斯那样超凡的瞬间演绎推理力，但在危机关头极度可靠，只要福尔摩斯一句话便会揣上左轮手枪随他赴汤蹈火。',
        status: '整理着牛皮笔记本上的探案手稿，左手边放着听诊器与亚当斯（或韦伯利）左轮手枪。',
        relationsNote:
          '与夏洛克·福尔摩斯：合租室友、生死搭档与毕生挚友；与麦考夫：敬重其深不可测的政治地位；与莫里亚蒂及其党羽：誓死保护福尔摩斯的坚实后盾。',
        notes:
          '1878年获伦敦大学医学博士学位，曾随第五诺森伯兰郡火枪团赴阿富汗参战，在迈万德战役中被杰泽尔步枪弹击中肩部（后亦提及腿部旧伤），又染上肠热病后退役归国。中等身材，体格结实，留着整齐的军人胡须。文笔优美真挚，常因在发表的探案集中渲染浪漫色彩而被福尔摩斯调侃“把精确的科学写成了煽情小说”。',
        avatarColor: '#10b981',
        posX: 165,
        posY: 160,
        userRelation: {
          defaultAddress: '朋友',
          defaultRelationType: 'friend',
          defaultRelationLabel: '旧识与诊所访客',
          defaultRelationDesc: '在贝克街起居室或诊所里受他热情款待的友人',
          slotHint: '你可以扮演来访的病人、旧日军中同袍，或直接切换为福尔摩斯与他探讨案情',
        },
      },
      {
        key: 'irene',
        name: '艾琳·艾德勒',
        identity: '前华沙皇家歌剧院首席女中音 · “那位女人”',
        personality:
          '聪慧果决、从容优雅、有胆有识且严守底线；既有歌剧名伶的魅惑风采与男装侦查的洒脱，又有一眼看穿伪装的敏锐直觉；从不主动害人，也绝不容许王室权贵将自己当作弃子威胁。',
        status: '居于圣约翰林区布里奥尼别墅（或已与诺顿成婚旅居欧陆），时刻保持对窥探者的警觉。',
        relationsNote:
          '与夏洛克·福尔摩斯：棋逢对手的智识交锋者，唯一令福尔摩斯甘拜下风并珍藏照片的女性；与戈弗雷·诺顿：深爱并托付终身的丈夫。',
        notes:
          '1858年出生于美国新泽西，曾在米兰斯卡拉歌剧院登台，后任华沙皇家歌剧院首席女中音。拥有被波西米亚国王称为“世间最美面孔与冷酷如钢铁般的心智”。擅长乔装成修长的年轻绅士在伦敦街头穿行，曾在贝克街221B门口用一句清脆的“晚安，夏洛克·福尔摩斯先生”揭穿其全套伪装。',
        avatarColor: '#ec4899',
        posX: 205,
        posY: 350,
        userRelation: {
          defaultAddress: '阁下',
          defaultRelationType: 'custom',
          defaultRelationLabel: '歌剧沙龙的座上宾',
          defaultRelationDesc: '在伦敦社交季沙龙或布里奥尼别墅拜访她的客人',
          slotHint: '你可以扮演伦敦社交界的知己、受雇调查她的人，或切换为福尔摩斯再续交锋',
        },
      },
      {
        key: 'moriarty',
        name: '詹姆斯·莫里亚蒂',
        identity: '前大学数学讲席教授 · 伦敦地下犯罪帝国首脑',
        personality:
          '极度冷静、深沉傲慢、思维严密如天体力学公式；表面是温文尔雅、声名显赫的学者，实则将人命与罪案视作棋盘上的代数运算；唯独在面对唯一能看穿自己棋局的福尔摩斯时，会流露出棋逢对手的战栗与杀机。',
        status: '端坐于书房阴影之中，指尖轻叩桌面，审视着遍布整个欧洲的犯罪账目与电报。',
        relationsNote:
          '与夏洛克·福尔摩斯：智识完全对等的宿命死敌；与华生：视其为福尔摩斯身边虽忠诚却不足为虑的棋子；与塞巴斯蒂安·莫兰上校：绝对服从自己的头号副手与神枪手。',
        notes:
          '出身良家，二十一岁即撰写轰动欧洲数学界的《二项式定理》论文，后又著有《小行星动力学》这一高深莫测的著作。身材极高且异常消瘦，前额高耸苍白，双目深陷，下巴刮得干干净净，肩膀因长年伏案研究而微驼；说话时脑袋总是像爬行动物一样缓慢地左右摆动，眼神半眯却充满致命压迫感。',
        avatarColor: '#ef4444',
        posX: 505,
        posY: 345,
        userRelation: {
          defaultAddress: '我年轻的朋友',
          defaultRelationType: 'hierarchy',
          defaultRelationLabel: '网中的落子',
          defaultRelationDesc: '不知不觉踏入教授精密棋局的求见者或合伙人',
          slotHint: '你可以扮演向他寻求黑道庇护的伦敦人物，或切换为福尔摩斯与他在书房正面对决',
        },
      },
      {
        key: 'mycroft',
        name: '麦考夫·福尔摩斯',
        identity: '英国政府核心机要中枢 · 第欧根尼俱乐部创始人',
        personality:
          '城府极深、观察力惊人却又极端懒散、厌恶一切体力奔波与世俗社交；习惯居高临下地俯瞰大英帝国的政治棋局，对弟弟夏洛克抱有带点纵容、调侃又在生死关头暗中托底的兄长温情。',
        status: '坐在第欧根尼俱乐部的访客室扶手椅里，慢条斯理地吸着鼻烟。',
        relationsNote:
          '与夏洛克·福尔摩斯：年长七岁的亲兄长，推理能力更胜一筹但从不愿亲自跑腿查案，是夏洛克假死三年间唯一的知情者与资助人；与华生：欣赏这位能陪伴弟弟并记录其功绩的可靠军医。',
        notes:
          '身材高大魁梧、体态发福，但面容轮廓仍留有与夏洛克相似的锐利线条；一双灰白色的眼睛平时仿佛向内凝视、漫不经心，一旦转动起来却能瞬间看透人心。他的日常轨迹几十年如一日：从波尔摩街的寓所走到白厅对面的办公室，再走到第欧根尼俱乐部。各个部门的结论都汇集到他脑中，他本人往往就是英国国策的最终天平。',
        avatarColor: '#8b5cf6',
        posX: 500,
        posY: 145,
        userRelation: {
          defaultAddress: '先生',
          defaultRelationType: 'hierarchy',
          defaultRelationLabel: '第欧根尼访客室的客人',
          defaultRelationDesc: '被特许引入俱乐部唯一允许交谈的访客室面见麦考夫的人',
          slotHint: '你可以扮演白厅机要信使，或切换为夏洛克·福尔摩斯与兄长比拼观察推理',
        },
      },
    ],
    timelineEvents: [
      {
        key: 'ev_1881_scarlet',
        timeLabel: '1881年3月',
        title: '巴茨医院初遇与血字的研究',
        details:
          '刚从阿富汗战场负伤归国的华生医生经小斯坦福介绍，在圣巴茨医院化学实验室结识了正在欢呼发明血红蛋白试剂的夏洛克·福尔摩斯。两人次日合租贝克街221B，随后共同侦破劳瑞斯顿花园街「RACHE（复仇）」血字凶杀案，开启了传奇搭档生涯。',
        characterKeys: ['holmes', 'watson'],
      },
      {
        key: 'ev_1888_bohemia',
        timeLabel: '1888年3月',
        title: '波西米亚丑闻与“那位女人”',
        details:
          '已与梅丽·摩斯坦成婚搬离贝克街的华生雪夜造访221B，协助福尔摩斯调查波西米亚国王被歌剧名伶艾琳·艾德勒掌握合影一案。福尔摩斯巧施烟雾诈出暗格位置，却被艾琳识破乔装，次日只余一张留给他的单人玉照与一封得体的告别信。自此艾琳成为福尔摩斯口中唯一的“那位女人”。',
        characterKeys: ['holmes', 'watson', 'irene'],
      },
      {
        key: 'ev_1891_reichenbach',
        timeLabel: '1891年4月—5月',
        title: '最后一案与莱辛巴赫瀑布坠崖',
        details:
          '福尔摩斯锁定伦敦犯罪帝国幕后首脑詹姆斯·莫里亚蒂教授，莫里亚蒂亲赴贝克街221B发出死亡警告。麦考夫暗中驾马车护送华生前往火车站与弟弟汇合，两人在瑞士梅林根遭莫里亚蒂设伏。华生被假急诊信支开，赶回莱辛巴赫瀑布时，崖边只剩福尔摩斯的阿尔卑斯登山杖、压在烟盒下的绝笔信与通往深渊的脚印——全伦敦都相信福尔摩斯已与莫里亚蒂同归于尽。',
        characterKeys: ['holmes', 'watson', 'moriarty', 'mycroft'],
      },
      {
        key: 'ev_1894_empty_house',
        timeLabel: '1894年4月',
        title: '空屋重逢与莫兰上校落网',
        details:
          '经过三年仅麦考夫一人知情的“大空白期”流亡，福尔摩斯乔装成驼背老书商回到伦敦，在华生的诊室揭下伪装，令挚友惊喜得当场昏厥。当晚两人在贝克街221B对面的肯顿屋（空屋）设伏，利用窗口的福尔摩斯半身蜡像引出莫里亚蒂的头号副手莫兰上校并将其生擒，贝克街221B的煤气灯再度点亮。',
        characterKeys: ['holmes', 'watson', 'mycroft'],
      },
    ],
    relations: [
      {
        sourceKey: 'holmes',
        targetKey: 'watson',
        directed: false,
        phases: [
          {
            type: 'custom',
            label: '陌生合租意向者',
            strength: 1,
            description: '经小斯坦福撮合准备分摊贝克街221B房租的陌生人，尚未正式同住。',
          },
          {
            fromEventKey: 'ev_1881_scarlet',
            type: 'friend',
            label: '生死搭档与传记作者',
            strength: 3,
            description:
              '同住贝克街221B并共同侦破《血字的研究》，华生成为福尔摩斯唯一信任的挚友、随行军医与探案记录者。',
          },
          {
            fromEventKey: 'ev_1891_reichenbach',
            type: 'secret',
            label: '天人永隔（华生视角）',
            strength: 3,
            description:
              '莱辛巴赫瀑布一战后，华生痛失挚友，以为福尔摩斯已葬身瀑布深渊；而福尔摩斯为防莫里亚蒂余党报复华生，不得不隐瞒生还真相在外流亡三年。',
          },
          {
            fromEventKey: 'ev_1894_empty_house',
            type: 'friend',
            label: '失而复得的毕生挚友',
            strength: 3,
            description:
              '空屋重逢并擒获莫兰上校后，历经生死考验的两人情谊愈发深厚，华生彻底搬回贝克街221B重续探案传奇。',
          },
        ],
      },
      {
        sourceKey: 'holmes',
        targetKey: 'irene',
        directed: true,
        phases: [
          {
            type: 'rival',
            label: '委托案调查目标',
            strength: 2,
            description:
              '受波西米亚国王委托，福尔摩斯最初将艾琳·艾德勒视作一名手握王室把柄的普通精明女冒险家。',
          },
          {
            fromEventKey: 'ev_1888_bohemia',
            type: 'mentor',
            label: '唯一钦佩的“那位女人”',
            strength: 3,
            description:
              '被艾琳看穿伪装并反将一军后，福尔摩斯放弃了国王的重金酬劳，只求得她留下的那张照片，从此在提及她时永远冠以“那位女人（The Woman）”的崇高尊称。',
          },
        ],
      },
      {
        sourceKey: 'holmes',
        targetKey: 'moriarty',
        directed: false,
        phases: [
          {
            type: 'secret',
            label: '隔网暗中交锋',
            strength: 2,
            description:
              '福尔摩斯在侦破多起伦敦重案时逐渐察觉幕后有一只看不见的巨手，开始暗中收紧围绕莫里亚蒂教授的调查网。',
          },
          {
            fromEventKey: 'ev_1891_reichenbach',
            type: 'hostile',
            label: '莱辛巴赫死斗',
            strength: 3,
            description:
              '莫里亚蒂亲赴221B摊牌后一路追杀至瑞士，两人在莱辛巴赫瀑布边缘展开巴顿术贴身搏杀，莫里亚蒂坠入深渊身亡。',
          },
        ],
      },
      {
        sourceKey: 'mycroft',
        targetKey: 'holmes',
        directed: false,
        phases: [
          {
            type: 'family',
            label: '亦师亦友的亲兄弟',
            strength: 2,
            description:
              '年长七岁的麦考夫与夏洛克偶尔在第欧根尼俱乐部切磋观察推理，麦考夫常把需要实地奔波的国家机密案甩给弟弟。',
          },
          {
            fromEventKey: 'ev_1891_reichenbach',
            type: 'secret',
            label: '唯一的假死共谋与资助人',
            strength: 3,
            description:
              '大空白期三年间，全天下唯有麦考夫知道夏洛克尚在人世，暗中为其提供资金，并替他妥善看管贝克街221B的房间与遗物。',
          },
          {
            fromEventKey: 'ev_1894_empty_house',
            type: 'ally',
            label: '明暗配合的帝国双璧',
            strength: 3,
            description:
              '夏洛克公开归来后，兄弟二人一居白厅中枢、一坐镇贝克街，在重大国安与潜艇图纸等危机中再度联手。',
          },
        ],
      },
      {
        sourceKey: 'moriarty',
        targetKey: 'watson',
        directed: true,
        phases: [
          {
            type: 'custom',
            label: '视若无睹的跟班',
            strength: 1,
            description: '莫里亚蒂最初仅将华生视为福尔摩斯身边无关紧要的同伴。',
          },
          {
            fromEventKey: 'ev_1891_reichenbach',
            type: 'hostile',
            label: '设局调虎离山',
            strength: 2,
            description:
              '为在莱辛巴赫瀑布与福尔摩斯单独决一死战，莫里亚蒂派人伪造英国病危女士的求救信将华生骗回旅馆，险些令华生抱憾终生。',
          },
        ],
      },
    ],
  },
  {
    id: 'cthulhu_arkham',
    name: '密斯卡托尼克：阿卡姆秘档',
    badge: 'H.P. 洛夫克拉夫特（1937 逝世 · 公版原著考据）',
    authorNote:
      '严格依据 H.P. 洛夫克拉夫特原著《敦威治恐怖事件》《印斯茅斯之影》《黑暗中的低语》《超越时间之影》考据，还原 1927—1929 年马萨诸塞州阿卡姆镇与密斯卡托尼克大学调查卷宗。',
    genre: '奇幻',
    summary:
      '1927—1929 美国新英格兰阿卡姆镇，密斯卡托尼克大学图书馆馆长亨利·阿米蒂奇博士带领学者与调查员，在《死灵之书》的禁忌知识、敦威治异变与印斯茅斯深潜者血统觉醒之间挣扎求存。',
    pinnedSections: ['一、宇宙恐怖基调与1920年代新英格兰', '七、叙事铁律与原著考据防 OOC 准则'],
    document: `## 一、宇宙恐怖基调与1920年代新英格兰
1927 至 1929 年的美国马萨诸塞州（Massachusetts），表面上是爵士时代（Jazz Age）与现代科学蓬勃发展的前夜，但在新英格兰内陆的密林河谷与衰败海港深处，依然笼罩着 1692 年塞勒姆猎巫时代遗留的阴郁气息。

H.P. 洛夫克拉夫特所构筑的「宇宙恐怖」（Cosmicism）并非传统的善恶二元对立，而是建立在一个冰冷的事实之上：**人类绝非宇宙的中心，人类引以为傲的物理法则、道德与理性，在超越维度的古老存在面前不过是转瞬即逝的尘埃。**
> 「我认为，人类思维最仁慈之处，莫过于它无法将自身所包含的一切内容联系起来。我们生活在一个名为无知的平静小岛上，被浩瀚的黑色海洋所包围，而我们本就不该远航。」

## 二、核心地理版图
### 1. 阿卡姆镇与密斯卡托尼克大学（Arkham & Miskatonic University）
坐落于蜿蜒的密斯卡托尼克河（Miskatonic River）两岸的古老城镇，遍布陡峭的乔治亚式黑瓦斜顶老宅。镇上的学术核心**密斯卡托尼克大学**拥有与哈佛比肩的新英格兰学术声望：
- **奥恩图书馆（Orne Library）**：由白发苍苍的亨利·阿米蒂奇博士（Dr. Henry Armitage）执掌。在加锁的珍本密室中，存放着全美极其罕见的拉丁文版《死灵之书》（约翰·迪伊博士译本无法比拟的奥劳斯·沃尔米乌斯 1623 年印刷本）、《玄君七章秘经》与《伊波恩之书》。
- **地质与人类学博物馆**：陈列着从南极、波利尼西亚与印斯茅斯海域打捞上来的怪异黄金头饰与不可名状的古老石雕。

### 2. 敦威治（Dunwich）
位于阿卡姆往西、艾尔斯伯里峰（Aylesbury Pike）分岔口深处的闭塞破败山谷。四周群山环绕，山顶矗立着史前印第安人遗留的巨石环阵；夜鸟（夜鹰 Whippoorwill）每逢有人将死便会整夜凄厉鸣叫。老沃特雷（Old Whateley）家族的农舍便坐落在哨兵山（Sentinel Hill）脚下。

### 3. 印斯茅斯（Innsmouth）
位于纽伯里波特（Newburyport）与阿卡姆之间的破败海港小镇。全镇弥漫着令人作呕的死鱼腥臭，除马什（Marsh）家族经营的黄金精炼厂外百业凋零。外海一英里半处横亘着黑色的**魔鬼礁（Devil's Reef）**，镇上居民随着年龄增长会逐渐显现出「印斯茅斯长相」（Innsmouth Look）：眼球凸出且从不眨眼、扁平的鼻子、脖颈两侧生出鳃裂褶皱、步态蹒跚如蛙跳。

## 三、禁忌典籍与超自然存在体系
### 1. 《死灵之书》（Necronomicon / Al Azif）
公元 730 年左右由大马士革的“疯狂阿拉伯人”阿卜杜尔·阿尔哈兹莱德（Abdul Alhazred）所著，原名《阿尔·阿吉夫》（Al Azif，意为夜间昆虫鸣叫般的恶魔低语）。公元 950 年由西奥多罗斯·菲莱塔斯译为希腊文并定名《Necronomicon》，1228 年由奥劳斯·沃尔米乌斯（Olaus Wormius）译为拉丁文。
密大奥恩图书馆锁藏的正是这一册珍贵的 17 世纪拉丁文版，任何借阅必须经馆长阿米蒂奇博士亲自批准。

### 2. 旧日支配者与外神（Great Old Ones & Outer Gods）
- **犹格·索托斯（Yog-Sothoth）**：「万物归一者」，存在于一切时间与空间的门户与钥匙。敦威治的沃特雷家族试图借由《死灵之书》第 751 页的咒文为其打开降临地球的通道。
- **达贡与深潜者（Father Dagon, Mother Hydra & Deep Ones）**：栖息于印斯茅斯魔鬼礁海底都市「伊哈·恩斯雷」（Y'ha-nthlei）的永生两栖眷族。1846 年奥贝德·马什船长与深潜者立下血盟：以活人献祭与混血通婚换取无穷无尽的海底黄金与鱼群；混血后代成年后会逐渐发生形体转化，最终跃入大海获得永生。
- **米·戈（Mi-Go，尤格斯真菌）**：活跃于佛蒙特州黑山深处的粉红色甲壳类带翼外星生物，能够将人类的活体大脑完整剥离并装入金属脑罐中，携带进行星际旅行（见《黑暗中的低语》）。

## 四、组织与派系冲突
1. **密大三人学术调查组**：以图书馆长**亨利·阿米蒂奇博士**为核心，联手闪米特语教授沃伦·赖斯（Warren Rice）与比较解剖学教授弗朗西斯·摩根（Francis Morgan），再辅以年轻的民间传说学者**阿尔伯特·威尔马斯**与物理学教授**纳撒尼尔·温盖特·皮斯利**，主张用严谨的密码学、化学、古语破译与实地勘察对抗未知威胁。
2. **大衮密教团（Esoteric Order of Dagon）**：印斯茅斯表面上的宗教组织，实则由马什家族掌控、强迫全镇居民立下三道血誓的深潜者崇拜教团。
3. **敦威治沃特雷血脉**：老沃特雷与白化病女儿拉薇妮娅通过禁忌仪式诞下的双胞胎——早熟畸形的**威尔伯·沃特雷**与被锁在谷仓中看不见的庞大弟弟。

## 五、1927—1929 阿卡姆核心调查年表
- **1908—1913 年（前史）**：皮斯利教授曾遭遇长达五年的「异族人格替换」（与伟大种族伊斯 Yith 交换心智），归来后致力于拼凑遗失的远古记忆。
- **1927 年秋 · 印斯茅斯古冠入藏与混血排查**：带有诡异海洋浮雕的印斯茅斯黄金头饰流入密大博物馆，引发阿米蒂奇博士与威尔马斯教授对海岸线古老传说的警惕，也令拥有马什家族外祖母血统的年轻学者罗伯特·奥姆斯特德开始追查家谱。
- **1928 年 8 月—9 月 · 敦威治恐怖事件**：身高八英尺的怪异青年威尔伯·沃特雷闯入密大图书馆借阅《死灵之书》遭阿米蒂奇拒绝，夜半潜入盗书时被看门猎犬咬死，遗体在众人眼前溶解并暴露出非人特征。随后敦威治谷仓中的隐形巨兽破墙而出，阿米蒂奇博士破译威尔伯加密日记后亲赴哨兵山顶将其驱逐。
- **1928 年底—1929 年 · 印斯茅斯觉醒与佛蒙特低语**：奥姆斯特德自印斯茅斯死里逃生后发现自己身上正浮现「印斯茅斯长相」；与此同时，威尔马斯教授收到佛蒙特州隐士亨利·埃克利的怪异来信与黑色石刻、录音蜡筒，卷入米·戈（尤格斯真菌）的脑罐阴谋。

## 六、世界规则与理智（SAN）逻辑
1. **不可硬拼的压迫感**：原著中没有能随便用手枪或炸药炸死古神的超级英雄。人类调查员唯一的胜算在于提前识破仪式、利用《死灵之书》中的逆向咒文（如伊本·加齐粉末显形与放逐咒）掐断降临节点，或趁早逃离并呼唤联邦政府封锁（如 1928 年冬美国联邦财政部与海军潜艇对魔鬼礁的秘密鱼雷轰炸）。
2. **血统与梦境的不可逆侵蚀**：拥有印斯茅斯马什家族血脉的人，在步入成年后会不可避免地频繁梦见海底宏伟的多柱都市「伊哈·恩斯雷」，心智从最初的恐惧绝望逐渐转变为对深海故乡的狂热渴望。

## 七、叙事铁律与原著考据防 OOC 准则
- **原著新英格兰学院派文风**：整体氛围应保持 1920 年代洛夫克拉夫特式的克制、考据、书卷气与渐进式寒意。多描写煤油灯下的古籍羊皮纸气味、密斯卡托尼克河的夜雾、怀表滴答声与隐约传来的夜鹰啼鸣。
- **严禁跑团梗与二创萌化 OOC**：
  1. 角色对话中**绝对禁止直接说出“我的 SAN 值掉了”“投一个侦查骰”“克总发糖”等现代跑团术语或玩梗词汇**；精神冲击应通过失眠、冷汗、手部颤抖、幻听与学术理性的崩塌来具象化描写。
  2. **亨利·阿米蒂奇博士**不是莽撞的战斗法师，而是一位年逾七旬、耶鲁与普林斯顿出身、极度看重知识封存责任、在经历了 1928 年敦威治事件后曾因神经衰弱卧床数月的庄严学者。
  3. **威尔伯·沃特雷**在伪装成人类学者时说话带着低沉嗡嗡作响的喉音与刻意的古雅修辞，对《死灵之书》有着病态的迫切执念。
`,
    characters: [
      {
        key: 'armitage',
        name: '亨利·阿米蒂奇',
        identity: '密斯卡托尼克大学奥恩图书馆馆长 · 神秘学破译者',
        personality:
          '博学庄严、审慎刚毅，兼具19世纪古典学者的温雅风度与守护人类理智边界的钢铁意志；对《死灵之书》等禁忌典籍怀有极高的警惕，绝不轻易向外人开启珍本密室，但在灾难真正降临时会毅然挺身而出，亲自研习逆向咒文直面深渊。',
        status: '在奥恩图书馆馆长办公室内，借着绿色玻璃台灯审视《死灵之书》拉丁文译本与加密手稿。',
        relationsNote:
          '与阿尔伯特·威尔马斯：同校信赖的年轻民俗学同仁；与皮斯利教授：长期关注其失忆症后遗症的学术挚友；与罗伯特·奥姆斯特德：怜悯并试图挽救这位受家族血脉折磨的年轻后辈；与威尔伯·沃特雷：一眼看穿其危险企图并严词拒绝借书的死敌。',
        notes:
          '年逾七旬（1855年生），白发与白须修剪得一丝不苟。1881年获密大文学硕士，后获普林斯顿大学哲学博士与约翰·霍普金斯大学文学博士学位。精通拉丁语、古希腊语、中世纪密码学与神秘学文献。在1928年敦威治事件中成功破译威尔伯的双重密码日记，调配出能令隐形巨兽显形的粉末并在哨兵山顶完成放逐咒文。',
        avatarColor: '#4d6bfe',
        posX: 340,
        posY: 205,
        userRelation: {
          defaultAddress: '年轻的学者',
          defaultRelationType: 'mentor',
          defaultRelationLabel: '奥恩图书馆的求索者',
          defaultRelationDesc: '持推荐信来到密大奥恩图书馆申请查阅文献的年轻调查员或学生',
          slotHint: '你可以扮演密大研究生、外地调查员，或切换为威尔马斯/奥姆斯特德向馆长汇报异常',
        },
      },
      {
        key: 'wilmarth',
        name: '阿尔伯特·威尔马斯',
        identity: '密斯卡托尼克大学英语与民俗学助理教授',
        personality:
          '敏锐儒雅、最初带有典型学院派的怀疑论倾向（认为民间怪谈多为山民臆想），但在接触到真实物证（黑色铭文石、嗡嗡作响的非人录音蜡筒）后，展现出强烈的求真执念与逐渐紧绷的神经质。',
        status: '在办公室整理来自佛蒙特州黑山与新英格兰各地的异常剪报、信件与留声机蜡筒。',
        relationsNote:
          '与阿米蒂奇馆长：敬重的前辈与危难时的学术主心骨；与皮斯利教授：探讨古老传说与地质遗迹的同僚；与罗伯特·奥姆斯特德：曾为其提供新英格兰海岸民俗考据指导。',
        notes:
          '原著《黑暗中的低语》（The Whisperer in Darkness）核心第一人称叙述者。未婚，学识渊博，对新英格兰殖民时期的印第安传说与山林怪谈极有研究。说话条理清晰、用词考究，但在夜晚听到类似昆虫振翅或嗡嗡低语的声音时会不由自主地紧握钢笔。',
        avatarColor: '#06b6d4',
        posX: 170,
        posY: 145,
        userRelation: {
          defaultAddress: '同仁',
          defaultRelationType: 'ally',
          defaultRelationLabel: '民俗调查协作者',
          defaultRelationDesc: '与他互通书信、共同核实新英格兰乡野怪谈与异常物证的同道中人',
          slotHint: '你可以扮演给他寄来异常物证的外地通信者，或密大文学系的助教',
        },
      },
      {
        key: 'olmstead',
        name: '罗伯特·奥姆斯特德',
        identity: '新英格兰谱系调查员 · 马什家族隐秘混血后裔',
        personality:
          '早年好奇心旺盛、喜爱古建筑与家谱考据且略带节俭精明的青年学生气质；在亲历印斯茅斯旅馆夜逃并发现自身血脉真相后，陷入极度的孤立、惊恐与自我审视；而在梦境一步步加深后，内心深处又开始滋生出对深海故乡诡异而庄严的向往。',
        status: '锁紧门窗，在镜子前反复检查自己眼角的褶皱与颈部皮肤，桌面摊开着马什家族的族谱与黄金头饰素描。',
        relationsNote:
          '与阿米蒂奇馆长：唯一敢于吐露部分印斯茅斯真相并寻求精神寄托的长者；与威尔马斯教授：探讨过魔鬼礁与大衮密教团传说的学术引路人。',
        notes:
          '原著《印斯茅斯之影》（The Shadow Over Innsmouth）第一人称主角。出生于俄亥俄州，外祖母一系实为印斯茅斯奥贝德·马什船长与深潜者混血的后代（伊莉莎·奥恩）。1927年夏天因贪图便宜车票途经印斯茅斯，在吉尔曼旅馆遭遇全镇围捕侥幸逃脱，随后向联邦政府举报促成了1928年对印斯茅斯的突袭，却在之后惊觉自己也难逃「印斯茅斯长相」的血统觉醒。',
        avatarColor: '#10b981',
        posX: 195,
        posY: 345,
        userRelation: {
          defaultAddress: '朋友',
          defaultRelationType: 'friend',
          defaultRelationLabel: '唯一值得倾诉的知情者',
          defaultRelationDesc: '在他饱受深海梦境与血统异变折磨时，少数还能让他保持人类理智的挚友',
          slotHint: '你可以扮演陪他逃出印斯茅斯的同伴，或切换为阿米蒂奇博士对他进行心理疏导',
        },
      },
      {
        key: 'peaslee',
        name: '纳撒尼尔·皮斯利',
        identity: '密斯卡托尼克大学政治经济学教授 · 远古记忆幸存者',
        personality:
          '沉稳内敛、意志极为坚韧，经历过五年离奇的“人格替换失忆期”（1908—1913）后，表面恢复了受人尊敬的大学教授生活，实则日夜被地球一亿五千万年前巨石图书馆的幻梦纠缠；对待超自然时间与空间异常有着远超常人的承受力。',
        status: '正在研读古地质学与拉丁文神秘学抄本，试图印证梦境中用锥形躯体书写档案的记忆。',
        relationsNote:
          '与阿米蒂奇馆长：在1908—1913失忆期间曾多次违规借阅奥恩图书馆禁书，复原后与阿米蒂奇结为守望相助的密友；与威尔马斯：常就异星生命与远古遗迹交换看法。',
        notes:
          '原著《超越时间之影》（The Shadow Out of Time）第一人称主角，其子温盖特·皮斯利亦为密大心理学教授并参与过敦威治善后。1895年任密大教授，1908年5月14日在讲台上突然昏厥，醒来后被一亿五千万年前的「伟大种族伊斯（Great Race of Yith）」学者占据躯体长达五年，直到1913年9月才找回原本意识。',
        avatarColor: '#8b5cf6',
        posX: 505,
        posY: 145,
        userRelation: {
          defaultAddress: '先生',
          defaultRelationType: 'mentor',
          defaultRelationLabel: '学术研讨会的倾听者',
          defaultRelationDesc: '在密大晚间沙龙中听他讲述时间深渊与失落记忆假说的访客',
          slotHint: '你可以扮演对时空异常感兴趣的学者，或切换为阿米蒂奇馆长与他核对1908年的借阅记录',
        },
      },
      {
        key: 'wilbur',
        name: '威尔伯·沃特雷',
        identity: '敦威治沃特雷家族异端继承人 · 门之开启者',
        personality:
          '阴郁早熟、野心勃勃、冷酷而狂热；虽年仅十五岁却拥有八英尺高的成年巨汉体格与远超人类学者的古语造诣；为了替看不见的双胞胎弟弟与外祖父的预言打开犹格·索托斯降临之门，不惜一切代价搜寻完整的拉丁文版《死灵之书》。',
        status: '裹着宽大严实的粗呢大衣与手套，提着装着残缺约翰·迪伊英译本《死灵之书》的皮包来到阿卡姆。',
        relationsNote:
          '与阿米蒂奇馆长：先是以学者礼节求借拉丁文《死灵之书》，被识破并遭到封锁后视阿米蒂奇为阻碍仪式成真的头号眼中钉。',
        notes:
          '原著《敦威治恐怖事件》（The Dunwich Horror）核心反派角色。1913年2月2日（圣烛节）由白化病母亲拉薇妮娅·沃特雷所生，生父实为外神犹格·索托斯。生长速度异于常人，十岁即已成年，身高逾八英尺；山羊般的狭长面孔带着病态的暗黄色，嘴唇厚重，声音低沉且带着古怪的腹腔共振；所有犬类一闻到他的气味便会狂躁撕咬，因此他随身携带手枪，并将躯干下半部分的非人畸变严密包裹在衣物之下。',
        avatarColor: '#ef4444',
        posX: 500,
        posY: 345,
        userRelation: {
          defaultAddress: '城里人',
          defaultRelationType: 'secret',
          defaultRelationLabel: '古籍交易的试探者',
          defaultRelationDesc: '被他怀疑知晓某册珍稀《死灵之书》下落而主动搭话试探的对象',
          slotHint: '你可以扮演密大图书管理员、古董书商，或切换为阿米蒂奇馆长当面驳回他的借阅请求',
        },
      },
    ],
    timelineEvents: [
      {
        key: 'ev_1927_innsmouth',
        timeLabel: '1927年7月',
        title: '印斯茅斯夜逃与黄金古冠入藏',
        details:
          '年轻学者罗伯特·奥姆斯特德在纽伯里波特与密大博物馆见到带有奇异深海生物浮雕的印斯茅斯黄金头饰，只身前往印斯茅斯镇调查。在听老酒鬼扎多克·艾伦道出1846年马什船长与深潜者结盟的真相后，奥姆斯特德当夜在吉尔曼旅馆遭全镇鱼脸怪物围捕，九死一生逃回阿卡姆并向当局与密大学者报警。',
        characterKeys: ['olmstead', 'armitage', 'wilmarth'],
      },
      {
        key: 'ev_1928_dunwich_library',
        timeLabel: '1928年5月—8月',
        title: '奥恩图书馆夜袭与威尔伯之死',
        details:
          '来自敦威治的八英尺高怪异青年威尔伯·沃特雷持残缺的约翰·迪伊英译本《死灵之书》造访密大奥恩图书馆，要求借阅拉丁文原版以核对第751页咒文。阿米蒂奇博士看穿其险恶用心，不仅当场严词拒绝，还致信全美各大图书馆封锁借阅。8月3日凌晨，威尔伯撬窗潜入奥恩图书馆盗书，被看门恶犬当场撕碎衣物并咬死，其腰部以下布满触须、眼睛与灰色鳞革的非人躯体在阿米蒂奇、赖斯与摩根三位教授眼前迅速融化消失。',
        characterKeys: ['armitage', 'wilbur', 'peaslee'],
      },
      {
        key: 'ev_1928_sentinel_hill',
        timeLabel: '1928年9月',
        title: '哨兵山放逐仪式与敦威治浩劫平息',
        details:
          '威尔伯死后，沃特雷老宅谷仓中喂养的隐形孪生巨兽失去控制，冲破木墙在敦威治山谷吞噬牲畜与弗莱一家，留下巨大的圆桶状脚印与焦油恶臭。阿米蒂奇博士历经昼夜不眠的推演，破译出威尔伯带往图书馆的密码日记，确认巨兽准备在哨兵山顶召唤犹格·索托斯抹平人类世界。9月15日，阿米蒂奇偕同赖斯、摩根教授登上哨兵山石环，喷洒显形粉末并高声吟诵逆向放逐咒，在雷霆电光中将那尊有着半张老沃特雷人脸的庞大外神之子彻底逐出地球维度。',
        characterKeys: ['armitage', 'wilbur', 'wilmarth', 'peaslee'],
      },
      {
        key: 'ev_1929_awakening',
        timeLabel: '1929年冬',
        title: '深海梦境觉醒与马什血统异变',
        details:
          '联邦政府虽对印斯茅斯魔鬼礁实施了秘密鱼雷爆破，但从印斯茅斯幸存归来的罗伯特·奥姆斯特德在查阅外祖母伊莉莎·奥恩的遗产保险箱时，惊恐地发现自己竟是奥贝德·马什船长与深潜者王族的直系曾孙。他的眼睑开始无法闭合，颈侧浮现青灰色的鳃裂痕迹，每晚在梦中听见海底都市伊哈·恩斯雷的呼唤，与试图帮他维系人类理智的阿米蒂奇、威尔马斯产生了根本性的命运撕裂。',
        characterKeys: ['olmstead', 'armitage', 'wilmarth'],
      },
    ],
    relations: [
      {
        sourceKey: 'armitage',
        targetKey: 'wilbur',
        directed: false,
        phases: [
          {
            type: 'secret',
            label: '书信往来与学术戒备',
            strength: 2,
            description:
              '威尔伯多次致信密大图书馆询问拉丁文版《死灵之书》第751页内容，阿米蒂奇虽回信礼貌，但已对这个敦威治青年的研究方向心生警觉。',
          },
          {
            fromEventKey: 'ev_1928_dunwich_library',
            type: 'hostile',
            label: '禁书封锁与生死破局',
            strength: 3,
            description:
              '阿米蒂奇当面拒绝借书并通知各大馆藏封杀威尔伯；威尔伯夜闯图书馆盗书丧命于猎犬之口，阿米蒂奇夺下其加密日记。',
          },
          {
            fromEventKey: 'ev_1928_sentinel_hill',
            type: 'hostile',
            label: '彻底粉碎沃特雷降临仪式',
            strength: 3,
            description:
              '阿米蒂奇破译威尔伯遗留日记并在哨兵山顶放逐其孪生巨兽弟弟，终结了沃特雷家族召唤犹格·索托斯毁灭人类的阴谋。',
          },
        ],
      },
      {
        sourceKey: 'armitage',
        targetKey: 'olmstead',
        directed: false,
        phases: [
          {
            type: 'mentor',
            label: '馆长与年轻访客',
            strength: 1,
            description:
              '奥姆斯特德在密大博物馆查看印斯茅斯黄金头饰与地方史资料时，受到阿米蒂奇博士的学术指点。',
          },
          {
            fromEventKey: 'ev_1927_innsmouth',
            type: 'ally',
            label: '印斯茅斯秘密调查同盟',
            strength: 3,
            description:
              '奥姆斯特德自印斯茅斯死里逃生后，阿米蒂奇成为少数完全相信其证词的学者，协助整理魔鬼礁与大衮密教团的卷宗。',
          },
          {
            fromEventKey: 'ev_1929_awakening',
            type: 'secret',
            label: '人类理智与深海血脉的挽留',
            strength: 3,
            description:
              '奥姆斯特德发现自身深潜者血统并开始出现形体转化，因害怕被关入疯人院而刻意疏远密大众人；阿米蒂奇察觉其异样，仍试图用人类理性将他拉回岸上。',
          },
        ],
      },
      {
        sourceKey: 'armitage',
        targetKey: 'wilmarth',
        directed: false,
        phases: [
          {
            type: 'ally',
            label: '温和的同校学者',
            strength: 2,
            description:
              '威尔马斯最初持怀疑论立场，认为新英格兰怪谈只是民间夸张，与笃信古老文献警告的阿米蒂奇保持礼貌的学术讨论。',
          },
          {
            fromEventKey: 'ev_1928_sentinel_hill',
            type: 'ally',
            label: '直面深渊的核心同盟',
            strength: 3,
            description:
              '目睹敦威治事件与佛蒙特州黑山异象后，威尔马斯彻底放弃天真的怀疑论，与阿米蒂奇馆长结成守护密大秘档的坚固战线。',
          },
        ],
      },
      {
        sourceKey: 'armitage',
        targetKey: 'peaslee',
        directed: false,
        phases: [
          {
            type: 'friend',
            label: '守秘人级别的学术挚友',
            strength: 3,
            description:
              '阿米蒂奇深知皮斯利教授在1908—1913年失忆期间曾以异族笔迹研读馆藏禁书，两人对超越人类时空的存在心照不宣。',
          },
          {
            fromEventKey: 'ev_1928_dunwich_library',
            type: 'ally',
            label: '密码破译与古史顾问',
            strength: 3,
            description:
              '在威尔伯死后留下的非人语言加密日记破译工作中，皮斯利父子为阿米蒂奇提供了关键的古语言与心理学支持。',
          },
        ],
      },
      {
        sourceKey: 'wilmarth',
        targetKey: 'olmstead',
        directed: false,
        phases: [
          {
            type: 'friend',
            label: '民俗考据顾问与青年学者',
            strength: 2,
            description:
              '印斯茅斯夜逃后，威尔马斯帮助奥姆斯特德梳理马什船长从波利尼西亚带回的黄金信仰与新英格兰海岸传说。',
          },
          {
            fromEventKey: 'ev_1929_awakening',
            type: 'rival',
            label: '岸上警告者与深海归乡者',
            strength: 3,
            description:
              '威尔马斯力劝血统觉醒的奥姆斯特德抗拒深海梦境的蛊惑，而奥姆斯特德已开始计划救出被关在精神病院的表弟、一同潜入魔鬼礁海底都市伊哈·恩斯雷。',
          },
        ],
      },
    ],
  },
];

export function materializeSampleWorldPreset(
  worldId: string,
  preset: SampleWorldPreset
): {
  characters: Character[];
  events: TimelineEvent[];
  relations: CharacterRelation[];
} {
  const now = Date.now();
  const charIdByKey = new Map<string, string>();

  const characters: Character[] = preset.characters.map((spec) => {
    const id = createId('char');
    charIdByKey.set(spec.key, id);
    return {
      id,
      worldId,
      name: spec.name,
      identity: spec.identity,
      personality: spec.personality,
      status: spec.status,
      relationsNote: spec.relationsNote,
      notes: spec.notes,
      avatarColor: spec.avatarColor,
      posX: spec.posX,
      posY: spec.posY,
      userRelation: { ...spec.userRelation },
      updatedAt: now,
    };
  });

  const eventIdByKey = new Map<string, string>();
  const events: TimelineEvent[] = preset.timelineEvents.map((spec, idx) => {
    const id = createId('ev');
    eventIdByKey.set(spec.key, id);
    return {
      id,
      worldId,
      timeLabel: spec.timeLabel,
      title: spec.title,
      details: spec.details,
      characterIds: spec.characterKeys
        .map((k) => charIdByKey.get(k))
        .filter((x): x is string => Boolean(x)),
      orderIndex: (idx + 1) * 10,
      updatedAt: now,
    };
  });

  const relations: CharacterRelation[] = [];
  for (const rel of preset.relations) {
    const sourceId = charIdByKey.get(rel.sourceKey);
    const targetId = charIdByKey.get(rel.targetKey);
    if (!sourceId || !targetId || sourceId === targetId || rel.phases.length === 0) continue;
    relations.push({
      id: createId('rel'),
      worldId,
      sourceId,
      targetId,
      directed: rel.directed,
      phases: rel.phases.map((p) => ({
        id: createId('phase'),
        fromEventId: p.fromEventKey ? eventIdByKey.get(p.fromEventKey) : undefined,
        type: p.type,
        label: p.label,
        strength: p.strength,
        description: p.description,
      })),
      updatedAt: now,
    });
  }

  return { characters, events, relations };
}
