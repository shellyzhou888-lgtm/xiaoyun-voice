---
name: meeting
description: 读取指定会议室的日程，并按会务流程设置会议室与日程页面。
---

# 会议展示准备

先明确会议室；没有提供时用 request_clarification 询问，保留原任务。
调用 read_agenda 读取示例日程，再 observe_page。
使用实际注册的 choose_room 和 open_schedule 动作分步设置页面，每步等待回执并使用返回的 page.version；状态已满足的步骤跳过。
页面被用户改变时重新观察，再判断是否继续。
交付简短结论、详细日程和数据；明确这是固定示例数据，不编造具体日期和会议时间。
