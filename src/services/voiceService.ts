export {
  type BuiltinVoiceOption,
  extractSiliconFlowShortVoice,
  findSttPresetByBaseUrl,
  findTtsPresetByBaseUrl,
  formatSiliconFlowSystemVoice,
  pickMatchingBuiltinVoiceForGender,
  type RemoteClonedVoice,
  resolveEffectiveVoiceConfig,
  rewriteSiliconFlowVoiceForModel,
  STT_PRESETS,
  type SttPreset,
  TTS_BUILTIN_VOICES,
  TTS_PRESETS,
  type TtsCapability,
  type TtsPreset,
} from './voice/presets';

export {
  formatTtsHttpError,
  isBreezeCloudBase,
  normalizeBreezeBaseUrl,
  sanitizeCloneCustomName,
  splitSpeechChunks,
  stripMarkdownForSpeech,
} from './voice/textUtils';

export { fetchSttModels, fetchTtsModels } from './voice/models';

export {
  type BreezeVoiceItem,
  type BreezeVoicePreview,
  buildBreezeTtsPayload,
  designBreezeVoice,
  listBreezeVoices,
  saveBreezeVoiceDesign,
} from './voice/breeze';

export {
  buildTtsSpeechPayload,
  listNativeVoices,
  shouldAutoPlaySpeech,
  speakText,
  stopSpeaking,
} from './voice/tts';

export {
  audioBlobToDataUrl,
  deleteRemoteClonedVoice,
  listRemoteClonedVoices,
  uploadClonedVoice,
} from './voice/cloning';

export { startVoiceCapture, type VoiceCaptureHandle } from './voice/stt';
