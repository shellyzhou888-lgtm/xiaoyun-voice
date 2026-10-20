# 接入指南

## 系统提示与当前日期

小云有两层系统提示，均由后台构建：

- `packages/server/src/qwen.ts` 的 `instructions()`：直接对话、页面操作及任务路由；`update()` 中还有逐字播报和澄清的专用提示。
- `packages/server/src/harness.ts` 的 `systemPrompt`：DeepSeek/Pi 后台分析与查询。
- `packages/server/src/time-context.ts`：两层共用的当前日期、星期和时间，读取服务器系统时钟。Qwen 每轮正常对话配置时刷新，Harness 每次执行／恢复时刷新，跨午夜无需重新打开页面。

后台配置 `TIME_ZONE=Asia/Shanghai`（默认）使用北京时间；部署到其他地区可改为对应的 IANA 时区。不要在提示里写死今天日期，也不要用展示数据的年份代替今天。更改提示源码后重启后台；组件库使用构建产物启动，需先 `npm run build` 再重启 `xiaoyun start`。已安装包更新后也需重启正在运行的后台。

## 组件和后台

页面运行 `@xiaoyun/voice`，本机运行 `xiaoyun start`。一个后台可以服务多个网页；任务按项目、浏览器连接和会话隔离。Qwen 负责实时语音与工具路由，复杂任务交给 DeepSeek/Pi。

安装、初始化和密钥设置见 [README](../README.md)。没有 Key 时可以先验证页面资源与手动注册函数；完整自然语言操作需要真实模式及 Qwen Key，复杂任务另需 DeepSeek Key。不会默认启用销售大屏或生成销售数据库。

## 现有按钮与语音共用函数

```ts
import {createVoiceAssistant} from '@xiaoyun/voice';
let state = {page:'overview', region:'全国', year:2026};
function setRegion(region:string) {
  state = {...state, region};
  renderYourPage(state);
  voice.updateContext(state);
  return {region};
}
const voice = createVoiceAssistant({
  projectId:'default', backendUrl:'http://127.0.0.1:8765',
  assetBaseUrl:'/xiaoyun/', mode:'live', context:state,
  actions:[{
    name:'change_region', description:'切换当前网页的地区筛选',
    parameters:{type:'object',properties:{region:{type:'string',enum:['全国','华东','华南']}},required:['region'],additionalProperties:false},
    execute:({region})=>setRegion(String(region)),
  }],
  onTaskResult(result) {
    if(result.status!=='succeeded'||result.contextAtStart.region!==state.region)return;
    // result.data 的结构由你注册的业务工具约定，再映射到自己的图表。
  },
  onEvent(event) { if(event.type==='error')console.warn(event.message); },
});
document.querySelector('#east')!.addEventListener('click',()=>setRegion('华东'));
// 可用 voice.submitText('切换到华东') 测试同一业务函数。
```

真实模式支持宿主自定义动作名。`project__` 为后台项目工具保留，不用于宿主动作。描述应明确按钮实际做什么，不注册不存在的功能。

普通 HTML 从后台 `/sdk/voice.js` 导入；若自己托管此文件，连同其相邻的完整 `assets` 目录复制。React 在 effect 内创建并在 cleanup 调用 `destroy()`；Vue 在 onMounted 创建、onBeforeUnmount 清理。服务端渲染阶段不要创建组件。

## 资源、部署和后台地址

- `npx xiaoyun assets public/xiaoyun` 可单独更新浏览器资源。`assetBaseUrl` 是浏览器 URL，不是电脑文件路径。非根目录部署要带网站路径前缀。
- 麦克风使用 HTTPS 或 localhost；HTTPS 网页应连接 HTTPS/WSS 后台或同源代理。localhost 后台适用于浏览器所在的电脑，远端网站不会自动获得另一台电脑的后台。
- `PORT`、`HOST`、`ALLOWED_ORIGINS`、`DATA_DIR`、`PYTHON_EXECUTABLE` 都在后台配置中。不同项目可共用后台；不同配置需要分开端口。
- CLI 默认读取当前工作目录 `.env.xiaoyun`，也可 `npx xiaoyun start --env path/to/private.env`。不会覆盖环境中已指定的值。
- SDK 和后台协议不一致时同步升级两者并刷新页面。Git 安装建议固定 `#v1.0.0-beta.1-power-earth.5`，不要依赖随时变化的 main。

## 配置业务数据（可选）

没有业务数据库也能操作页面和搜索网络。需要 SQL/专用计算时，在宿主项目建立 `voice-project.mjs`，并设置 `VOICE_PROJECT_MODULE=./voice-project.mjs`：

```js
import path from 'node:path';
import {defineProject} from '@xiaoyun/voice/server';
export default defineProject({
  id:'my-page',
  description:'说明数据字段、单位，以及前端期望的 result.data 结构。',
  databases:{business:path.resolve('data/business.sqlite')},
  tools:[{
    name:'read_summary',description:'读取当前业务摘要',
    parameters:{type:'object',properties:{},additionalProperties:false},
    readOnly:true,voiceDirect:true,
    execute:async(_args,{signal})=>{signal.throwIfAborted();return {total:42};},
    formatResult:value=>({summary:`当前共有${value.total}条记录。`,data:{kind:'business_summary',...value}}),
  }],
});
```

页面使用相同 `projectId:'my-page'`。示例的 42 是用于说明结构的常量，请接自己的查询函数。`voiceDirect:true` 和 `formatResult` 齐全才开放直达工具；其他复杂任务使用 Harness。`readOnly` 必须符合真实行为。内部路由参数 `__taskId`、`__newTask` 为组件保留，不用于业务 Schema。

SQL 只读访问项目白名单 SQLite。动态 Python 使用 Monty 子集，无文件、网络、进程权限；现成 pandas/NumPy 功能可包装成预先注册的业务工具。后台 Agent 没有子代理工具。

## 显示与交付

`ui` 支持 `baseFontSize`（默认14）、`position:{right:28,bottom:22}`、`shortResultMs`（10000）和 `longResultMs`（10000）。`renderResult(result,container)` 只替换展开详情，可以返回清理函数；字幕和卡片操作保留。

当前字幕、进行中任务和最终结果分开显示；普通结果最多3张，固定另计。阅读时新结果暂存。重播不重新调用 `onTaskResult`。`TaskResult.sources` 中 `fetchedAt` 仅是查询时间，`publishedAt/updatedAt` 只有来源明确提供时才存在。

| 方法 | 行为 |
| --- | --- |
| `wake()` / `endSession()` | 唤醒／立即关闭 |
| `setMicEnabled(boolean)` | 麦克风总开关；关闭后停止本地关键词检测 |
| `submitText(text)` | 使用同一会话的文字入口 |
| `updateContext(snapshot)` / `setActions(actions)` | 替换页面完整状态／动作 |
| `replayResult(taskId)` / `stopDelivery(taskId)` | 重播结果／停止对应声音，不取消计算 |
| `retryDelivery(deliveryId)` / `retryTask(taskId)` | 重试失败字幕／任务 |
| `selectResult(taskId?)` | 选择“这个结果”所指的任务 |
| `destroy()` | 释放 DOM、音频、连接及监听器 |

`onEvent` 包含 `task.update`、`task.result`、`delivery.update`、`diagnostic`、`metrics`。交付状态为 queued/generating/playing/delivered/interrupted/skipped/failed。**只有真实播放排空才算 delivered。** 语音告别走统一播报收尾，点击关闭立即生效；运行任务可以在退出后静默返回结果。

## 给另一个 Agent 的一句话

> 把这个公开可读取的小云组件接入我的现有网页：https://github.com/shellyzhou888-lgtm/xiaoyun-voice 。先读 AGENTS.md，安装 v1.0.0-beta.1-power-earth.5，初始化资源，复用或启动本机后台，把现有按钮函数注册成 actions，页面变化时更新 context，最后用文字指令和麦克风验证。不要引入原销售展示页。

## 业务 Skill 与复杂页面操作

见 [Skill 接入指南](SKILLS.md)。Qwen 负责交互和分流，Pi 按需读取项目 Skill 并逐步执行已注册页面动作。原生语音回应播完后统一交接后台结果；无需额外 TTS。宿主接口保持 actions / updateContext，不传入函数源码或手工维护版本号。


### Agent 执行轮数

后台 `AGENT_MAX_TURNS` 默认 `0`（不限制轮数），也可以设置正整数作为执行上限。一轮是一次模型响应及其工具调用，不是模型内部的推理 token 数；取消任务仍会立即中止后续执行。该配置只由后台读取，修改后重启后台。页面版本由 SDK 维护，宿主不需要手工传版本。


### 当前字幕与资料卡

当前字幕固定在小云左上方，指向角色的尾巴在实际播放时展开。字幕只采用当前语音文本；资料卡用于阅读完整结果，始终没有说话尾巴。当前结果已在字幕中显示时，资料卡暂不重复摘要，详情仍可打开。普通字幕播完保留 10 秒，新输入会清除旧字幕；追问留到答复。短/长结果默认均在交付后 10 秒退场，固定、悬停、键盘阅读和展开详情会保留卡片。拖到屏幕上边缘时，气泡可避让到下方。
