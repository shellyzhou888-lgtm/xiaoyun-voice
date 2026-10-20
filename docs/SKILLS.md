# 业务 Skill 与 Pi 页面操作

小云用 Qwen 原生实时语音对话和分流；Pi 负责检索、计算、业务流程与多步操作。任务执行期间可以继续聊天，结果排队等当前整段声音实际播完再汇报。没有额外的 TTS 服务。

## 给新项目添加 Skill

在宿主项目建立目录：

```text
voice-project.mjs
skills/
  meeting/
    SKILL.md
    references/
      workflow.md
```

`SKILL.md` 使用常见 Markdown 与 YAML 元数据：

```md
---
name: meeting
description: 按公司会议流程准备会议室页面，核对必要信息并展示会议日程。
---

# 会议准备

先读取 references/workflow.md。询问缺少的必要信息，保留原任务。
需要操作页面时先 observe_page，按其中实际提供的动作逐步操作。
使用上一动作回执中的 page.version 执行下一步；页面变化时重新观察。
完成后给出可直接朗读的简短结论，完整日程放 markdown。
```

在后端项目配置注册目录：

```js
import {defineProject} from '@xiaoyun/voice/server';

export default defineProject({
  id:'meeting',
  description:'会议展示项目，复杂会议准备按 meeting Skill 执行。',
  skills:['./skills/meeting'],
  // 业务数据源与工具仍在 databases、tools 中显式注册。
});
```

设置 `VOICE_PROJECT_MODULE=./voice-project.mjs`，页面使用相同的 `projectId:'meeting'`。Skill 路径相对项目模块所在目录解析，目录中必须有 SKILL.md。修改配置或 Skill 后重启后台。

Qwen 只收到项目说明及 Skill 名称、用途；Pi 收到同一能力目录，通过 `read_skill({name})` 读取正文，再通过 `read_skill({name, reference:'references/workflow.md'})` 读取参考资料。正文和参考资料保留在该任务的会话中，澄清恢复不会丢失。未匹配 Skill 的任务仍可使用现有工具处理。

只允许读取该 Skill 目录内的文本资料（每份不超过 128 KiB），不能通过上级路径或目录链接越界。大数据通过 SQL/业务工具读取。Skill 是流程知识，不自动开放文件、命令行、网络或数据库能力；这些能力由已注册工具提供。

仓库及安装包的 `skills/sales-analysis` 提供销售分析与页面操作示例，含真实字段口径和数据格式参考。它只由销售演示项目启用，默认通用项目不会加载它或生成销售数据库。

## 宿主页面怎样支持多步操作

继续通过公开 SDK 注册现有业务函数即可，不需要第二套 Pi 专用按钮：

```js
import {createVoiceAssistant} from '@xiaoyun/voice';
const voice = createVoiceAssistant({
  projectId:'meeting',
  backendUrl:'http://127.0.0.1:8765',
  assetBaseUrl:'/xiaoyun/',
  mode:'live',
  context:{room:'A', view:'overview'},
  actions:[{
    name:'open_schedule', description:'打开指定会议室的会议日程',
    parameters:{type:'object', properties:{room:{type:'string'}}, required:['room']},
    execute:async ({room}) => {
      await openSchedule(room);
      voice.updateContext({room, view:'schedule'});
      return {room, view:'schedule'};
    },
  }],
});
```

业务函数应在实际修改完成后再返回；每次页面状态变化调用 `updateContext`，传完整快照。SDK 自动维护版本，宿主不需要手工传递版本号。

Pi 使用 `observe_page` 获取最新状态、动作和版本，再用 `execute_page_action` 执行。后端与 SDK 都检查版本；操作过程中若其他任务或用户改变页面，旧版本请求会返回错误，Pi 重新观察后再决定。各任务的页面动作共用串行通道，查询/计算仍可并行。

明确取消任务会跳过尚未开始的动作；已开始的宿主函数仍由宿主完成，不自动回滚。结束语音会话后不开始剩余页面动作；纯后台查询仍可继续并静默显示结果。页面断开或动作超时会报告实际状态，不自动重试可能已执行的动作。

## 接入检查

先验证单个动作与原按钮行为一致，再让 Pi 执行需要依赖前一步结果的任务。观察公开 onEvent 的 task.update、action.executed、diagnostic 和 delivery.update。完整业务结果只触发一次 onTaskResult，重播不重新执行动作。

Qwen 同一轮提出多个页面步骤时，后台统一转交 Pi；若同轮已有任务受理则合并到该任务，避免按钮先执行一遍、Pi 再执行一遍。单个明确页面按钮仍直接执行。
