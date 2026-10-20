# 数据与展示约定

数据源名称为 sales，SQLite 表名也为 sales。

| 字段 | 含义 |
| --- | --- |
| region | 华东、华南、华北、西部 |
| year | 2025 或 2026；这是数据年份，不是今天 |
| month | 1 至 12 |
| product | 产品名称 |
| revenue | 收入，元 |
| cost | 成本，元 |

全年汇总必须按地区和年份汇总各月各产品，利润为 SUM(revenue-cost)。需要精确数值时从 SQL 或 Python 结果取值。

年度利润同比供宿主图表使用的 data 格式：

```json
{
  "kind": "profit_comparison",
  "region": "实际地区",
  "rows": [
    {"year": 2025, "revenue": 0, "cost": 0, "profit": 0},
    {"year": 2026, "revenue": 0, "cost": 0, "profit": 0}
  ],
  "changePercent": 0
}
```

示例零值必须替换为真实计算结果。changePercent 为百分数值，例如 9.81 表示增长 9.81%；上期利润为零时为 null 并解释。其他分析可以按任务提供合适结构。

展示动作以 observe_page 返回为准。示例大屏提供 set_period、set_region、set_metric、navigate、focus_chart；其中 focus_chart 会切换放大状态，不要重复调用已经完成的切换。
