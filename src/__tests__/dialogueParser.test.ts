import { describe, expect, it } from 'vitest';
import {
  classifyParenthetical,
  extractVoiceableSound,
  parseRoleplayContent,
  stripActionsForSpeech,
} from '../utils/dialogueParser';

describe('dialogueParser', () => {
  it('separates physical actions from dialogue as shown in roleplay responses', () => {
    const sample1 = '（轻轻拨弄着紫色长发，眼神略带慵懒）这么晚还不休息？明天还要赶路呢。';
    const res1 = parseRoleplayContent(sample1);
    expect(res1.hasActions).toBe(true);
    expect(res1.hasTones).toBe(false);
    expect(res1.blocks).toEqual([
      { kind: 'action', text: '轻轻拨弄着紫色长发，眼神略带慵懒' },
      { kind: 'speech', segments: [{ kind: 'dialogue', text: '这么晚还不休息？明天还要赶路呢。' }] },
    ]);

    const sample2 =
      '（微微一怔，随即露出意味深长的笑容）哦？这么直接啊...（靠近一步，紫发在月光下泛着微光）';
    const res2 = parseRoleplayContent(sample2);
    expect(res2.hasActions).toBe(true);
    expect(res2.blocks).toEqual([
      { kind: 'action', text: '微微一怔，随即露出意味深长的笑容' },
      { kind: 'speech', segments: [{ kind: 'dialogue', text: '哦？这么直接啊...' }] },
      { kind: 'action', text: '靠近一步，紫发在月光下泛着微光' },
    ]);
  });

  it('keeps vocal/tone shifts and sighs inline inside speech blocks', () => {
    const sample = '（轻叹）你总是这样不顾后果……（压低声音）这次听我的，先退后。（顿了顿）明白吗？';
    const res = parseRoleplayContent(sample);
    expect(res.hasActions).toBe(false);
    expect(res.hasTones).toBe(true);
    expect(res.blocks).toEqual([
      {
        kind: 'speech',
        segments: [
          { kind: 'tone', text: '（轻叹）' },
          { kind: 'dialogue', text: '你总是这样不顾后果……' },
          { kind: 'tone', text: '（压低声音）' },
          { kind: 'dialogue', text: '这次听我的，先退后。' },
          { kind: 'tone', text: '（顿了顿）' },
          { kind: 'dialogue', text: '明白吗？' },
        ],
      },
    ]);

    expect(classifyParenthetical('叹了口气')).toBe('tone');
    expect(classifyParenthetical('轻笑')).toBe('tone');
  });

  it('handles mixed physical actions, inline tone cues, and dialogue together', () => {
    const sample = '（转身看向窗外）夜色已经深了。（轻声）如果后悔的话，现在还来得及。';
    const res = parseRoleplayContent(sample);
    expect(res.hasActions).toBe(true);
    expect(res.hasTones).toBe(true);
    expect(res.blocks).toEqual([
      { kind: 'action', text: '转身看向窗外' },
      {
        kind: 'speech',
        segments: [
          { kind: 'dialogue', text: '夜色已经深了。' },
          { kind: 'tone', text: '（轻声）' },
          { kind: 'dialogue', text: '如果后悔的话，现在还来得及。' },
        ],
      },
    ]);
  });

  it('skips fenced code blocks, tables, and markdown links', () => {
    const codeText = '```ts\nconst fn = () => (1 + 2);\n```';
    expect(parseRoleplayContent(codeText)).toEqual({
      hasActions: false,
      hasTones: false,
      blocks: [],
    });

    const linkText = '详情请看[设定集](https://example.com/world)（版本 1.0）。';
    const res = parseRoleplayContent(linkText);
    expect(res.hasActions).toBe(false);
    expect(res.hasTones).toBe(false);
    expect(res.blocks).toEqual([
      { kind: 'speech', segments: [{ kind: 'dialogue', text: linkText }] },
    ]);
  });

  it('strips actions and tone cues for TTS speech while falling back if empty', () => {
    const sample =
      '（轻轻拨弄着紫色长发）这么晚还不休息？（轻叹）早点睡吧。（靠近一步）';
    expect(stripActionsForSpeech(sample)).toBe('这么晚还不休息？早点睡吧。');

    const onlyAction = '（微微颔首，转身离开）';
    expect(stripActionsForSpeech(onlyAction)).toBe(onlyAction);
  });

  it('treats short narrative parentheticals as actions instead of reading them aloud', () => {
    // 曾经的漏网案例：「（意味深长的笑）」没有「笑容」、不含标点、长度也短，
    // 会被判成台词然后被 TTS 念出来
    expect(classifyParenthetical('意味深长的笑')).toBe('action');
    expect(classifyParenthetical('沉默')).toBe('action');
    expect(classifyParenthetical('“好啊”')).toBe('dialogue');

    const sample = '（意味深长的笑）你倒是说说看。';
    expect(parseRoleplayContent(sample).blocks[0]).toEqual({
      kind: 'action',
      text: '意味深长的笑',
    });
    expect(stripActionsForSpeech(sample)).toBe('你倒是说说看。');
  });

  it('drops bare narration lines but keeps lines that look like speech', () => {
    expect(stripActionsForSpeech('特蕾娜意味深长的笑了一下。\n“你来了。”')).toBe('“你来了。”');
    // 含「你/我」的行按台词保留
    expect(stripActionsForSpeech('你笑起来真好看。')).toBe('你笑起来真好看。');
    // 模型把动作写成裸行、还带「地」的情况（真机抓到的原文）
    expect(stripActionsForSpeech('意味深长地笑\n“当然，我可是不会帮忙的哦。”')).toBe(
      '“当然，我可是不会帮忙的哦。”'
    );
    // 以动作词收尾但含「你/我」的，仍然保留
    expect(stripActionsForSpeech('我意味深长地笑')).toBe('我意味深长地笑');
  });

  it('keeps the laugh when a narration line contains an actual sound', () => {
    // 旁白要丢，但「噗」是声音，不能被一起吞掉
    expect(stripActionsForSpeech('噗的一下笑出来。\n“你来了。”')).toBe('噗\n“你来了。”');
    expect(extractVoiceableSound('噗的一下笑出来。')).toBe('噗');
    expect(extractVoiceableSound('意味深长的笑')).toBe('');
    // 括号里的拟声词同样保留，纯描述则丢弃
    expect(stripActionsForSpeech('（噗嗤一声笑了）')).toBe('噗嗤');
    expect(stripActionsForSpeech('（噗嗤）你来了。')).toBe('噗嗤，你来了。');
    expect(stripActionsForSpeech('（轻叹）你总是这样。')).toBe('你总是这样。');
  });
});
