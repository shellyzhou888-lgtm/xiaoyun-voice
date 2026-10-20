import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROTOCOL_VERSION} from '../../protocol/src/index.ts';

export const ROOT = process.env.XIAOYUN_PACKAGE_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const config = {
  enableDemo: process.env.VOICE_ENABLE_DEMO !== 'false',
  timeZone: process.env.TIME_ZONE || 'Asia/Shanghai',
  port: Number(process.env.PORT || 8765),
  defaultMode: process.env.VOICE_MODE === 'live' ? 'live' : 'demo',
  host: process.env.HOST || '127.0.0.1',
  python: process.env.PYTHON_EXECUTABLE || 'python',
  dataDir: path.resolve(process.env.DATA_DIR || (process.env.VOICE_ENABLE_DEMO==='false'?path.join(process.cwd(),'.xiaoyun','data'):path.join(ROOT,'data'))),
  qwenKey: process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || '',
  qwenModel: process.env.QWEN_MODEL || 'qwen-audio-3.0-realtime-flash',
  qwenUrl: process.env.QWEN_REALTIME_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  qwenVoice: process.env.QWEN_VOICE || 'longanqian',
  qwenVad: process.env.QWEN_VAD_TYPE || 'smart_turn',
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  agentMaxTurns: Number(process.env.AGENT_MAX_TURNS || 0),
  deepseekUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  projectModule: process.env.VOICE_PROJECT_MODULE || process.env.PROJECT_MODULE,
  origins: (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
};

export const health = () => ({
  protocolVersion: PROTOCOL_VERSION,
  mode: config.defaultMode,
  voiceReady: Boolean(config.qwenKey), agentReady: Boolean(config.deepseekKey),
  models: {voice: config.qwenModel, agent: config.deepseekModel},
});
