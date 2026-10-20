import {config} from './config.ts';

/** Build at each model turn, so a long-lived session follows the local calendar. */
export function currentTimeContext(now=new Date()) {
  const localTime=new Intl.DateTimeFormat('zh-CN',{
    timeZone:config.timeZone,dateStyle:'full',timeStyle:'long',
  }).format(now);
  return `服务器当前本地日期与时间：${localTime}；时区：${config.timeZone}。今天、明天、昨天等相对日期以此时区和日期为准；不要把历史对话或页面里的日期当作今天。`;
}
