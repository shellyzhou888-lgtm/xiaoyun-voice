# 小云语音组件 · 1.0-beta

供仓库所有者个人使用的私有组件库。包含可嵌入任意网页的语音角色、Markdown 结果界面和本地后台；不包含销售展示大屏、真实数据或模型密钥。

**给开发 Agent：先阅读 [AGENTS.md](AGENTS.md)，再按 [接入指南](docs/INTEGRATION.md) 操作。**

## 安装到你的网页项目

要求 Node.js 24、Python 3.12+，以及此私有仓库的访问权限。已经登录 GitHub 的 Agent 可以直接拉取；新环境先配置 GitHub CLI 或 Git 凭据。不要把 token 写进安装 URL。

```sh
npm install git+https://github.com/personoj/xiaoyun-voice.git#v1.0.0-beta.1
npx xiaoyun init
```

在生成的 `.env.xiaoyun` 中填写 `DASHSCOPE_API_KEY`、`DEEPSEEK_API_KEY`、`PYTHON_EXECUTABLE`。如需联网搜索，在指定的 Python 环境中安装 `ddgs`，然后启动后台：

```sh
npx xiaoyun start
```

`init` 将 Worklet、Worker、WASM 和唤醒模型复制到 `public/xiaoyun/`，只在配置文件不存在时创建它，并追加对应的 Git 忽略规则。后台默认运行于本机 `http://127.0.0.1:8765`；已有相同版本服务时会复用。后台没有绑定某一个展示页面。

```ts
import {createVoiceAssistant} from '@xiaoyun/voice';

const voice = createVoiceAssistant({
  projectId: 'default',
  backendUrl: 'http://127.0.0.1:8765',
  assetBaseUrl: '/xiaoyun/',
  mode: 'live',
  context: {page: 'home'},
  actions: [{
    name: 'show_settings',
    description: '打开当前网页的设置面板',
    parameters: {type: 'object', properties: {}, additionalProperties: false},
    execute: () => openSettings(), // 同一个函数也用于原有页面按钮
  }],
});
// 页面状态改变时调用 voice.updateContext(完整新快照)。卸载时 voice.destroy()。
```

普通 HTML 也能从已启动的后台直接导入 `http://127.0.0.1:8765/sdk/voice.js`，无需改为 React/Vue。此方式会相对入口自动加载资源。

## 工作方式

- 页面动作由宿主显式注册；组件不会靠猜测 DOM 自动操作所有按钮。
- 点击/关键词唤醒后持续对话。语音告别会播完一句再退出；点击关闭立即停声；告别期间插话可继续。
- 复杂任务由独立 Pi Agent 执行，最多三个并行。支持按项目加载业务 Skill、只读 SQL、受限 Python、联网和多步页面动作。
- 保留 Qwen 原生语音；后台结果排队，等当前整段回应实际播完后再接入，不增加独立 TTS。
- 模型密钥只在后台。默认 `default` 项目不附带业务数据库；其他网页注册自己的动作即可使用，业务数据按需配置。
- 结果卡支持展开、固定、重播、关闭和阅读保护；同一任务重播不重复触发业务回调。

## 开发与版本

```sh
git clone https://github.com/personoj/xiaoyun-voice.git
cd xiaoyun-voice
npm ci
npm run check
npm test
npm run build
```

Git 依赖安装时由 `prepare` 构建 SDK 和后台。若宿主启用了 `--ignore-scripts`，可先在独立 clone 中构建并 `npm pack`，再安装得到的 `.tgz`。安装行为参考 [npm 官方说明](https://docs.npmjs.com/cli/v11/commands/npm-install/)；私有仓库凭据参考 [GitHub 官方说明](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git)。

角色沿用现有内部使用的 Grok study 适配。保留 [素材来源与使用说明](THIRD_PARTY_NOTICES.md)，不将第三方素材声明为原创或额外授予其分发许可。

业务扩展见 [Skill 指南](docs/SKILLS.md)，完整独立页面见 [会议示例](examples/meeting/README.md)。这是预发行版，验证范围见 [验收记录](docs/VALIDATION.md)。
