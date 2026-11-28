import { describe, expect, it } from 'vitest';
import { buildSpeakerSnapshot, hasSpeakerSnapshot, resolveSpeakerDisplay } from '../utils/speakerSnapshot';

const characters = [
  { id: 'char-holmes', name: '福尔摩斯', avatarImage: 'idb://a', avatarColor: '#111' },
  { id: 'char-watson', name: '华生' },
];
const personas = [{ id: 'persona-me', name: '路明非', avatarColor: '#3b57e8' }];

describe('发言人快照', () => {
  it('只看 ID 判断是否新消息，名字不参与', () => {
    expect(hasSpeakerSnapshot({ speakerName: '福尔摩斯' })).toBe(false);
    expect(hasSpeakerSnapshot({ speakerCharacterId: 'char-holmes' })).toBe(true);
    expect(hasSpeakerSnapshot({ speakerPersonaId: 'persona-me' })).toBe(true);
  });

  it('老消息（无快照）回退到会话当前角色', () => {
    const d = resolveSpeakerDisplay({}, { characters, personas }, { name: '陈墨瞳', image: 'x' });
    expect(d.name).toBe('陈墨瞳');
    expect(d.image).toBe('x');
    expect(d.known).toBe(true);
  });

  it('有快照时按快照取，不理会会话当前角色', () => {
    const d = resolveSpeakerDisplay(
      { speakerCharacterId: 'char-watson', speakerName: '华生' },
      { characters, personas },
      { name: '陈墨瞳' }
    );
    expect(d.name).toBe('华生');
    expect(d.known).toBe(true);
  });

  it('快照指向的卡片被删除时用名字兜底，且不回退到当前角色', () => {
    const d = resolveSpeakerDisplay(
      { speakerCharacterId: 'char-deleted', speakerName: '酒德麻衣' },
      { characters, personas },
      { name: '陈墨瞳' }
    );
    expect(d.name).toBe('酒德麻衣');
    expect(d.known).toBe(false);
    expect(d.name).not.toBe('陈墨瞳');
  });

  it('连名字都没有时给出占位，而不是静默显示当前角色', () => {
    const d = resolveSpeakerDisplay({ speakerCharacterId: 'char-deleted' }, { characters, personas }, { name: '陈墨瞳' });
    expect(d.name).toBe('已删除的角色');
    expect(d.known).toBe(false);
  });

  it('冻结标记让「当时没有说话人」的消息不回退到当前角色', () => {
    const d = resolveSpeakerDisplay(
      { speakerFrozen: true },
      { characters, personas },
      { name: '酒德麻衣' }
    );
    expect(d.name).toBe('');
    expect(d.known).toBe(false);
    expect(hasSpeakerSnapshot({ speakerFrozen: true })).toBe(true);
  });

  it('用户侧是自建身份时记 personaId', () => {
    const snap = buildSpeakerSnapshot({
      role: 'user',
      userIdentity: { kind: 'persona', id: 'persona-me' },
      characters,
      personas,
    });
    expect(snap).toEqual({ speakerPersonaId: 'persona-me', speakerName: '路明非' });
  });

  it('用户侧是角色卡时记 characterId（双卡对戏）', () => {
    const snap = buildSpeakerSnapshot({
      role: 'user',
      userIdentity: { kind: 'character', id: 'char-watson' },
      characters,
      personas,
    });
    expect(snap).toEqual({ speakerCharacterId: 'char-watson', speakerName: '华生' });
  });

  it('AI 侧按会话角色卡记快照，无角色时不写', () => {
    expect(
      buildSpeakerSnapshot({ role: 'assistant', roleCharacter: characters[0], characters, personas })
    ).toEqual({ speakerCharacterId: 'char-holmes', speakerName: '福尔摩斯' });
    expect(buildSpeakerSnapshot({ role: 'assistant', characters, personas })).toEqual({});
  });
});
