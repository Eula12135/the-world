import type { ChatMessage } from '../types';

export interface SpeakerLike {
  speakerCharacterId?: string;
  speakerPersonaId?: string;
  speakerName?: string;
}

/**
 * 是否「新消息」：只看 ID。
 *
 * `speakerName` 只是冗余兜底，不参与判断 —— 否则任何只写了名字的路径
 * 都会被误判成新消息，反而绕过会话回退。
 */
export function hasSpeakerSnapshot(m: SpeakerLike): boolean {
  return Boolean(m.speakerCharacterId || m.speakerPersonaId);
}

export interface SpeakerLookup {
  characters: Array<{ id: string; name: string; avatarImage?: string; avatarColor?: string }>;
  personas: Array<{ id: string; name: string; avatarImage?: string; avatarColor?: string }>;
}

export interface SpeakerDisplay {
  name: string;
  image?: string;
  color?: string;
  /** false 表示快照指向的角色/身份已被删除，只剩名字可显示 */
  known: boolean;
}

/**
 * 解析一条消息该用谁的头像与名字。
 *
 * - 有快照（ID 非空）：只按快照查，**绝不回退到会话当前角色**，
 *   否则删卡/换角色后历史消息会串成新角色。
 * - 无快照（老消息）：回退到 `fallback`，与改动前的行为一致。
 */
export function resolveSpeakerDisplay(
  message: SpeakerLike,
  lookup: SpeakerLookup,
  fallback: { name?: string; image?: string; color?: string }
): SpeakerDisplay {
  if (hasSpeakerSnapshot(message)) {
    const character = message.speakerCharacterId
      ? lookup.characters.find((c) => c.id === message.speakerCharacterId)
      : undefined;
    const persona = message.speakerPersonaId
      ? lookup.personas.find((p) => p.id === message.speakerPersonaId)
      : undefined;
    const source = character || persona;
    return {
      name: source?.name || message.speakerName || '已删除的角色',
      image: source?.avatarImage,
      color: source?.avatarColor,
      known: Boolean(source),
    };
  }

  return {
    name: fallback.name || '',
    image: fallback.image,
    color: fallback.color,
    known: Boolean(fallback.name),
  };
}

/** 落库前取当前发言人，写进消息快照 */
export function buildSpeakerSnapshot(params: {
  role: ChatMessage['role'];
  roleCharacter?: { id: string; name: string };
  userIdentity?: { kind: 'character' | 'persona'; id: string };
  characters: Array<{ id: string; name: string }>;
  personas: Array<{ id: string; name: string }>;
}): Pick<ChatMessage, 'speakerCharacterId' | 'speakerPersonaId' | 'speakerName'> {
  const { role, roleCharacter, userIdentity, characters, personas } = params;

  if (role === 'assistant') {
    if (!roleCharacter) return {};
    return { speakerCharacterId: roleCharacter.id, speakerName: roleCharacter.name };
  }

  if (!userIdentity) return {};
  if (userIdentity.kind === 'character') {
    const c = characters.find((x) => x.id === userIdentity.id);
    return { speakerCharacterId: userIdentity.id, speakerName: c?.name };
  }
  const p = personas.find((x) => x.id === userIdentity.id);
  return { speakerPersonaId: userIdentity.id, speakerName: p?.name };
}
