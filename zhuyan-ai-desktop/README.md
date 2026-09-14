# 住颜 AI Desktop

Electron + React + Vite 的住颜 AI 专用桌面工作台（当前源码版本 `0.10.4`，内置 Pi Soft Furnish Runtime `0.8.2`）。Windows x64 新安装包必须完成构建和三层审计后才可分发；macOS Apple Silicon（arm64）构建与审计流程已准备，仍需在真实 Apple Silicon Mac 上执行和验收。Pi 作为主进程中的业务工具运行时，Renderer 不接触已保存的 Provider API Key、任意文件系统或通用 coding tools。

## 当前纵切面

- 我的项目：读取本地项目摘要；
- 新建设计：参考图优先的“房间照片 → 参考照片 → 补充要求 → 设计图”简化流程；
- 参考图定制：默认“整体参考”，也可在次要设置中切换为“只参考氛围”；
- 基础风格：不再占据主流程，只有没有参考照片时才从折叠入口选择；
- 成套复制：解析具体家具软装，逐件确认采用/不采用和替换/新增，并确认空调、地面、吊顶、灯具、墙色和通用墙画处理；
- 真实进度：展示 Pi Tool `details.stage`，不模拟百分比；
- 设计结果：切换 Original/V1/V2/V3；
- 图片对比：通过滑杆比较 Original 和当前成功设计版本；
- 安全下载：主进程校验项目与版本后调用 Windows 保存对话框；
- 继续修改：基于选中成功版本创建不可覆盖的新版本；
- 异常恢复：区分失败、取消和中断任务，展示失败阶段；
- 安全重试：仅提交项目 ID 和失败版本 ID，由 Package 内部恢复配置并创建新版本；
- 重启恢复：通过 `list_design_projects` / `get_design_project` 恢复项目；
- 项目管理：安全重命名、归档、查看已归档项目和恢复项目；
- 选定设计：在任一成功版本上直接进入或生成该版本购物清单；
- 购物清单：基于成功版本生成、编辑和按版本保存家具软装清单，支持购买状态与通用购物搜索；
- 设置与 BYOK：配置一个 OpenAI 兼容 Provider，并为视觉分析和图片生成分别指定模型。

## 安全边界

- `contextIsolation: true`；
- `nodeIntegration: false`；
- `sandbox: true`；
- Renderer 只获得 `window.zhuyan` 白名单 API；
- 下载只接受 `projectId + versionId`，不接受 Renderer 传入源文件路径；
- 本地文件选择返回能力令牌，而不是允许 Renderer 任意指定路径；
- 项目图片通过只读 `zhuyan-asset://` 协议预览；
- Pi Session 只启用 13 个住颜业务工具（含参考风格解析、项目管理、内部中断恢复和安全重试），不启用 `read/bash/edit/write`；
- Provider、视觉模型和图片模型由 Main 从受控设置读取，Renderer 不能提交 Provider ID；图片尺寸、质量和 input fidelity 仍由应用锁定；
- API Key 使用 Electron `safeStorage` 由当前 Windows 用户凭据加密，普通 JSON 只保存服务地址、模型 ID 和加密密文；
- 若 Windows 安全存储不可用，应用拒绝把 API Key 以明文持久化；
- 参考图通过独立能力令牌授权，Renderer 不能提交本地路径；
- 风格灵感模式只把确认后的文字配方交给图片模型；
- 分析和生成仍是两次独立的操作确认：点击解析表示确认参考图可用于本次分析；点击开始生成表示确认参考图可作为 `image[1]` 用于本次生成；界面不再使用额外授权复选框；
- 家具套系分析令牌绑定参考图能力令牌和 SHA-256，不能解析 A 图后替换为 B 图；
- Renderer 只能提交稳定物品 ID、`replace/add` 动作和固定开关，不能提交本地路径或任意家具描述；
- 参考原图不复制进项目；
- 已保存的 API Key 不返回 Renderer，也不写入项目、日志、Pi `auth.json`、Pi `models.json` 或构建产物；
- Provider 设置变更会与所有模型任务互斥，保存后销毁旧 Pi Session 并重建 Runtime；
- 正式打包版未配置 Provider 时仍可查看、下载和管理已有项目，但不能启动 AI 分析或生成。

## 开发运行

首次安装锁定依赖（默认不执行第三方生命周期脚本）：

```powershell
cd <repository>\zhuyan-ai-desktop
npm ci --ignore-scripts
```

需要启动桌面界面时，再安装当前平台的 Electron 二进制：

```powershell
npm rebuild electron
```

离线类型检查与构建：

```powershell
npm run build
```

开发运行：

```powershell
npm run dev
```

开发模式默认读取现有验收项目：

```text
<repository>\workspace\zhuyan-ai-projects
```

正式打包时默认存储到：

```text
app.getPath("userData")\workspace\zhuyan-ai-projects
```

## 0.10.4 内部测试安装包与内容审计

安装打包依赖（首次一次）：

```text
<repository>\scripts\setup-windows-packaging.cmd
```

生成并审计未签名的内部测试安装包：

```text
<repository>\scripts\build-windows-installer.cmd
```

产物：

```text
release/Zhuyan-AI-Setup-0.10.4.exe
release/audit/unpacked-app-audit.json
release/audit/installer-app-audit.json
release/audit/installer-audit.json
```

打包安全边界：

- `electron-builder` 使用显式 `files` 白名单，不打包开发根目录；
- 正式包不读取开发机 `.pi-agent/settings.json`、`models.json` 或 `auth.json`；
- 随包业务 Runtime 每次从空暂存目录重建，只允许软装 Extension 和匿名 `style-recipes.json`；
- Runtime 白名单禁止 JPG、PNG、WebP、GIF、BMP、SVG、PDF、`.env` 和凭据文件；
- `afterPack` 和最终 NSIS 解包审计都会枚举 `app.asar` 内容；
- 对只读内部参考图库递归计算 SHA-256，并与安装包全部图片做精确哈希比对；源图片不移动、不改名、不复制到暂存目录或报告；
- 安装包发现未授权参考图哈希、已知开发凭据、敏感配置文件或开发机路径时，构建直接失败；
- 卸载默认保留 `userData` 中的用户项目和不可变版本。

这是未签名的内部测试包，Windows SmartScreen 可能提示风险；公开分发前仍需代码签名和干净机器验收。

## macOS Apple Silicon（arm64）内部测试包

Mac 目标产物：

```text
release/Zhuyan-AI-0.10.4-mac-arm64.dmg
```

先在 Windows 开发机准备严格白名单构建材料：

```text
<repository>\scripts\prepare-mac-arm64-build-kit.cmd
```

该步骤会对只读内部参考图库生成仅含 SHA-256 的私有审计清单，不保存源路径、不复制图片；随后只复制 Desktop 源码、两个业务 Runtime 源文件和构建脚本到：

```text
<repository>\mac-arm64-build-kit
```

把整个 `mac-arm64-build-kit` 目录复制到 Apple Silicon Mac。在 Mac 安装 Node.js `>=22.19.0`，打开终端进入该目录后执行：

```bash
chmod +x build-zhuyan-mac-arm64.command
./build-zhuyan-mac-arm64.command
```

成功必须出现：

```text
ZHUYAN_MAC_BUILD_KIT_VERIFIED
ZHUYAN_MAC_AD_HOC_CODESIGN_OK
ZHUYAN_AFTER_PACK_AUDIT_OK
ZHUYAN_MAC_DMG_AUDIT_OK
ZHUYAN_MAC_ARM64_REPORTS_OK
ZHUYAN_MAC_ARM64_BUILD_AND_AUDIT_OK
```

并且以下三个报告都必须为 `status=passed`：

```text
release/audit/mac-unpacked-app-audit.json
release/audit/mac-dmg-app-audit.json
release/audit/mac-dmg-audit.json
```

Mac 内部测试包采用 ad-hoc 签名，不是 Apple Developer ID 签名，也未通过 Apple Notarization。朋友首次打开时可能被 Gatekeeper 阻止；在确认 DMG 的 SHA-256 与审计输出一致后，可在 Finder 中按住 Control 点击应用并选择“打开”，或在“系统设置 → 隐私与安全性”中选择仍要打开。不要要求测试者关闭全局 Gatekeeper。

## 0.10.4 视觉分析超时策略

- 参考风格分析最长等待 5 分钟；
- 家具软装套系分析最长等待 6 分钟；
- 购物清单分析最长等待 5 分钟；
- 图片生成继续保持 10 分钟；
- 超时后不自动重试，避免 Provider 仍在后台处理时重复提交和计费；
- 视觉分析直接发送用户选择的 PNG、JPEG 或 WebP 原始字节，不缩放、不重编码、不压缩。

## 0.9.1 Provider 设置与 BYOK

1. 左侧进入“设置”；
2. 输入 OpenAI 兼容 API Base URL、API Key、视觉分析模型和图片生成模型；
3. 可先调用固定的 `GET /models` 测试地址与凭据，测试不生成图片；
4. 保存时 API Key 通过 Windows `safeStorage` 加密，Renderer 后续只看到“已配置”；
5. Main 动态注册内部 `zhuyan-byok-*` Provider，并把 Key 仅注入当前 Pi `ModelRuntime`；
6. 保存或清除配置后重建 Pi Runtime，旧参考图分析令牌失效，但项目、Original、不可变版本和购物清单均不变。

兼容范围与安全提示：

- API Base URL 支持任意主机的 `http://` 或 `https://` 地址；
- 应用不会阻止公网 HTTP，但 HTTP 不提供传输加密，API Key、房间照片、参考照片和请求内容可能被链路上的第三方读取；涉及真实用户数据时仍建议使用可信 HTTPS；
- 第一版不支持任意自定义 Header、OAuth、多 Provider 自动切换或服务端统一额度；
- `/models` 连接成功不能证明 `/images/edits` 一定可用，真实图片能力仍需首次设计验证；
- 开发模式和正式包都不读取用户全局 Pi 的 Provider 凭据；未配置 BYOK 时只能使用项目读取、管理和下载等离线能力。

## 0.8.0 简化设计流程

1. 上传用户自己的房间照片；
2. 上传本人所有或已获授权的参考照片；
3. 点击“确认有权使用并分析参考图”，明确触发一次视觉分析；
4. 查看系统默认采用的家具软装摘要，需要时再展开逐件动作和高级处理；
5. 填写可选补充要求，高级设计边界默认折叠；
6. 点击“生成设计图”，整体参考模式会再次确认参考图可作为 `image[1]` 用于本次生成；
7. 在 V1/V2/V3 中选定满意的成功版本；
8. 点击“选定此设计并生成购物清单”，确认后只为当前版本生成清单。

基础风格配方仍作为内部质量底座保留：参考图分析会自动推荐配方；只有没有参考照片时用户才需要从折叠入口手动选择。

## M3C 操作流程

1. 选择“成套家具软装”；
2. 选择本人所有或已获授权的清晰参考照片；
3. 点击“识别家具软装套系”，该操作同时表示确认参考图可用于本次 AI 分析；
4. 逐件勾选，选择“替换原同类”或“作为新增”；
5. 确认固定设备和冲突元素处理；
6. 点击“开始生成设计”，该操作同时表示确认参考图可作为第二张图片用于本次生成；
7. 生成不可覆盖的 V1；后续普通局部修改基于 V1 创建 V2/V3，不重复发送参考原图。

## 0.8.1 购物清单与搜索流程

1. 打开一个项目并选择成功设计版本；
2. 切换右侧“购物清单”页签；
3. 首次点击“生成购物清单”前确认一次视觉分析费用；
4. 系统对比 Original 与当前成功效果图，生成通用家具软装清单；
5. 编辑采用状态、替换/新增、数量、优先级、颜色、材质、款式、尺寸注意事项、搜索词与备注；
6. 勾选已购买并保存；
7. 保存后默认使用“宽泛”方案，也可切换“精准 / 材质造型”，并在淘宝、京东、1688 或拼多多的固定 HTTPS 入口搜索，也可复制 Main 本地组合的关键词。

- 清单按版本保存，V1、V2、V3 互不混用；
- 读取、编辑、保存、勾选、三类关键词组合、复制关键词和平台搜索均不调用模型；首次生成或明确重新分析会调用一次视觉模型；
- 不识别品牌、型号、价格、精确尺寸或效果图同款商品；
- Original、失败、取消、中断和缺少图片的版本不能生成清单；
- 归档项目只能查看清单，恢复前不能重新分析或保存；
- 清单编辑不会修改效果图、版本元数据或版本树；
- 搜索不接复杂电商 API、不读取电商账号或商品数据，平台页面可能要求用户自行登录；
- Renderer 只能提交条目 ID、固定平台枚举和固定搜索方案枚举，不能提交任意 URL 或搜索词；Main 会重新读取已保存清单并组合关键词。

## 数据与隐私

- 项目、Original、不可变版本、购物清单和恢复日志保存在 Electron 当前用户的 `userData` 目录；
- 参考图分析、购物清单分析和图片生成只在用户明确触发时将相关图片和指令发送给用户配置的 OpenAI 兼容 Provider；
- Provider 的隐私政策、数据保留与费用规则适用于这些请求；应优先使用可信 HTTPS 服务；
- 当前源码不包含住颜 AI 遥测服务器、广告追踪或产品分析 SDK；
- “清除 Provider 设置”只删除服务配置和加密 API Key，不删除项目；归档也不等于删除；
- 当前版本没有应用内永久删除项目功能。彻底退出应用后，用户可手动备份并删除 `app.getPath("userData")` 对应目录以清除全部本机数据；
- 详细英文说明见仓库根目录 `PRIVACY.md`，安全问题请按 `SECURITY.md` 私密报告。

## 仍未完成

- 应用内“清除全部本机数据”入口；
- Windows 安装包正式代码签名（内部未签名测试包已具备构建与审计流程）；
- macOS Developer ID 签名与 Apple Notarization（arm64 内部 ad-hoc 构建流程已准备，尚待真机执行）；
- 完整项目导出；
- 自动更新。

## 0.6.0 项目管理

- 生成成功后只显示“Vx 已生成并保存”，不再残留参考图解析提示；
- 每次点击“新建设计”都会清空上一轮房间图、参考图、解析令牌、逐件动作和冲突选项；
- 结果页显示当前版本的生成模式；新生成的成套家具软装版本还会显示迁移、替换和新增数量；
- 项目可安全重命名、归档和恢复；
- 归档项目仍可预览、对比和下载 Original/历史版本，但恢复前不能生成、修改或重试；
- 归档不移动、不覆盖、不删除项目目录、Original、版本图片或版本元数据。
