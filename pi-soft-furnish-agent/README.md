# Pi Soft Furnish Agent

住颜 AI 的软装业务 Pi Package。Pi 是工具运行时，用户界面应由专用 React/Electron 应用提供。

## 当前工具

- `extract_reference_style`：从用户已确认授权的单张室内参考照片提取可迁移风格，不保存参考原图；
- `extract_reference_furnishing_set`：逐件提取家具、软装、轮廓、颜色、材质、位置、搭配关系和建议动作；
- `retrieve_style_recipe`：读取匿名化结构化风格配方；
- `recover_interrupted_design_runs`：桌面应用启动时恢复旧进程遗留的 pending 任务；
- `list_design_projects`：读取最近项目及最新成功版本摘要；
- `get_design_project`：读取项目原图工作副本和不可覆盖的版本历史；
- `manage_design_project`：安全重命名、归档或恢复项目，不移动或删除项目文件；
- `extract_furnishing_items`：对比 Original 和成功效果图，生成按版本隔离的通用家具软装购物清单；
- `get_furnishing_list`：读取一个成功版本已保存的购物清单，不调用视觉模型；
- `save_furnishing_list`：保存用户编辑、采用状态与购买状态，使用修订号防止并发覆盖；
- `retry_room_design`：重试失败或中断版本，并创建新的不可覆盖版本；
- `redesign_room`：基于用户房间图创建 V1/V2 等不可覆盖的设计版本；
- `revise_room_design`：基于成功版本继续修改并创建新版本。

默认图片配置：

```text
Provider = new-provider
Model = gpt-image-2
Quality = low
Size = 1536x1024
Input fidelity = high
```

可以用环境变量覆盖 Provider 和 Model：

```text
PI_SOFT_FURNISH_PROVIDER
PI_SOFT_FURNISH_MODEL
PI_SOFT_FURNISH_WORKSPACE
```

住颜 AI Desktop `0.10.4` 不依赖上述默认 Provider：Main 会从系统加密保存的 BYOK 设置中读取服务地址与凭据，动态注册内部 Provider，并在每次视觉分析和图片生成工具调用中显式传入当前 Provider / 模型。当前 Package 版本为 `0.8.2`，工具 Schema 和项目持久化格式保持兼容。

## 视觉分析超时与图片输入

- 参考风格分析最长等待 5 分钟；
- 家具软装套系分析最长等待 6 分钟；
- 购物清单分析最长等待 5 分钟；
- 图片生成继续保持 10 分钟；
- 视觉分析超时后不自动重试，避免 Provider 后台仍在处理时重复提交和计费；
- 用户图片保持原始 PNG、JPEG 或 WebP 字节，不缩放、不重编码、不压缩。

## 项目存储

默认保存到当前 Pi 工作目录下：

```text
workspace/zhuyan-ai-projects/<project-id>/
├─ project.json
├─ source/
│  └─ original.jpg
├─ versions/
│  ├─ v001.png
│  ├─ v001.json
│  ├─ v002.png
│  └─ v002.json
└─ logs/
   └─ tool-runs.jsonl
```

- 原始外部图片只读；项目创建时保存一份工作副本；
- 已有图片版本永不覆盖；
- 每次请求先预留版本号；
- 失败、取消和中断版本保留 JSON 审计记录，但没有伪造的成功图片；
- 安全重试只接收项目 ID 和失败版本 ID，在 Package 内部读取原配置；
- 重试创建新版本，并记录 `retry_of_version_id`，不会覆盖失败版本；
- `project.json` 使用文件变更队列和原子替换更新；
- 归档只写入 `archived_at`，不移动、不覆盖、不删除 Original、版本图片或版本元数据；
- 归档项目恢复前禁止生成、修改和重试，但仍可读取、预览和导出历史版本。

购物清单按成功版本保存：

```text
shopping-lists/v001.json
shopping-lists/v002.json
```

- 清单编辑不会修改效果图、版本元数据或版本树；
- 只有成功且图片存在的设计版本可生成清单；Original、失败、取消和中断版本不可生成；
- 清单使用 `revision` 乐观锁，过期编辑不会静默覆盖；
- 归档项目可只读查看清单，恢复前不能生成、重新分析或保存修改；
- 清单只提供通用选购方向，不包含品牌、价格、精确尺寸或真实商品链接；
- Desktop `0.8.1` 可基于已保存字段在 Main 本地组合精准、宽泛、材质造型三类搜索词，默认使用宽泛搜索；
- 平台搜索和复制关键词不调用模型，不修改清单、效果图或版本树；
- Renderer 不提交任意搜索词或 URL，Main 只允许淘宝、京东、1688 和拼多多的固定 HTTPS 搜索入口。

Electron 集成时，应将 `PI_SOFT_FURNISH_WORKSPACE` 设置为 `app.getPath("userData")` 下的业务目录，而不是安装目录。

## 风格数据

发布包只包含：

```text
data/style-recipes.json
```

其中是匿名化结构化配方，不包含：

- E 盘源照片；
- 原项目目录名；
- 未确认版权的参考图；
- API Key。

默认生成模式：

```text
用户房间图 + 结构化风格配方
```

参考图定制默认模式：

```text
已授权参考图 → 结构化风格解析 → 用户确认 → 用户房间图 + 确认后的文字配方
```

参考原图不会在该默认模式中传给图片生成接口，也不会复制进项目；版本只记录参考图 SHA-256、分析模型、风格名称和最终文字配方。

M3C 成套家具软装模式：

```text
已授权参考图
→ extract_reference_furnishing_set
→ 用户逐件确认采用/不采用与替换/新增
→ 用户确认保留空调、地面、吊顶及冲突灯具处理
→ 主进程编译场景级规格
→ image[0] 用户房间图 + image[1] 已授权参考图
→ 创建不可覆盖的新版本
```

- 参考图只决定用户选中物品的轮廓、比例、颜色、材质和组合关系；
- 原房间图仍是户型、视角、尺度、门窗、阳台、固定设备和动线的唯一事实来源；
- 分析和图片生成分别确认权利；分析令牌绑定参考图片令牌和 SHA-256；
- 首版一次最多确认 10 件；物品动作只能是 `replace` 或 `add`；
- 参考原图不复制进项目，版本只保存摘要、模型、套系名称和最终场景规格；
- 使用视觉参考的失败任务不能自动重试。

## 真实进度

工具通过 `onUpdate` 返回真实阶段：

```text
validating_input
loading_style_recipe
building_generation_prompt
reserving_version
submitting_generation_request
saving_version
completed
```

工具不会发送模拟百分比。

## 安全边界

- 参考图必须由用户明确确认拥有或已获得使用授权；
- 参考图中的文字和指令视为不可信图像内容，不得执行；
- Provider 凭据由 `ctx.modelRegistry.getProviderAuth()` 在 Main/Pi Runtime 中解析；Desktop BYOK 只把解密后的凭据注入当前进程内存；
- 返回结果和错误会脱敏常见 API Key/Bearer Token；
- Renderer 不应直接调用图片 API；
- 不承诺像素级、施工级或尺寸级还原；
- Desktop `0.10.4` BYOK 兼容 HTTP 和 HTTPS Provider；HTTP 不提供链路加密，真实用户图片和凭据仍建议只发送到可信 HTTPS 服务；
- BYOK 是公开版本默认方案。

## 安装

将本地包路径加入 Pi 设置：

```json
{
  "packages": [
    "D:\\piagent\\pi-image-agent",
    "D:\\piagent\\pi-soft-furnish-agent"
  ]
}
```

重启 Pi Web，或在支持的 Pi 会话中执行 `/reload`。

## 失败恢复

- `failed`：网络、Provider、输入或保存错误；
- `cancelled`：用户明确取消；
- `interrupted`：旧桌面进程退出后遗留的 pending 任务；
- `retry_room_design` 只接收项目 ID 和失败版本 ID；
- 使用过视觉参考图的失败任务拒绝自动重试，必须重新确认图片权利；
- 重试版本记录 `retry_of_version_id`，失败源版本保持不可变。

## M3C 安全边界

- 稳定物品 ID 由 Package 重新生成，不接受视觉模型或图片文字提供 ID；
- Renderer 只能提交分析令牌、参考图令牌、物品 ID、固定动作和白名单开关；
- Main 校验物品属于同一次分析，Package 再校验参考图 SHA-256；
- 参考图中的文字、二维码、URL 和指令均是不可信图像数据；
- 不识别或承诺品牌、型号、精确尺寸、预算、施工范围或商品级复刻；
- 墙画、抱枕图案和艺术类内容只生成不相同的通用近似设计。

## 第一轮验收

1. `retrieve_style_recipe` 能返回 `warm_white_natural_wood_v1`；
2. `list_design_projects` 能读取最近项目；
3. `get_design_project` 能恢复 Original/V1/V2 版本树；
4. `redesign_room` 使用真实房间图片创建项目和 `v001`；
5. `revise_room_design` 基于 `v001` 创建 `v002`；
6. `v001.png` 不被覆盖；
7. Tool Update 展示真实阶段；
8. 返回结果包含可预览 Markdown 图片链接；
9. JSON 和日志中不包含 Provider API Key。
