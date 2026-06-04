import fs from 'node:fs';
import path from 'node:path';
import Plugin from './index.js';

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
const props = manifest.contributes.configuration.properties;
for (const key of ['enableStatusNotifications', 'enableErrorNotifications', 'enableTaskDoneNotifications']) {
  if (!props[key]) throw new Error(`${key} missing from manifest`);
}
if (props.enableStatusNotifications.default !== true) throw new Error('enableStatusNotifications should default true');
if (props.enableErrorNotifications.default !== true) throw new Error('enableErrorNotifications should default true');
if (props.enableTaskDoneNotifications.default !== false) throw new Error('enableTaskDoneNotifications should default false');

function makePlugin(overrides = {}) {
  const p = Object.create(Plugin.prototype);
  const pushed = [];
  const emitted = [];
  p.ctx = { log: { info(){}, warn(){}, error(){} } };
  p._cfg = {
    enableStatusNotifications: true,
    enableErrorNotifications: true,
    enableTaskDoneNotifications: false,
    enableSound: true,
    importantNotificationSound: true,
    notificationSoundTheme: 'chime',
    ...overrides,
  };
  p._store = { push(n) { pushed.push(n); } };
  p._emitDesktopNotification = (n) => emitted.push(n);
  return { p, pushed, emitted };
}

{
  const { p, pushed, emitted } = makePlugin();
  p._handleStatusEvent({ type: 'error', source: 'session:send', error: 'model timeout' }, 'session-a');
  if (pushed.length !== 1 || emitted.length !== 1) throw new Error('error should notify');
  if (pushed[0].importance !== 'important') throw new Error('error should be important');
  if (pushed[0].type !== 'status') throw new Error('error notification type should be status');
}

{
  const { p, pushed } = makePlugin();
  p._handleStatusEvent({ type: 'activity_update', activity: { status: 'failed', label: '后台任务', error: 'boom' } }, 'session-b');
  if (pushed.length !== 1) throw new Error('failed activity should notify');
  if (pushed[0].title !== '任务失败') throw new Error('failed activity title wrong');
  if (pushed[0].importance !== 'important') throw new Error('failed activity should be important');
}

{
  const { p, pushed } = makePlugin();
  p._handleStatusEvent({ type: 'cron_job_done', jobId: 'job-1', label: '巡检' }, null);
  p._handleStatusEvent({ type: 'activity_update', activity: { status: 'completed', label: '后台任务' } }, null);
  if (pushed.length !== 0) throw new Error('done notifications should default off');
}

{
  const { p, pushed } = makePlugin({ enableTaskDoneNotifications: true });
  p._handleStatusEvent({ type: 'cron_job_done', jobId: 'job-1', label: '巡检' }, null);
  p._handleStatusEvent({ type: 'activity_update', activity: { status: 'completed', label: '后台任务' } }, null);
  if (pushed.length !== 2) throw new Error(`done notifications should emit when enabled, got ${pushed.length}`);
  if (!pushed.every((n) => n.title === '任务完成' && n.importance === 'normal')) throw new Error('done notification shape wrong');
}

{
  const { p, pushed } = makePlugin({ enableErrorNotifications: false });
  p._handleStatusEvent({ type: 'error', source: 'session:send', error: 'model timeout' }, 'session-a');
  p._handleStatusEvent({ type: 'activity_update', activity: { status: 'failed', label: '后台任务', error: 'boom' } }, 'session-b');
  if (pushed.length !== 0) throw new Error('error notifications should respect off switch');
}

console.log('status notifications smoke ok');
