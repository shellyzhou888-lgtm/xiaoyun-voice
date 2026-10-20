# @xiaoyun/voice 1.0.0-beta.1

独立浏览器小云组件。发行文件已包含 UI 运行时，不要求宿主使用 React。使用 1.0.0-beta.1 后台，协议版本不一致会明确提示同步更新。

```js
import { createVoiceAssistant } from '@xiaoyun/voice';

const voice = createVoiceAssistant({
  projectId: 'demo',
  mode: 'demo',
  backendUrl: 'http://127.0.0.1:8765',
  // npm+构建工具使用时，将 dist/assets 复制到宿主 public/xiaoyun-assets。
  assetBaseUrl: '/xiaoyun-assets/',
  context: { view: 'overview', region: '全部' },
  ui: { baseFontSize: 14, position: { right: 28, bottom: 22 }, shortResultMs: 10000, longResultMs: 10000 },
  actions: [{
    name: 'set_region',
    description: '切换页面当前地区',
    parameters: { type:'object', properties:{region:{type:'string'}}, required:['region'], additionalProperties:false },
    execute: ({region}) => { document.querySelector('#region').textContent = region; return {region}; },
  }],
  onTaskResult: (result) => console.log(result.data, result.contextAtStart),
});

// 页面变化时替换完整快照
voice.updateContext({ view:'overview', region:'华东' });
// 卸载页面
// voice.destroy();
```

也可以直接从小云后台 `/sdk/voice.js` 导入，所有资源自动相对该文件加载，不需要复制资源。宿主地址需要加入后台 ALLOWED_ORIGINS。

公开方法：`updateContext`、`setActions`、`wake`、`endSession`、`setMicEnabled`、`submitText`、`replayResult(taskId)`、`retryDelivery(deliveryId)`、`stopDelivery(taskId)`、`selectResult(taskId?)`、`retryTask(taskId)`、`destroy`。重播已有摘要不重跑任务，也不再次触发 `onTaskResult`；停止指定结果的声音不影响另一条结果，也不取消计算。选择追问对象与宿主页面上下文分开。

结果声音失败推荐 `await voice.replayResult(taskId)`。唤醒、澄清、确认等非结果临时字幕失败时，从 `onEvent` 的 `delivery.update` 读取 `event.delivery.deliveryId`，调用 `await voice.retryDelivery(deliveryId)`。二者都返回 Promise；交付编号与任务编号、句编号不同。通过 `event.delivery.kind !== 'result'` 识别临时字幕，澄清句也可能有任务编号。

角色采用紧贴主体的磨砂玻璃外层与持续待机动作。鼠标悬停显示统一玻璃工具栏，麦克风和键盘按钮均为 48×46 像素；按住角色可拖动，气泡自动避开屏幕边缘。键盘聚焦和触摸也可显示操作入口。组件始终启用完整动画，不受系统“减少动态效果”影响。

临时字幕、紧凑任务进度和最终结果卡分别展示。只有最终结果建卡，普通结果最多 3 张，固定卡另计。默认展示口头摘要，详情、表格和查询来源折叠；读旧卡时新结果暂存，点击“有新结果”合入，不打乱阅读位置。短结果交付后约 30 秒、长报告约 60 秒以轻柔破泡动画退场；排队、播放、悬停、聚焦及展开阅读时暂停计时。阅读保护不暂停声音。

`renderResult(result, container)` 可仅替换展开详情，并返回收起、替换或卸载时的清理函数；字幕更新不会使同一详情重新挂载。完整示例见工作区接入指南及 React／Vue 示例。

`onEvent` 提供任务、字幕、`delivery.update`、`diagnostic`、`playback.started`／`playback.finished` 和耗时事件。交付与计算状态独立，只有实际播完才标记 `delivered`；不能把模型生成结束当成播完。等待语在完整句的播放边界让位给结果，正式结果按顺序交付，用户插话立即停声。

`TaskResult.sources` 是实际工具查询来源，包含标题、网址和 `fetchedAt`，可选 `publishedAt`／`updatedAt` 只来自来源明确提供的信息。抓取时间不表示数据更新时间。

内置 `demo`／`playground` 的销售汇总与利润同比结果使用以下 `TaskResult.data`，其他项目可定义自己的结构：

```ts
interface ProfitComparisonData {
  kind: 'profit_comparison';
  region: '华东' | '华南' | '华北' | '西部';
  rows: Array<{year: 2025 | 2026; revenue: number; cost: number; profit: number}>;
  changePercent: number | null;
}
```

`rows` 按年份升序包含两行；`revenue/cost/profit` 是以元为单位的数字。`changePercent` 是百分比数值：`9.81` 显示 `9.81%`，无需乘 100。上年利润为零时为 `null`，表示不能计算同比。内置 SQLite 的华东数据为：

```json
{
  "kind": "profit_comparison",
  "region": "华东",
  "rows": [
    {"year": 2025, "revenue": 10632105, "cost": 6804547.2, "profit": 3827557.8},
    {"year": 2026, "revenue": 12545883.9, "cost": 8343012.8, "profit": 4202871.1}
  ],
  "changePercent": 9.81
}
```

宿主确认 `status:'succeeded'`、`data.kind:'profit_comparison'` 并核对 `contextAtStart` 后，直接把 `data.rows` 映射到图表；不从摘要猜测字段。`year` 是年份字段，利润序列为 `rows.map(row => row.profit)`。

麦克风开启时，眼睛平滑跟随鼠标。思考使用原库 curious 的歪头探看，执行使用 humming 的角色律动，播报使用 dictating 的整体液态声波变形并保留脸部，以实际播放音量驱动。鼠标悬停角色时切换 happy 表情并轻弹一下，移开后继续原状态；闭麦悬停保持睡姿。所有视觉反馈均不改变会话、收音或任务。

默认持续对话：唤醒后回答完成或安静等待都不自动退出，再次点击或明确说“小云你退下吧”“好了没事了”才结束。旧行为可用 `autoEndSession:true` 显式启用，此时才使用 `waitForSpeechMs` 等待开口计时。请同步更新后台。

麦克风需要 HTTPS 或 localhost。组件待唤醒时仅在本地检测关键词；完全关闭麦克风后需通过点击重新开启。无 Key 的演示模式可通过 submitText 测试任务与界面，浏览器自带语音播出演示文案。

演示模式使用固定动作名称：地区话术调用 `set_region({region})`，年份话术调用 `set_period({year})`，指标调用 `set_metric({metric:'profit'|'revenue'})`，视图调用 `navigate({view:'overview'|'regions'})`，放大图表调用 `focus_chart({chartId:'trend'|'comparison'})`。测试哪些页面操作，就注册对应动作；例如“切换到2026年”要求 `set_period`，不会自动匹配 `set_year`。真实模式依据宿主提供的名称、说明和 Schema 选择工具，可以使用自定义名称。完整话术与参数表见工作区接入指南。

完整服务源码与接入指南随工作区交付。此包包含用户指定的 Grok 学习动效资源，请保留 THIRD_PARTY_NOTICES.md；不用于公共 npm 发布。
