# 接入小云：给前端 Agent 的入口

这是公开可读取的组件源码仓库，包含浏览器 SDK 和本地后台，不包含宿主页面。保留用户已有网页和业务函数，将小云接进去即可。仓库公开不代表发布到 npm，也不改变第三方素材的权利归属；保留 `THIRD_PARTY_NOTICES.md`。

1. 读取 [接入指南](docs/INTEGRATION.md)。使用 `npm install git+https://github.com/shellyzhou888-lgtm/xiaoyun-voice.git#v1.0.0-beta.1-power-earth.5` 安装；无需为读取本仓库配置 GitHub 凭据，不向用户索要明文 token 放进 URL。
2. 在宿主项目运行 `npx xiaoyun init`。默认复制资源至 `public/xiaoyun`，对应 `assetBaseUrl:'/xiaoyun/'`。其他框架调整静态目录和 URL，使浏览器能读取完整资源。
3. 填写或复用后台配置 `.env.xiaoyun`，密钥只给后台，不加 `VITE_` / `NEXT_PUBLIC_` 等前端暴露前缀。Python 使用用户指定环境；缺少 `ddgs` 时仅在该环境安装所需包，不升级已有环境。
4. `npx xiaoyun start` 启动或复用本地后台。默认 `projectId:'default'`，没有演示销售数据库。只有查询业务数据时才创建项目模块。
5. `createVoiceAssistant` 在浏览器挂载后调用。每个现有按钮的业务函数注册成 `actions` 中的工具，提供清楚的名称、说明和参数 JSON Schema。不要复制 SDK 内部实现或向后台发送函数源码。
6. 页面改变时 `updateContext` 替换完整快照；`onTaskResult` 根据 `contextAtStart` 决定是否更新当前图表。`selectResult` 是选择对话对象，不要混入宿主页面状态。
7. 用公开 `submitText` 验证动作与按钮一致；检查 Worker/WASM URL，再让用户实际验证麦克风。组件卸载时 `destroy`。

`replayResult(taskId)` 只重播已有结果；`stopDelivery(taskId)` 只停止该任务的声音；`retryDelivery(deliveryId)` 重试失败字幕；`retryTask(taskId)` 重试失败任务。所有结果和交付事件可通过 `onEvent` 观察。

## 修改组件本身

- 协议在 `packages/protocol`；SDK 在 `packages/voice`；后台在 `packages/server`。
- SDK 与后台版本必须一致。发布先构建、检查、运行行为测试；不添加文件哈希测试、机械 DOM 快照或覆盖率目标。
- 告别、结果交付以实际播放排空为准，不能用模型生成结束代替。关闭后的旧事件不能重新计时或影响新会话。
- 保留角色、玻璃工具栏、拖动和动画；动画不随系统减少动画设置静止。
- 保留 `THIRD_PARTY_NOTICES.md`。不上传 `.env.xiaoyun`、运行数据库、录音、日志或宿主页面数据。

## 1.0-beta 能力

- 原生 Qwen 实时语音继续使用；普通回应完整播放结束后才交接后台结果，用户插话优先。
- 纯播报或追问的工具限制只属于该响应；生成结束即恢复普通会话的工具与提示，不能等下一次云端 speech_started 才恢复。任务去重由受理编号处理，不通过持续清空工具实现。
- Pi 支持按项目加载 SKILL.md 和参考资料，以及 observe_page / execute_page_action 多步页面操作。Skill 说明见 `docs/SKILLS.md`。
- 宿主仍用 actions 注册业务函数，并在实际修改后 updateContext；版本由 SDK 自动管理。

- 当前说话气泡放在角色左上方，只有实际播放时有尾巴；资料卡无尾巴。普通字幕播完保留 10 秒，未固定资料卡默认 10 秒并在阅读期间暂停。关闭资料卡与停止声音独立。

- 字幕区域按实际内容占高，不因存在资料卡而预留固定高度。资料、提示与气泡保持紧凑间距；阅读保护沿用结果暂存和滚动跟随规则。
