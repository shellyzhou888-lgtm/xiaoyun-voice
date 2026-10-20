import {defineProject} from '@xiaoyun/voice/server';
export default defineProject({
  id:'meeting',
  description:'会议展示示例。会议准备使用 meeting Skill；下方会议数量为固定接入示例，不代表真实公司日程。',
  skills:['./skills/meeting'],
  tools:[{
    name:'read_agenda',description:'读取指定会议室的固定示例日程',readOnly:true,
    parameters:{type:'object',properties:{room:{type:'string'}},required:['room']},
    execute:async({room})=>({room,meetingCount:2,agenda:['项目讨论','方案评审'],demoData:true}),
  }],
});
