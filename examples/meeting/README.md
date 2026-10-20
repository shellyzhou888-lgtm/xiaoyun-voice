# 独立会议页面

此示例依赖已安装的组件包和公开接口，不引用销售大屏或组件源码。

1. 在本目录 `npm install`，私有 GitHub 需要当前账号有仓库访问权限。
2. `npx xiaoyun init` 复制资源并创建 `.env.xiaoyun`。
3. 填写 Key、Python 路径，并添加 `VOICE_PROJECT_MODULE=./voice-project.mjs`。默认后台端口为 8765。
4. `npx xiaoyun start` 启动后台；另一个终端 `npm start`，打开 `http://127.0.0.1:8766`。
5. 点击原页面按钮，再输入“按会务流程准备银杏厅的会议展示”。Pi 读取本例 Skill、查询固定示例数据并操作同一组业务函数。

若使用其他后台端口，页面 URL 添加 `?backend=http://127.0.0.1:你的端口`；UI 端口用环境变量 UI_PORT 配置。

要替换真实业务，只需修改项目工具和 Skill，保留 actions / updateContext 接入约定。固定的两场示例会议不代表真实日程。
