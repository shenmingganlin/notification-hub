import fs from 'node:fs';
import path from 'node:path';
import Plugin from './index.js';

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const props = manifest.contributes.configuration.properties;
if (!props.enableChannelAggregation) throw new Error('enableChannelAggregation missing');
if (!props.channelAggregationWindowSeconds) throw new Error('channelAggregationWindowSeconds missing');
if (!props.channelAggregationThreshold) throw new Error('channelAggregationThreshold missing');
if (props.enableChannelAggregation.default !== false) throw new Error('aggregation should default to false');

const p = Object.create(Plugin.prototype);
const pushed = [];
const emitted = [];
p.ctx = { log: { info(){}, warn(){}, error(){} } };
p._cfg = {
  enableChannelAggregation: true,
  channelAggregationWindowMs: 30_000,
  channelAggregationThreshold: 3,
  enableKeywordImportance: true,
  keywords: ['紧急'],
  enableSound: true,
  importantNotificationSound: true,
  notificationSoundTheme: 'chime',
};
p._channelAggregation = new Map();
p._channelsDir = 'C:/HanaAgent/test-home/channels';
p._channelCache = new Map();
p._store = { push(n) { pushed.push(n); } };
p._emitDesktopNotification = (n) => emitted.push(n);
p._agentResolver = {
  resolveFromSender(sender) {
    return {
      id: sender,
      displayName: String(sender),
      theme: { emoji: 'x', primary: '#9b59b6', accent: '#e74c3c' },
    };
  },
};

for (let i = 1; i <= 3; i++) {
  p._handleChannelMessage({
    channelName: 'ch_crew',
    sender: i === 1 ? 'butter' : i === 2 ? 'rational' : 'chatgpt',
    message: { body: `普通消息 ${i}`, timestamp: `t${i}` },
  });
}

if (pushed.length !== 1) throw new Error(`expected one aggregate pushed, got ${pushed.length}`);
if (emitted.length !== 1) throw new Error(`expected one aggregate emitted, got ${emitted.length}`);
if (!pushed[0].meta?.aggregate) throw new Error('aggregate meta missing');
if (pushed[0].meta.count !== 3) throw new Error(`aggregate count wrong: ${pushed[0].meta.count}`);
if (!pushed[0].body.includes('3 条新消息')) throw new Error(`aggregate body wrong: ${pushed[0].body}`);

pushed.length = 0;
emitted.length = 0;
p._handleChannelMessage({
  channelName: 'ch_crew',
  sender: 'hanako',
  message: { body: '紧急：这条 important 不应该进入聚合', timestamp: 't-important' },
});

if (pushed.length !== 1 || emitted.length !== 1) throw new Error('important notification should emit immediately');
if (pushed[0].importance !== 'important') throw new Error(`important level wrong: ${pushed[0].importance}`);
if (pushed[0].meta?.aggregate) throw new Error('important notification must not be aggregate');

console.log('channel aggregation smoke ok');
