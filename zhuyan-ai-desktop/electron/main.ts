import { randomUUID } from "node:crypto";
import { copyFile, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, safeStorage, shell } from "electron";
import { IPC, type CustomStyleSelection, type DesignProject, type DownloadVersionResult, type FurnishingSetSelection, type ProjectSummary, type ProviderConnectionTestInput, type ProviderSettingsInput, type ProviderSettingsView, type ReferenceAnalysisEvent, type ReferenceFurnishingItem, type ReferenceFurnishingSetAnalysis, type ReferenceStyleAnalysis, type ReferenceStyleItem, type RunEvent, type ShoppingItem, type ShoppingKeywordsResult, type ShoppingList, type ShoppingListEvent, type ShoppingSearchMode, type ShoppingSearchPlatform, type ShoppingSearchResult, type StartDesignInput, type StartRevisionInput } from "../shared/contracts.js";
import { PiBusinessRuntime } from "./pi-runtime.js";
import { ProviderSettingsStore, testProviderConnection, type ProviderRuntimeSettings } from "./provider-settings.js";

protocol.registerSchemesAsPrivileged([{
  scheme: "zhuyan-asset",
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

const DEVELOPMENT_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const DEVELOPMENT_PI_CWD = process.env.ZHUYAN_PI_CWD || DEVELOPMENT_ROOT;
const DEVELOPMENT_AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(DEVELOPMENT_ROOT, ".pi-agent");
const RUN_OWNER_ID = `desktop-${randomUUID()}`;
const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
const MAIN_RECIPE_IDS = [
  "warm_white_natural_wood_v1",
  "cream_warm_greige_v1",
  "clean_modern_minimal_v1",
  "modern_mid_century_color_v1",
  "warm_greige_light_luxury_v1",
] as const;

let mainWindow: BrowserWindow | null = null;
let runtime: PiBusinessRuntime;
let providerStore: ProviderSettingsStore;
let configuredProvider: ProviderRuntimeSettings | null = null;
let providerSettingsError: string | null = null;
let providerSettingsMutation = false;
let providerTestController: AbortController | null = null;
const activeRuns = new Map<string, AbortController>();
const selectedRoomImages = new Map<string, string>();
const selectedReferenceImages = new Map<string, string>();
const referenceAnalyses = new Map<string, {
  kind: "style" | "furnishing_set";
  analysis: Omit<ReferenceStyleAnalysis, "token"> | Omit<ReferenceFurnishingSetAnalysis, "token">;
  referenceImageToken: string;
  referenceImageSha256: string;
  providerId: string;
  modelId: string;
  createdAt: number;
}>();
const REFERENCE_ANALYSIS_TTL_MS = 2 * 60 * 60 * 1000;
let referenceAnalysisController: AbortController | null = null;
let shoppingListController: AbortController | null = null;

function workspaceRoot(): string {
  if (process.env.PI_SOFT_FURNISH_WORKSPACE) return path.resolve(process.env.PI_SOFT_FURNISH_WORKSPACE);
  return app.isPackaged
    ? path.join(app.getPath("userData"), "workspace", "zhuyan-ai-projects")
    : path.join(DEVELOPMENT_PI_CWD, "workspace", "zhuyan-ai-projects");
}

function runtimeLayout(): { cwd: string; agentDir: string; bundledExtensionPath?: string } {
  if (!app.isPackaged) {
    return {
      cwd: DEVELOPMENT_PI_CWD,
      agentDir: DEVELOPMENT_AGENT_DIR,
      bundledExtensionPath: path.join(DEVELOPMENT_ROOT, "pi-soft-furnish-agent", "extensions", "soft-furnish.ts"),
    };
  }
  const runtimeRoot = path.join(app.getAppPath(), "packaging", "runtime");
  return {
    cwd: runtimeRoot,
    agentDir: path.join(runtimeRoot, "empty-agent-dir"),
    bundledExtensionPath: path.join(runtimeRoot, "pi-soft-furnish-agent", "extensions", "soft-furnish.ts"),
  };
}

function errorTextWithCause(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      const code = typeof (current as Error & { code?: unknown }).code === "string"
        ? (current as Error & { code: string }).code
        : "";
      const message = current.message.trim();
      const detail = [code, message].filter(Boolean).join(": ");
      if (detail && !parts.includes(detail)) parts.push(detail);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const code = typeof record.code === "string" ? record.code : "";
      const message = typeof record.message === "string" ? record.message.trim() : "";
      const detail = [code, message].filter(Boolean).join(": ");
      if (detail && !parts.includes(detail)) parts.push(detail);
      current = record.cause;
      continue;
    }
    const detail = String(current).trim();
    if (detail && !parts.includes(detail)) parts.push(detail);
    break;
  }
  return parts.join("；原因：") || "未知错误";
}

function safeError(error: unknown, additionalSecrets: Array<string | undefined> = []): string {
  let message = errorTextWithCause(error);
  for (const secret of [configuredProvider?.apiKey, ...additionalSecrets]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s\"']+/gi, "Bearer [REDACTED]")
    .replace(/(api[_ -]?key|authorization)(\s*[:=]\s*)[^\s,;\"']+/gi, "$1$2[REDACTED]")
    .replace(/[A-Za-z]:[\\/][^\r\n；]+/g, "[LOCAL_PATH]")
    .replace(/\/Users\/[^\r\n；]+/g, "[LOCAL_PATH]")
    .slice(0, 1000);
}

function developmentProvider(): ProviderRuntimeSettings | null {
  return app.isPackaged ? null : {
    providerId: "new-provider",
    baseUrl: "",
    apiKey: "",
    visionModel: "gpt-5.6-sol",
    imageModel: "gpt-image-2",
  };
}

function activeProvider(): ProviderRuntimeSettings {
  const provider = configuredProvider || developmentProvider();
  if (!provider) throw new Error("尚未配置 AI Provider，请先打开“设置”填写服务地址、API Key 和模型");
  return provider;
}

function assertRuntimeStable(): void {
  if (providerSettingsMutation) throw new Error("Provider 设置正在保存或清除，请等待完成");
}

function assertNoProviderTest(): void {
  if (providerTestController) throw new Error("Provider 连接正在测试，请等待完成后再启动 AI 任务");
}

function assertProviderSettingsIdle(): void {
  assertRuntimeStable();
  if (runtime?.isBusy()) throw new Error("住颜业务正在读取或更新数据，请等待当前操作完成");
  if (activeRuns.size > 0) throw new Error("设计任务进行中，不能修改或测试 Provider 设置");
  if (referenceAnalysisController) throw new Error("参考图正在分析，请等待完成或先取消解析");
  if (shoppingListController) throw new Error("购物清单正在分析，请等待完成或先取消");
  if (providerTestController) throw new Error("Provider 连接正在测试，请等待完成");
}

async function prepareRuntime(provider: ProviderRuntimeSettings | null): Promise<PiBusinessRuntime> {
  const offlineProvider: ProviderRuntimeSettings | undefined = !provider && app.isPackaged ? {
    providerId: "zhuyan-offline-readonly",
    baseUrl: "http://127.0.0.1/v1",
    apiKey: "offline-no-network",
    visionModel: "zhuyan-offline",
    imageModel: "zhuyan-offline",
  } : undefined;
  const layout = runtimeLayout();
  const nextRuntime = new PiBusinessRuntime(layout.cwd, layout.agentDir, provider || offlineProvider, layout.bundledExtensionPath);
  try {
    await nextRuntime.execute("recover_interrupted_design_runs", {});
    return nextRuntime;
  } catch (error) {
    await nextRuntime.dispose().catch(() => {});
    throw error;
  }
}

async function commitRuntime(nextRuntime: PiBusinessRuntime, provider: ProviderRuntimeSettings | null): Promise<void> {
  const previous = runtime;
  runtime = nextRuntime;
  configuredProvider = provider;
  providerSettingsError = null;
  referenceAnalyses.clear();
  if (previous) await previous.dispose().catch(() => {});
}

async function providerSettingsView(): Promise<ProviderSettingsView> {
  try {
    const view = await providerStore.getView(!app.isPackaged);
    const runtimeMatchesStoredSettings = view.source === "byok"
      ? Boolean(configuredProvider && configuredProvider.baseUrl === view.baseUrl && configuredProvider.visionModel === view.visionModel && configuredProvider.imageModel === view.imageModel)
      : view.source === "development_fallback" && !configuredProvider && !app.isPackaged;
    return {
      ...view,
      runtimeReady: runtimeMatchesStoredSettings && !providerSettingsError,
      error: providerSettingsError,
    };
  } catch (error) {
    return {
      configured: false,
      source: app.isPackaged ? "unconfigured" : "development_fallback",
      baseUrl: null,
      visionModel: app.isPackaged ? "" : "gpt-5.6-sol",
      imageModel: app.isPackaged ? "" : "gpt-image-2",
      hasApiKey: false,
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
      runtimeReady: !app.isPackaged,
      error: safeError(error),
      updatedAt: null,
    };
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("拒绝非住颜窗口的 IPC 请求");
}

function cleanText(value: unknown, label: string, maxLength: number, required = false): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${label}不能为空`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${label}格式错误`);
  const text = value.trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return text || undefined;
}

function cleanProjectId(value: unknown, required = false): string | undefined {
  const projectId = cleanText(value, "项目 ID", 80, required)?.toLowerCase();
  if (projectId && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(projectId)) throw new Error("项目 ID 只能包含字母、数字、下划线和连字符");
  return projectId;
}

function cleanList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw new Error(`${label}最多 30 项`);
  return [...new Set(value.map((item) => cleanText(item, label, 120, true)!))];
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanProjectListFilter(value: unknown): "active" | "archived" | "all" {
  if (value === undefined) return "active";
  if (value === "active" || value === "archived" || value === "all") return value;
  throw new Error("项目筛选格式错误");
}

function cleanProjectAction(value: unknown): "rename" | "archive" | "restore" {
  if (value === "rename" || value === "archive" || value === "restore") return value;
  throw new Error("项目管理动作无效");
}

function cleanVersionId(value: unknown): string {
  const versionId = cleanText(value, "版本 ID", 20, true)!.toLowerCase();
  if (!/^v\d{3,}$/.test(versionId)) throw new Error("版本 ID 格式错误");
  return versionId;
}

function cleanShoppingItem(value: unknown): ShoppingItem {
  if (!value || typeof value !== "object") throw new Error("购物清单条目格式错误");
  const item = value as Partial<ShoppingItem>;
  const id = cleanText(item.id, "购物清单物品 ID", 30, true)!;
  if (!/^shopping-\d{2,}$/.test(id)) throw new Error("购物清单物品 ID 格式错误");
  if (item.action !== "replace" && item.action !== "add") throw new Error(`购物动作无效：${id}`);
  if (item.priority !== "high" && item.priority !== "medium" && item.priority !== "low") throw new Error(`购物优先级无效：${id}`);
  if (!Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 20) throw new Error(`购物数量无效：${id}`);
  if (item.confidence !== "low" && item.confidence !== "medium" && item.confidence !== "high") throw new Error(`购物清单可信度无效：${id}`);
  const searchKeywords = cleanText(item.searchKeywords, "购物搜索词", 200, true)!;
  if (/https?:\/\//i.test(searchKeywords)) throw new Error(`购物搜索词不能包含网址：${id}`);
  return {
    id,
    category: cleanText(item.category, "物品类别", 60, true)!,
    name: cleanText(item.name, "物品名称", 100, true)!,
    action: item.action,
    quantity: Number(item.quantity),
    priority: item.priority,
    color: cleanText(item.color, "颜色", 120) || "",
    material: cleanText(item.material, "材质", 160) || "",
    style: cleanText(item.style, "款式", 160) || "",
    sizeGuidance: cleanText(item.sizeGuidance, "尺寸注意事项", 300) || "",
    searchKeywords,
    notes: cleanText(item.notes, "购物备注", 500) || "",
    included: item.included === true,
    purchased: item.purchased === true,
    confidence: item.confidence,
  };
}

function validateShoppingListSave(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("购物清单格式错误");
  const list = value as Partial<ShoppingList>;
  if (!Number.isInteger(list.revision) || Number(list.revision) < 1) throw new Error("购物清单修订号无效，请重新读取清单");
  if (!Array.isArray(list.items) || list.items.length < 1 || list.items.length > 40) throw new Error("购物清单必须包含 1 至 40 项");
  const items = list.items.map(cleanShoppingItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("购物清单物品 ID 不能重复");
  return {
    projectId: cleanProjectId(list.projectId, true),
    versionId: cleanVersionId(list.versionId),
    expectedRevision: Number(list.revision),
    items,
  };
}

function styleItemText(item: ReferenceStyleItem): string {
  return [item.category, item.description, item.traits.join("、"), item.color || "", item.material || "", item.guidance || ""]
    .map((value) => value.trim()).filter(Boolean).join("：");
}

function compileCustomStyle(selection: CustomStyleSelection): {
  recipeId: string;
  instructions: string;
  context: Record<string, unknown>;
} {
  const token = cleanText(selection.analysisToken, "风格解析令牌", 100, true)!;
  const stored = referenceAnalyses.get(token);
  if (!stored || stored.kind !== "style" || Date.now() - stored.createdAt > REFERENCE_ANALYSIS_TTL_MS) {
    referenceAnalyses.delete(token);
    throw new Error("参考风格解析已失效，请重新分析参考照片");
  }
  const analysis = stored.analysis as Omit<ReferenceStyleAnalysis, "token">;
  const selectedElements = cleanList(selection.selectedTransferableElements, "迁移元素");
  const hasSelectedDirection = selection.usePalette === true
    || selection.useMaterials === true
    || selection.useFurnitureLanguage === true
    || selection.useSoftFurnishings === true
    || selection.useLighting === true
    || selectedElements.length > 0;
  if (!hasSelectedDirection) throw new Error("请至少选择一类要迁移的参考风格元素");
  const availableElements = new Map(analysis.transferableElements.map((item) => [item.category, item]));
  for (const element of selectedElements) if (!availableElements.has(element)) throw new Error(`迁移元素不属于已确认分析：${element}`);
  const sections = [
    `自定义参考风格：${analysis.styleName}。${analysis.styleSummary}`,
    `严格禁止照搬：${analysis.doNotCopy.join("；")}。用户原房间图始终是空间、结构、尺度、视角和布局的唯一事实来源。`,
    selection.usePalette === true ? `配色：${analysis.palette.map((item) => `${item.name}${item.ratioPercent ? `约${item.ratioPercent}%` : ""}${item.role ? `用于${item.role}` : ""}`).join("；")}。` : "",
    selection.useMaterials === true ? `材质：${analysis.materials.map(styleItemText).join("；")}。` : "",
    selection.useFurnitureLanguage === true ? `家具语言：${analysis.furnitureLanguage.join("；")}。家具只迁移抽象造型、色彩、材质和视觉重量，不复制具体产品。` : "",
    selection.useSoftFurnishings === true ? `软装：${analysis.softFurnishings.map(styleItemText).join("；")}。装饰密度：${analysis.decorationDensity}。` : "",
    selection.useLighting === true ? `照明氛围：${analysis.lighting.map(styleItemText).join("；")}。不得据此修改原房间固定灯位、吊顶或线路。` : "",
    selectedElements.length > 0 ? `用户确认迁移：${selectedElements.map((name) => styleItemText(availableElements.get(name)!)).join("；")}。` : "",
  ].filter(Boolean);
  const instructions = sections.join(" ").slice(0, 3000);
  if (instructions.length < 80) throw new Error("请至少选择一类要迁移的参考风格元素");
  return {
    recipeId: analysis.recommendedBaseRecipeId,
    instructions,
    context: {
      mode: "extracted_text_recipe",
      styleName: analysis.styleName,
      referenceImageSha256: stored.referenceImageSha256,
      analysisProvider: stored.providerId,
      analysisModel: stored.modelId,
      rightsConfirmed: true,
    },
  };
}

function furnishingItemText(item: ReferenceFurnishingItem): string {
  const artworkRule = item.artworkLike ? "仅生成不相同的通用近似图形，不复制原作品、文字或Logo" : "";
  return [
    `${item.name}（${item.category}）`,
    item.visualDescription,
    item.silhouette ? `轮廓：${item.silhouette}` : "",
    item.color ? `颜色：${item.color}` : "",
    item.material ? `材质：${item.material}` : "",
    item.relativePosition ? `参考组合位置：${item.relativePosition}` : "",
    item.groupRelationship ? `搭配关系：${item.groupRelationship}` : "",
    item.transferGuidance ? `迁移要求：${item.transferGuidance}` : "",
    artworkRule,
  ].filter(Boolean).join("；");
}

function compileFurnishingSet(selection: FurnishingSetSelection): {
  recipeId: string;
  instructions: string;
  context: Record<string, unknown>;
  referenceImage: string;
} {
  const token = cleanText(selection.analysisToken, "家具套系解析令牌", 100, true)!;
  const referenceImageToken = cleanText(selection.referenceImageToken, "参考图片令牌", 100, true)!;
  if (selection.rightsConfirmedForGeneration !== true) throw new Error("请再次确认参考图片可用于 AI 家具软装生成");
  if (selection.keepAirConditioner !== true || selection.keepFloor !== true || selection.keepCeilingArchitecture !== true) {
    throw new Error("成套家具软装模式必须确认保留空调、原地面和吊顶建筑结构");
  }
  const stored = referenceAnalyses.get(token);
  if (!stored || stored.kind !== "furnishing_set" || Date.now() - stored.createdAt > REFERENCE_ANALYSIS_TTL_MS) {
    referenceAnalyses.delete(token);
    throw new Error("家具软装套系解析已失效，请重新分析参考照片");
  }
  if (stored.referenceImageToken !== referenceImageToken) throw new Error("参考图片与家具套系解析结果不匹配，请重新分析");
  const referenceImage = selectedReferenceImages.get(referenceImageToken);
  if (!referenceImage) throw new Error("参考图片授权已失效，请重新选择照片");
  const analysis = stored.analysis as Omit<ReferenceFurnishingSetAnalysis, "token">;
  if (!Array.isArray(selection.selectedItems)) throw new Error("家具软装物品选择格式错误");
  if (selection.selectedItems.length === 0) throw new Error("请至少选择一件要复制的家具或软装");
  if (selection.selectedItems.length > 10) throw new Error("首版成套复制一次最多选择 10 件家具软装，请取消次要物品后重试");
  const normalizedSelections = selection.selectedItems.map((value) => {
    if (!value || typeof value !== "object") throw new Error("家具软装物品选择格式错误");
    const itemId = cleanText(value.itemId, "家具软装物品 ID", 100, true)!;
    if (value.action !== "replace" && value.action !== "add") throw new Error(`家具软装物品动作无效：${itemId}`);
    return { itemId, action: value.action };
  });
  if (new Set(normalizedSelections.map((item) => item.itemId)).size !== normalizedSelections.length) throw new Error("家具软装物品不能重复选择");
  const available = new Map(analysis.items.map((item) => [item.id, item]));
  for (const selected of normalizedSelections) if (!available.has(selected.itemId)) throw new Error(`家具软装物品不属于已确认分析：${selected.itemId}`);
  const selectedItems = normalizedSelections.map((selected) => ({ ...selected, item: available.get(selected.itemId)! }));
  const allowWallArt = selection.allowGenericWallArt === true;
  if (!allowWallArt && selectedItems.some(({ item }) => /(画|墙饰|wall\s*art|painting|artwork)/i.test(item.category))) {
    throw new Error("选择墙面装饰前必须允许新增通用墙画");
  }
  const actions = selectedItems.map(({ item, action }) => action === "replace"
    ? `采用参考图中的${furnishingItemText(item).slice(0, 380)}；替换原房间中的${item.replacementTarget || item.category}，移除被替换的冲突同类物品，但保留未选物品。`
    : `采用参考图中的${furnishingItemText(item).slice(0, 380)}；作为新增物品按参考组合关系合理放置，保留原房间已有同类物品并避免阻塞动线。`);
  const fixedChanges = [
    selection.replaceCeilingLight === true ? "移除原有装饰性主吊灯，改为简洁低存在感吸顶灯；不得改变吊顶建筑边界和原灯位。" : "保留原顶灯及原灯位。",
    selection.removeWallSconces === true ? "移除原有装饰壁灯，但不得改变墙体或其他固定电气位置。" : "保留原有壁灯。",
    selection.allowWallColorChange === true ? "允许将墙面颜色调整为与所选家具套系协调的低饱和中性色，但保留墙面和石膏线结构。" : "保持原墙面颜色和结构。",
    allowWallArt ? "允许新增通用、无品牌、与参考作品不相同的抽象墙画。" : "不得新增墙画或复制参考图艺术品。",
  ];
  const keep = [
    selection.keepAirConditioner === true ? "必须保留原房间空调及其位置、形态和可见性。" : "只有用户明确选择的家具软装可以替换，不得擅自删除固定设备。",
    selection.keepFloor === true ? "必须保留原地面材料、颜色、边界和铺贴方向。" : "不得从参考图推断或复制地面，除非允许修改项明确要求。",
    selection.keepCeilingArchitecture === true ? "必须保留原吊顶、石膏线、层高和天花边界；只可按确认选项替换灯具。" : "不得照搬参考图天花结构。",
    "必须保留原房间门窗、阳台、栏杆、城市景观、相机视角、透视、电视区与会客区关系以及实际通行动线。",
  ];
  const safetyBoundary = [
    `成套家具软装：${analysis.setName}。${analysis.setSummary.slice(0, 400)}`,
    `套系配色关系：${analysis.palette.map((item) => `${item.name}${item.ratioPercent ? `约${item.ratioPercent}%` : ""}${item.role ? `用于${item.role}` : ""}`).join("；").slice(0, 500)}。`,
    "以下为用户逐件确认的高优先级视觉规格；参考图只决定这些物品的轮廓、比例、颜色、材质和组合关系，原房间图决定所有空间事实。",
    ...keep,
    `禁止复制：${analysis.doNotCopy.join("；").slice(0, 500)}。不得识别或声称品牌、型号和精确尺寸；不得复制人物、文字、Logo、商品包装、具体艺术作品或高识别度设计师家具。`,
    ...fixedChanges,
  ].join(" ");
  const actionBudget = Math.max(1200, 6000 - safetyBoundary.length - 130);
  const perItemBudget = Math.max(180, Math.floor(actionBudget / actions.length));
  const selectedActions = actions.map((action) => `${action.slice(0, Math.max(1, perItemBudget - 1))}。`).join(" ");
  const instructions = [
    safetyBoundary,
    selectedActions,
    "整体输出应形成统一、真实、可居住的家具软装组合，柔和自然光，写实家居摄影质感，不要豪宅样板间化。",
  ].join(" ").slice(0, 6000);
  return {
    recipeId: analysis.recommendedBaseRecipeId,
    instructions,
    context: {
      mode: "reference_furnishing_set",
      styleName: analysis.setName,
      referenceImageSha256: stored.referenceImageSha256,
      analysisProvider: stored.providerId,
      analysisModel: stored.modelId,
      rightsConfirmed: true,
      selectedItemCount: selectedItems.length,
      selectedReplaceCount: selectedItems.filter(({ action }) => action === "replace").length,
      selectedAddCount: selectedItems.filter(({ action }) => action === "add").length,
    },
    referenceImage,
  };
}

function validateDesignInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("设计参数格式错误");
  const input = value as Partial<StartDesignInput>;
  const sourceImageToken = cleanText(input.sourceImageToken, "房间图片令牌", 100, true)!;
  const sourceImage = selectedRoomImages.get(sourceImageToken);
  if (!sourceImage) throw new Error("房间图片授权已失效，请重新选择照片");
  let recipeId = cleanText(input.recipeId, "风格配方", 100, true)!;
  if (!MAIN_RECIPE_IDS.includes(recipeId as typeof MAIN_RECIPE_IDS[number])) throw new Error("不允许使用该主风格配方");
  let customStyleInstructions: string | undefined;
  let customStyleContext: Record<string, unknown> | undefined;
  let visualReferenceImage: string | undefined;
  let visualReferenceMode: "furnishing_set" | undefined;
  let furnishingSetAllowWallArt = false;
  if (input.customStyle !== undefined && input.furnishingSet !== undefined) throw new Error("风格灵感和成套家具软装不能在同一次任务中同时启用");
  if (input.customStyle !== undefined) {
    if (!input.customStyle || typeof input.customStyle !== "object") throw new Error("自定义风格选择格式错误");
    const compiled = compileCustomStyle(input.customStyle);
    recipeId = compiled.recipeId;
    customStyleInstructions = compiled.instructions;
    customStyleContext = compiled.context;
  }
  if (input.furnishingSet !== undefined) {
    if (!input.furnishingSet || typeof input.furnishingSet !== "object") throw new Error("家具软装套系选择格式错误");
    const compiled = compileFurnishingSet(input.furnishingSet);
    recipeId = compiled.recipeId;
    customStyleInstructions = compiled.instructions;
    customStyleContext = compiled.context;
    visualReferenceImage = compiled.referenceImage;
    visualReferenceMode = "furnishing_set";
    furnishingSetAllowWallArt = input.furnishingSet.allowGenericWallArt === true;
  }
  const keepItems = cleanList(input.keepItems, "保留项");
  const allowedChanges = cleanList(input.allowedChanges, "允许修改项");
  const forbiddenChanges = cleanList(input.forbiddenChanges, "禁止项");
  return {
    sourceImage,
    recipeId,
    projectId: cleanProjectId(input.projectId),
    projectTitle: cleanText(input.projectTitle, "项目名称", 120),
    userInstructions: cleanText(input.userInstructions, "补充要求", 4000),
    customStyleInstructions,
    customStyleContext,
    visualReferenceImage,
    visualReferenceRightsConfirmed: visualReferenceImage ? true : undefined,
    visualReferenceMode,
    keepItems: visualReferenceMode === "furnishing_set"
      ? keepItems.filter((item) => !/大型家具.*(轮廓|形态)|家具.*不得替换/.test(item))
      : keepItems,
    allowedChanges: visualReferenceMode === "furnishing_set"
      ? [...new Set([
          ...allowedChanges,
          "用户逐件确认的参考家具与软装可按 replace 或 add 动作替换同类现有物品或合理新增",
          ...(input.furnishingSet?.replaceCeilingLight === true ? ["按用户确认替换原主吊灯为简约吸顶灯"] : []),
          ...(input.furnishingSet?.removeWallSconces === true ? ["按用户确认移除装饰壁灯"] : []),
          ...(input.furnishingSet?.allowWallColorChange === true ? ["按用户确认调整墙面颜色但不改变墙体结构"] : []),
          ...(input.furnishingSet?.allowGenericWallArt === true ? ["按用户确认新增不相同的通用墙画"] : []),
        ])]
      : allowedChanges,
    forbiddenChanges: visualReferenceMode === "furnishing_set"
      ? [
          ...forbiddenChanges.filter((item) => {
            if (/大型家具.*(占地|轮廓|形态)|家具.*不得替换/.test(item)) return false;
            if ((input.furnishingSet?.replaceCeilingLight === true || input.furnishingSet?.removeWallSconces === true) && item === "固定设备") return false;
            return true;
          }),
          ...(input.furnishingSet?.replaceCeilingLight === true || input.furnishingSet?.removeWallSconces === true
            ? ["除用户确认的顶灯或壁灯动作外，其他固定设备不得修改"]
            : []),
        ]
      : forbiddenChanges,
    rentalFriendly: visualReferenceMode === "furnishing_set" ? false : cleanBoolean(input.rentalFriendly, false),
    allowWallArt: visualReferenceMode === "furnishing_set" ? furnishingSetAllowWallArt : cleanBoolean(input.allowWallArt, false),
    provider: activeProvider().providerId,
    model: activeProvider().imageModel,
    size: "1536x1024",
    quality: "low",
  };
}

function validateRevisionInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("修改参数格式错误");
  const input = value as Partial<StartRevisionInput>;
  const result: Record<string, unknown> = {
    projectId: cleanProjectId(input.projectId, true),
    baseVersionId: cleanText(input.baseVersionId, "基础版本", 20),
    revisionInstructions: cleanText(input.revisionInstructions, "修改要求", 4000, true),
    provider: activeProvider().providerId,
    model: activeProvider().imageModel,
    size: "1536x1024",
    quality: "low",
  };
  if (input.keepItems !== undefined) result.keepItems = cleanList(input.keepItems, "保留项");
  if (input.allowedChanges !== undefined) result.allowedChanges = cleanList(input.allowedChanges, "允许修改项");
  if (input.forbiddenChanges !== undefined) result.forbiddenChanges = cleanList(input.forbiddenChanges, "禁止项");
  if (input.rentalFriendly !== undefined) result.rentalFriendly = cleanBoolean(input.rentalFriendly, false);
  if (input.allowWallArt !== undefined) result.allowWallArt = cleanBoolean(input.allowWallArt, false);
  return result;
}

class AssetRegistry {
  private readonly byToken = new Map<string, { path: string; mime: string }>();
  private readonly byPath = new Map<string, string>();

  constructor(private readonly root: string) {}

  private add(resolvedFile: string): string {
    let token = this.byPath.get(resolvedFile);
    if (!token) {
      token = randomUUID();
      const extension = path.extname(resolvedFile).toLowerCase();
      const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
      this.byPath.set(resolvedFile, token);
      this.byToken.set(token, { path: resolvedFile, mime });
    }
    return `zhuyan-asset://asset/${token}`;
  }

  async register(filePath: unknown): Promise<string | null> {
    if (typeof filePath !== "string") return null;
    const resolvedRoot = await realpath(this.root).catch(() => path.resolve(this.root));
    const resolvedFile = await realpath(filePath);
    const relative = path.relative(resolvedRoot, resolvedFile);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("项目图片超出业务工作目录");
    return this.add(resolvedFile);
  }

  async registerSelected(filePath: string): Promise<string> {
    return this.add(await realpath(filePath));
  }

  async response(requestUrl: string): Promise<Response> {
    const url = new URL(requestUrl);
    const token = url.pathname.replace(/^\//, "");
    const asset = this.byToken.get(token);
    if (!asset) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(await readFile(asset.path)), {
      status: 200,
      headers: {
        "Content-Type": asset.mime,
        "Cache-Control": "private, max-age=300",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  }
}

let assets: AssetRegistry;

async function presentProject(raw: Record<string, unknown>): Promise<DesignProject> {
  const source = raw.source as Record<string, unknown>;
  const versions = raw.versions as Array<Record<string, unknown>>;
  const { imagePath: _sourcePath, ...safeSource } = source;
  const safeVersions = await Promise.all(versions.map(async (version) => {
    const { imagePath: _versionPath, ...safeVersion } = version;
    return { ...safeVersion, imageUrl: await assets.register(version.imagePath) };
  }));
  return {
    ...(raw as unknown as Omit<DesignProject, "source" | "versions">),
    source: { ...safeSource, imageUrl: await assets.register(source.imagePath) } as DesignProject["source"],
    versions: safeVersions as DesignProject["versions"],
  };
}

async function listProjects(limit = 50, filter: unknown = "active"): Promise<ProjectSummary[]> {
  assertRuntimeStable();
  const safeLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
  const safeFilter = cleanProjectListFilter(filter);
  const result = await runtime.execute("list_design_projects", { limit: safeLimit, filter: safeFilter });
  const projects = result.details.projects as Array<Record<string, unknown>>;
  return Promise.all(projects.map(async (project) => {
    const { sourceImagePath: _sourcePath, latestImagePath: _latestPath, ...safeProject } = project;
    return {
      ...safeProject,
      sourceImageUrl: await assets.register(project.sourceImagePath),
      latestImageUrl: await assets.register(project.latestImagePath),
    };
  })) as Promise<ProjectSummary[]>;
}

async function getRawProject(projectId: string): Promise<Record<string, unknown>> {
  assertRuntimeStable();
  const id = cleanProjectId(projectId, true)!;
  const result = await runtime.execute("get_design_project", { projectId: id });
  return result.details.project as Record<string, unknown>;
}

async function getProject(projectId: string): Promise<DesignProject> {
  return presentProject(await getRawProject(projectId));
}

async function manageProject(projectIdValue: unknown, actionValue: unknown, titleValue?: unknown): Promise<Record<string, unknown>> {
  assertRuntimeStable();
  if (activeRuns.size > 0) throw new Error("设计任务进行中，不能管理项目");
  if (referenceAnalysisController) throw new Error("参考图正在分析，请等待完成或先取消解析");
  if (shoppingListController) throw new Error("购物清单正在分析，请等待完成或先取消");
  const projectId = cleanProjectId(projectIdValue, true)!;
  const action = cleanProjectAction(actionValue);
  const title = action === "rename" ? cleanText(titleValue, "项目名称", 120, true) : undefined;
  const result = await runtime.execute("manage_design_project", { projectId, action, title });
  return result.details as Record<string, unknown>;
}

async function generateShoppingList(projectIdValue: unknown, versionIdValue: unknown, replaceExistingValue: unknown): Promise<ShoppingList> {
  assertRuntimeStable();
  assertNoProviderTest();
  if (activeRuns.size > 0) throw new Error("设计任务进行中，不能分析购物清单");
  if (referenceAnalysisController) throw new Error("参考图正在分析，请等待完成或先取消解析");
  if (shoppingListController) throw new Error("已有购物清单正在分析，请等待完成");
  const projectId = cleanProjectId(projectIdValue, true)!;
  const versionId = cleanVersionId(versionIdValue);
  const raw = await getRawProject(projectId);
  if (raw.isArchived === true) throw new Error("项目已归档，请先恢复项目再生成购物清单");
  const version = (raw.versions as Array<Record<string, unknown>>).find((item) => item.versionId === versionId);
  if (!version || version.status !== "completed" || typeof version.imagePath !== "string") throw new Error("只有已完成且存在图片的设计版本可以生成购物清单");
  const controller = new AbortController();
  shoppingListController = controller;
  emitShoppingList({ type: "started", stage: "validating_shopping_list", message: "正在验证项目和成功设计版本……", projectId, versionId });
  try {
    const provider = activeProvider();
    const result = await runtime.execute("extract_furnishing_items", {
      projectId,
      versionId,
      provider: provider.providerId,
      model: provider.visionModel,
      replaceExisting: replaceExistingValue === true,
    }, controller.signal, (update) => {
      const progress = progressMessage(update);
      const stage = progress.stage === "shopping_list_completed"
        ? "shopping_list_completed"
        : progress.stage === "analyzing_shopping_list"
          ? "analyzing_shopping_list"
          : "validating_shopping_list";
      emitShoppingList({ type: "progress", stage, message: progress.message || "正在分析购物清单……", projectId, versionId });
    });
    const list = result.details.shoppingList;
    if (!list || typeof list !== "object") throw new Error("购物清单结果格式错误");
    emitShoppingList({ type: "completed", stage: "shopping_list_completed", message: "购物清单已生成并保存。", projectId, versionId });
    return list as ShoppingList;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const message = cancelled ? "购物清单分析已取消" : safeError(error);
    emitShoppingList({ type: cancelled ? "cancelled" : "failed", stage: cancelled ? "cancelled" : "failed", message, projectId, versionId });
    throw new Error(message);
  } finally {
    if (shoppingListController === controller) shoppingListController = null;
  }
}

async function getShoppingList(projectIdValue: unknown, versionIdValue: unknown): Promise<ShoppingList | null> {
  assertRuntimeStable();
  const projectId = cleanProjectId(projectIdValue, true)!;
  const versionId = cleanVersionId(versionIdValue);
  const result = await runtime.execute("get_furnishing_list", { projectId, versionId });
  const list = result.details.shoppingList;
  if (list !== null && (typeof list !== "object" || Array.isArray(list))) throw new Error("购物清单结果格式错误");
  return list as ShoppingList | null;
}

async function saveShoppingList(value: unknown): Promise<ShoppingList> {
  assertRuntimeStable();
  if (activeRuns.size > 0) throw new Error("设计任务进行中，不能保存购物清单");
  if (referenceAnalysisController || shoppingListController) throw new Error("视觉分析进行中，不能保存购物清单");
  const params = validateShoppingListSave(value);
  const result = await runtime.execute("save_furnishing_list", params);
  const list = result.details.shoppingList;
  if (!list || typeof list !== "object") throw new Error("保存后的购物清单格式错误");
  return list as ShoppingList;
}

const SHOPPING_CATEGORY_SYNONYMS: Array<[RegExp, string[]]> = [
  [/茶几/, ["茶几", "客厅茶几", "小户型茶几"]],
  [/边几|角几/, ["边几", "沙发边几", "角几"]],
  [/沙发/, ["沙发", "客厅沙发", "布艺沙发"]],
  [/地毯/, ["地毯", "客厅地毯", "短绒地毯"]],
  [/落地灯|立灯/, ["落地灯", "客厅落地灯", "沙发旁立灯"]],
  [/台灯/, ["台灯", "装饰台灯", "床头台灯"]],
  [/电视柜/, ["电视柜", "客厅电视柜", "落地电视柜"]],
  [/窗帘/, ["窗帘", "客厅窗帘", "遮光窗帘"]],
  [/抱枕|靠枕/, ["抱枕", "沙发抱枕", "靠垫套"]],
  [/绿植|植物/, ["室内绿植", "客厅绿植", "仿真绿植"]],
  [/花盆/, ["花盆", "落地花盆", "室内装饰花盆"]],
  [/餐桌/, ["餐桌", "家用餐桌", "小户型餐桌"]],
  [/餐椅/, ["餐椅", "家用餐椅", "靠背餐椅"]],
  [/单椅|休闲椅/, ["休闲椅", "客厅单椅", "沙发椅"]],
  [/床头柜/, ["床头柜", "卧室床头柜", "小型边柜"]],
  [/床(?!头)/, ["床", "卧室床", "软包床"]],
  [/收纳柜|储物柜|边柜/, ["收纳柜", "储物柜", "客厅边柜"]],
  [/墙画|装饰画|挂画/, ["装饰画", "客厅挂画", "抽象墙画"]],
];

function cleanShoppingSearchPart(value: string, maximum = 36): string {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[，,。；;：:、|\/\\()\[\]{}<>“”‘’"']/g, " ")
    .replace(/(?:品牌|型号|同款|链接|购买前|需要|建议|注意|通用|类似|接近|视觉上|高相似度|软装方向|材质观感|观感|未确定|未知|不确定)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum)
    .trim();
}

function joinShoppingSearchParts(parts: string[], maximum = 100): string {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const part = cleanShoppingSearchPart(raw);
    if (!part || seen.has(part)) continue;
    seen.add(part);
    const candidate = [...result, part].join(" ");
    if (candidate.length > maximum) continue;
    result.push(part);
  }
  return result.join(" ");
}

function shoppingCategoryTerms(item: ShoppingItem): string[] {
  const source = `${item.category} ${item.name}`;
  return SHOPPING_CATEGORY_SYNONYMS.find(([pattern]) => pattern.test(source))?.[1]
    || [cleanShoppingSearchPart(item.category || item.name, 24)];
}

function buildShoppingKeywords(item: ShoppingItem, mode: ShoppingSearchMode): string {
  const categoryTerms = shoppingCategoryTerms(item);
  const baseKeywords = cleanShoppingSearchPart(item.searchKeywords, 100);
  const keywords = mode === "precise"
    ? joinShoppingSearchParts([categoryTerms[0], item.color, item.material, item.style, item.name, baseKeywords])
    : mode === "broad"
      ? joinShoppingSearchParts([categoryTerms[1] || categoryTerms[0], item.style, item.name, ...categoryTerms])
      : joinShoppingSearchParts([categoryTerms[0], item.material, item.color, item.style, item.name]);
  if (!keywords) throw new Error("该物品没有可用的购物搜索词");
  return keywords;
}

function cleanShoppingSearchMode(value: unknown): ShoppingSearchMode {
  if (value === "precise" || value === "broad" || value === "material") return value;
  throw new Error("购物搜索方案无效");
}

function cleanShoppingSearchPlatform(value: unknown): ShoppingSearchPlatform {
  if (value === "taobao" || value === "jd" || value === "1688" || value === "pdd") return value;
  throw new Error("购物搜索平台无效");
}

async function savedShoppingSearchItem(projectIdValue: unknown, versionIdValue: unknown, itemIdValue: unknown): Promise<{ projectId: string; versionId: string; item: ShoppingItem }> {
  const projectId = cleanProjectId(projectIdValue, true)!;
  const versionId = cleanVersionId(versionIdValue);
  const itemId = cleanText(itemIdValue, "购物清单物品 ID", 30, true)!;
  if (!/^shopping-\d{2,}$/.test(itemId)) throw new Error("购物清单物品 ID 格式错误");
  const list = await getShoppingList(projectId, versionId);
  if (!list) throw new Error("该版本还没有购物清单");
  const item = list.items.find((candidate) => candidate.id === itemId);
  if (!item || item.included !== true) throw new Error("找不到可搜索的购物清单物品");
  return { projectId, versionId, item };
}

let gb18030TwoByteMap: Map<string, [number, number]> | null = null;

function getGb18030TwoByteMap(): Map<string, [number, number]> {
  if (gb18030TwoByteMap) return gb18030TwoByteMap;
  const decoder = new TextDecoder("gb18030", { fatal: true });
  const result = new Map<string, [number, number]>();
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      if (trail === 0x7f) continue;
      try {
        const character = decoder.decode(Uint8Array.of(lead, trail));
        if (character !== "�" && Array.from(character).length === 1 && !result.has(character)) {
          result.set(character, [lead, trail]);
        }
      } catch {
        // Invalid GB18030 byte pair; skip it.
      }
    }
  }
  gb18030TwoByteMap = result;
  return result;
}

function percentEncodeGb18030(value: string): string {
  const twoByteMap = getGb18030TwoByteMap();
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }
    const pair = twoByteMap.get(character);
    if (pair) bytes.push(...pair);
    else bytes.push(0x20);
  }
  return bytes.map((byte) => {
    const character = String.fromCharCode(byte);
    return /[A-Za-z0-9._~-]/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

function shoppingSearchUrl(platform: ShoppingSearchPlatform, keywords: string): URL {
  if (platform === "1688") {
    const encodedKeywords = percentEncodeGb18030(keywords);
    return new URL(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodedKeywords}`);
  }
  const configuration: Record<Exclude<ShoppingSearchPlatform, "1688">, { base: string; parameter: string }> = {
    taobao: { base: "https://s.taobao.com/search", parameter: "q" },
    jd: { base: "https://search.jd.com/Search", parameter: "keyword" },
    pdd: { base: "https://mobile.yangkeduo.com/search_result.html", parameter: "search_key" },
  };
  const selected = configuration[platform];
  const url = new URL(selected.base);
  url.searchParams.set(selected.parameter, keywords);
  return url;
}

async function openShoppingSearch(projectIdValue: unknown, versionIdValue: unknown, itemIdValue: unknown, platformValue: unknown, modeValue: unknown): Promise<ShoppingSearchResult> {
  const platform = cleanShoppingSearchPlatform(platformValue);
  const mode = cleanShoppingSearchMode(modeValue);
  const { item } = await savedShoppingSearchItem(projectIdValue, versionIdValue, itemIdValue);
  const keywords = buildShoppingKeywords(item, mode);
  await shell.openExternal(shoppingSearchUrl(platform, keywords).toString(), { activate: true });
  return { platform, mode, keywords };
}

async function copyShoppingKeywords(projectIdValue: unknown, versionIdValue: unknown, itemIdValue: unknown, modeValue: unknown): Promise<ShoppingKeywordsResult> {
  const mode = cleanShoppingSearchMode(modeValue);
  const { item } = await savedShoppingSearchItem(projectIdValue, versionIdValue, itemIdValue);
  const keywords = buildShoppingKeywords(item, mode);
  clipboard.writeText(keywords);
  return { mode, keywords };
}

async function assertBusinessImage(filePath: unknown): Promise<string> {
  if (typeof filePath !== "string") throw new Error("当前版本没有可下载图片");
  const resolvedRoot = await realpath(workspaceRoot());
  const resolvedFile = await realpath(filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("下载文件超出业务工作目录");
  const extension = path.extname(resolvedFile).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) throw new Error("当前版本不是支持的图片格式");
  return resolvedFile;
}

async function downloadVersion(projectIdValue: unknown, versionIdValue: unknown): Promise<DownloadVersionResult> {
  const projectId = cleanProjectId(projectIdValue, true)!;
  const versionId = cleanText(versionIdValue, "版本 ID", 20, true)!.toLowerCase();
  const raw = await getRawProject(projectId);
  let imagePath: unknown;
  if (versionId === "original") {
    imagePath = (raw.source as Record<string, unknown>)?.imagePath;
  } else {
    if (!/^v\d{3,}$/.test(versionId)) throw new Error("版本 ID 格式错误");
    const version = (raw.versions as Array<Record<string, unknown>>).find((item) => item.versionId === versionId);
    if (!version) throw new Error("找不到要下载的版本");
    if (version.status !== "completed") throw new Error("只有已完成版本可以下载");
    imagePath = version.imagePath;
  }
  const source = await assertBusinessImage(imagePath);
  const extension = path.extname(source).toLowerCase() === ".jpeg" ? ".jpg" : path.extname(source).toLowerCase();
  const fileName = `${projectId}-${versionId}${extension}`;
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: versionId === "original" ? "下载原始房间照片" : `下载 ${versionId.toUpperCase()} 设计图`,
    defaultPath: path.join(app.getPath("downloads"), fileName),
    filters: [{ name: "图片", extensions: [extension.replace(/^\./, "")] }],
  });
  if (result.canceled || !result.filePath) return { status: "cancelled" };
  const resolvedRoot = await realpath(workspaceRoot());
  const destination = path.resolve(result.filePath);
  const destinationRelative = path.relative(resolvedRoot, destination);
  if (!destinationRelative.startsWith("..") && !path.isAbsolute(destinationRelative)) {
    throw new Error("不能把下载文件保存到住颜项目工作目录，请选择下载文件夹或其他位置");
  }
  await copyFile(source, destination);
  return { status: "saved", fileName: path.basename(destination) };
}

function emit(event: RunEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.runEvent, event);
}

function emitReferenceAnalysis(event: ReferenceAnalysisEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.referenceAnalysisEvent, event);
}

function emitShoppingList(event: ShoppingListEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.shoppingListEvent, event);
}

function progressMessage(update: { content?: Array<{ text?: string }>; details?: Record<string, unknown> }): { stage?: string; message?: string } {
  const stage = typeof update.details?.stage === "string" ? update.details.stage : undefined;
  const message = update.content?.find((item) => typeof item.text === "string")?.text;
  return { stage, message };
}

function startRun(tool: "redesign_room" | "revise_room_design" | "retry_room_design", params: Record<string, unknown>): { runId: string } {
  assertRuntimeStable();
  assertNoProviderTest();
  if (referenceAnalysisController) throw new Error("参考风格正在分析，请等待完成或先取消解析");
  if (shoppingListController) throw new Error("购物清单正在分析，请等待完成或先取消");
  if (activeRuns.size > 0) throw new Error("已有设计任务正在运行，请等待完成或先取消当前任务");
  const runId = randomUUID();
  const controller = new AbortController();
  let runProjectId = typeof params.projectId === "string" ? params.projectId : undefined;
  let runVersionId: string | undefined;
  activeRuns.set(runId, controller);
  emit({ runId, type: "started", stage: "starting", message: "正在启动住颜 AI 工具……", projectId: runProjectId });
  void runtime.execute(tool, params, controller.signal, (update) => {
    if (typeof update.details?.projectId === "string") runProjectId = update.details.projectId;
    if (typeof update.details?.versionId === "string") runVersionId = update.details.versionId;
    emit({ runId, type: "progress", ...progressMessage(update), projectId: runProjectId, versionId: runVersionId });
  }).then(async (result) => {
    const projectId = String(result.details.projectId || runProjectId || "");
    const project = await getProject(projectId);
    emit({
      runId,
      type: "completed",
      stage: "completed",
      message: "设计版本已保存",
      projectId,
      versionId: typeof result.details.versionId === "string" ? result.details.versionId : runVersionId,
      project,
    });
  }).catch(async (error) => {
    let project: DesignProject | undefined;
    if (runProjectId) project = await getProject(runProjectId).catch(() => undefined);
    emit({
      runId,
      type: controller.signal.aborted ? "cancelled" : "failed",
      stage: controller.signal.aborted ? "cancelled" : "failed",
      message: controller.signal.aborted ? "生成已取消" : safeError(error),
      projectId: runProjectId,
      versionId: runVersionId,
      project,
    });
  }).finally(() => activeRuns.delete(runId));
  return { runId };
}

function registerIpc(): void {
  ipcMain.handle(IPC.getProviderSettings, async (event) => {
    assertTrustedSender(event);
    return providerSettingsView();
  });
  ipcMain.handle(IPC.testProviderSettings, async (event, input: ProviderConnectionTestInput) => {
    assertTrustedSender(event);
    assertProviderSettingsIdle();
    let candidate: ProviderRuntimeSettings | undefined;
    const controller = new AbortController();
    providerTestController = controller;
    try {
      candidate = await providerStore.resolveInput(input);
      return await testProviderConnection(candidate, controller.signal);
    } catch (error) {
      throw new Error(safeError(error, [candidate?.apiKey]));
    } finally {
      if (providerTestController === controller) providerTestController = null;
    }
  });
  ipcMain.handle(IPC.saveProviderSettings, async (event, input: ProviderSettingsInput) => {
    assertTrustedSender(event);
    assertProviderSettingsIdle();
    providerSettingsMutation = true;
    let candidate: ProviderRuntimeSettings | undefined;
    let nextRuntime: PiBusinessRuntime | undefined;
    try {
      candidate = await providerStore.resolveInput(input);
      nextRuntime = await prepareRuntime(candidate);
      const saved = await providerStore.save(input);
      await commitRuntime(nextRuntime, saved.runtime);
      nextRuntime = undefined;
      return providerSettingsView();
    } catch (error) {
      if (nextRuntime) await nextRuntime.dispose().catch(() => {});
      throw new Error(safeError(error, [candidate?.apiKey]));
    } finally {
      providerSettingsMutation = false;
    }
  });
  ipcMain.handle(IPC.clearProviderSettings, async (event) => {
    assertTrustedSender(event);
    assertProviderSettingsIdle();
    providerSettingsMutation = true;
    let nextRuntime: PiBusinessRuntime | undefined;
    try {
      nextRuntime = await prepareRuntime(null);
      await providerStore.clear();
      await commitRuntime(nextRuntime, null);
      nextRuntime = undefined;
      return providerSettingsView();
    } catch (error) {
      if (nextRuntime) await nextRuntime.dispose().catch(() => {});
      throw new Error(safeError(error));
    } finally {
      providerSettingsMutation = false;
    }
  });
  ipcMain.handle(IPC.selectRoomImage, async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择房间照片",
      properties: ["openFile"],
      filters: [{ name: "房间照片", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = await realpath(result.filePaths[0]);
    const selectionToken = randomUUID();
    selectedRoomImages.set(selectionToken, filePath);
    return {
      token: selectionToken,
      name: path.basename(filePath),
      previewUrl: await assets.registerSelected(filePath),
    };
  });
  ipcMain.handle(IPC.selectReferenceImage, async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择喜欢的室内参考照片",
      properties: ["openFile"],
      filters: [{ name: "参考照片", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = await realpath(result.filePaths[0]);
    const selectionToken = randomUUID();
    selectedReferenceImages.set(selectionToken, filePath);
    return {
      token: selectionToken,
      name: path.basename(filePath),
      previewUrl: await assets.registerSelected(filePath),
    };
  });
  ipcMain.handle(IPC.analyzeReferenceStyle, async (event, referenceImageTokenValue: unknown, rightsConfirmedValue: unknown) => {
    assertTrustedSender(event);
    assertRuntimeStable();
    assertNoProviderTest();
    if (activeRuns.size > 0) throw new Error("设计生成期间不能分析参考图，请等待当前任务结束");
    if (shoppingListController) throw new Error("购物清单正在分析，请等待完成或先取消");
    if (referenceAnalysisController) throw new Error("已有参考图正在分析，请等待完成");
    const referenceImageToken = cleanText(referenceImageTokenValue, "参考图片令牌", 100, true)!;
    const referenceImage = selectedReferenceImages.get(referenceImageToken);
    if (!referenceImage) throw new Error("参考图片授权已失效，请重新选择照片");
    if (rightsConfirmedValue !== true) throw new Error("请先确认拥有或已获得该参考图片的使用授权");
    referenceAnalysisController = new AbortController();
    emitReferenceAnalysis({ type: "started", stage: "validating_reference", message: "正在验证参考照片和使用权确认……" });
    try {
      const provider = activeProvider();
      const providerId = provider.providerId;
      const modelId = provider.visionModel;
      const result = await runtime.execute("extract_reference_style", {
        referenceImage,
        rightsConfirmed: true,
        provider: providerId,
        model: modelId,
      }, referenceAnalysisController.signal, (update) => {
        const progress = progressMessage(update);
        const stage = progress.stage === "analyzing_reference" ? "analyzing_reference" : "validating_reference";
        emitReferenceAnalysis({ type: "progress", stage, message: progress.message || "正在解析参考风格……" });
      });
      const rawAnalysis = result.details.analysis;
      if (!rawAnalysis || typeof rawAnalysis !== "object") throw new Error("参考风格分析结果格式错误");
      const analysis = rawAnalysis as Omit<ReferenceStyleAnalysis, "token">;
      if (!analysis.styleName || !Array.isArray(analysis.transferableElements)) throw new Error("参考风格分析结果不完整");
      const referenceImageSha256 = cleanText(result.details.referenceImageSha256, "参考图摘要", 64, true)!;
      if (!/^[a-f0-9]{64}$/.test(referenceImageSha256)) throw new Error("参考图摘要格式错误");
      const token = randomUUID();
      referenceAnalyses.set(token, { kind: "style", analysis, referenceImageToken, referenceImageSha256, providerId, modelId, createdAt: Date.now() });
      emitReferenceAnalysis({ type: "completed", stage: "reference_analysis_completed", message: `参考风格“${analysis.styleName}”解析完成。` });
      return { ...analysis, token } satisfies ReferenceStyleAnalysis;
    } catch (error) {
      const cancelled = referenceAnalysisController.signal.aborted;
      const message = cancelled ? "参考风格解析已取消" : safeError(error);
      emitReferenceAnalysis({
        type: cancelled ? "cancelled" : "failed",
        stage: cancelled ? "cancelled" : "failed",
        message,
      });
      throw new Error(message);
    } finally {
      referenceAnalysisController = null;
    }
  });
  ipcMain.handle(IPC.analyzeReferenceFurnishingSet, async (event, referenceImageTokenValue: unknown, rightsConfirmedValue: unknown) => {
    assertTrustedSender(event);
    assertRuntimeStable();
    assertNoProviderTest();
    if (activeRuns.size > 0) throw new Error("设计生成期间不能分析参考图，请等待当前任务结束");
    if (shoppingListController) throw new Error("购物清单正在分析，请等待完成或先取消");
    if (referenceAnalysisController) throw new Error("已有参考图正在分析，请等待完成");
    const referenceImageToken = cleanText(referenceImageTokenValue, "参考图片令牌", 100, true)!;
    const referenceImage = selectedReferenceImages.get(referenceImageToken);
    if (!referenceImage) throw new Error("参考图片授权已失效，请重新选择照片");
    if (rightsConfirmedValue !== true) throw new Error("请先确认拥有或已获得该参考图片的视觉分析使用授权");
    referenceAnalysisController = new AbortController();
    emitReferenceAnalysis({ type: "started", stage: "validating_reference", message: "正在验证家具软装参考照片和使用权确认……" });
    try {
      const provider = activeProvider();
      const providerId = provider.providerId;
      const modelId = provider.visionModel;
      const result = await runtime.execute("extract_reference_furnishing_set", {
        referenceImage,
        rightsConfirmed: true,
        provider: providerId,
        model: modelId,
      }, referenceAnalysisController.signal, (update) => {
        const progress = progressMessage(update);
        const stage = progress.stage === "analyzing_reference" ? "analyzing_reference" : "validating_reference";
        emitReferenceAnalysis({ type: "progress", stage, message: progress.message || "正在逐件解析家具与软装……" });
      });
      const rawAnalysis = result.details.analysis;
      if (!rawAnalysis || typeof rawAnalysis !== "object") throw new Error("家具软装套系分析结果格式错误");
      const analysis = rawAnalysis as Omit<ReferenceFurnishingSetAnalysis, "token">;
      if (!analysis.setName || !Array.isArray(analysis.items) || analysis.items.length === 0) throw new Error("家具软装套系分析结果不完整");
      const referenceImageSha256 = cleanText(result.details.referenceImageSha256, "参考图摘要", 64, true)!;
      if (!/^[a-f0-9]{64}$/.test(referenceImageSha256)) throw new Error("参考图摘要格式错误");
      const token = randomUUID();
      referenceAnalyses.set(token, { kind: "furnishing_set", analysis, referenceImageToken, referenceImageSha256, providerId, modelId, createdAt: Date.now() });
      emitReferenceAnalysis({ type: "completed", stage: "reference_analysis_completed", message: `家具软装套系“${analysis.setName}”解析完成。` });
      return { ...analysis, token } satisfies ReferenceFurnishingSetAnalysis;
    } catch (error) {
      const cancelled = referenceAnalysisController.signal.aborted;
      const message = cancelled ? "家具软装套系解析已取消" : safeError(error);
      emitReferenceAnalysis({
        type: cancelled ? "cancelled" : "failed",
        stage: cancelled ? "cancelled" : "failed",
        message,
      });
      throw new Error(message);
    } finally {
      referenceAnalysisController = null;
    }
  });
  ipcMain.handle(IPC.cancelReferenceAnalysis, async (event) => {
    assertTrustedSender(event);
    if (!referenceAnalysisController) return false;
    referenceAnalysisController.abort(new Error("用户取消参考图分析"));
    return true;
  });
  ipcMain.handle(IPC.listProjects, async (event, limit?: number, filter?: unknown) => {
    assertTrustedSender(event);
    return listProjects(limit, filter);
  });
  ipcMain.handle(IPC.getProject, async (event, projectId: string) => {
    assertTrustedSender(event);
    return getProject(projectId);
  });
  ipcMain.handle(IPC.manageProject, async (event, projectId: unknown, action: unknown, title?: unknown) => {
    assertTrustedSender(event);
    return manageProject(projectId, action, title);
  });
  ipcMain.handle(IPC.generateShoppingList, async (event, projectId: unknown, versionId: unknown, replaceExisting?: unknown) => {
    assertTrustedSender(event);
    return generateShoppingList(projectId, versionId, replaceExisting);
  });
  ipcMain.handle(IPC.getShoppingList, async (event, projectId: unknown, versionId: unknown) => {
    assertTrustedSender(event);
    return getShoppingList(projectId, versionId);
  });
  ipcMain.handle(IPC.saveShoppingList, async (event, shoppingList: unknown) => {
    assertTrustedSender(event);
    return saveShoppingList(shoppingList);
  });
  ipcMain.handle(IPC.cancelShoppingList, async (event) => {
    assertTrustedSender(event);
    if (!shoppingListController) return false;
    shoppingListController.abort(new Error("用户取消购物清单分析"));
    return true;
  });
  ipcMain.handle(IPC.openShoppingSearch, async (event, projectId: unknown, versionId: unknown, itemId: unknown, platform: unknown, mode: unknown) => {
    assertTrustedSender(event);
    return openShoppingSearch(projectId, versionId, itemId, platform, mode);
  });
  ipcMain.handle(IPC.copyShoppingKeywords, async (event, projectId: unknown, versionId: unknown, itemId: unknown, mode: unknown) => {
    assertTrustedSender(event);
    return copyShoppingKeywords(projectId, versionId, itemId, mode);
  });
  ipcMain.handle(IPC.startDesign, async (event, input: unknown) => {
    assertTrustedSender(event);
    return startRun("redesign_room", validateDesignInput(input));
  });
  ipcMain.handle(IPC.startRevision, async (event, input: unknown) => {
    assertTrustedSender(event);
    return startRun("revise_room_design", validateRevisionInput(input));
  });
  ipcMain.handle(IPC.retryVersion, async (event, projectIdValue: unknown, failedVersionIdValue: unknown) => {
    assertTrustedSender(event);
    const projectId = cleanProjectId(projectIdValue, true)!;
    const failedVersionId = cleanText(failedVersionIdValue, "失败版本 ID", 20, true)!.toLowerCase();
    if (!/^v\d{3,}$/.test(failedVersionId)) throw new Error("失败版本 ID 格式错误");
    const raw = await getRawProject(projectId);
    if (raw.isArchived === true) throw new Error("项目已归档，请先恢复项目再重试");
    const version = (raw.versions as Array<Record<string, unknown>>).find((item) => item.versionId === failedVersionId);
    if (!version || version.retryable !== true) throw new Error("该版本当前不可安全重试");
    const provider = activeProvider();
    if (version.providerId !== provider.providerId || version.modelId !== provider.imageModel) {
      throw new Error("该失败版本使用的 Provider 或图片模型与当前设置不一致，不能自动重试；请切回原配置或重新创建设计");
    }
    return startRun("retry_room_design", { projectId, failedVersionId });
  });
  ipcMain.handle(IPC.cancelRun, async (event, runId: unknown) => {
    assertTrustedSender(event);
    const id = cleanText(runId, "运行 ID", 100, true)!;
    const controller = activeRuns.get(id);
    if (!controller) return false;
    emit({ runId: id, type: "cancelling", stage: "cancelling", message: "正在取消生成，请稍候……" });
    controller.abort(new Error("用户取消生成"));
    return true;
  });
  ipcMain.handle(IPC.downloadVersion, async (event, projectId: unknown, versionId: unknown) => {
    assertTrustedSender(event);
    return downloadVersion(projectId, versionId);
  });
}

async function createWindow(): Promise<void> {
  if (app.isPackaged && process.platform !== "darwin") Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#F7F4EF",
    title: "住颜 AI",
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    const location = validatedUrl.startsWith("file:") ? "本地应用页面" : "应用页面";
    dialog.showErrorBox("住颜 AI 页面加载失败", `${location}加载失败（${errorCode}）：${errorDescription}。请重新安装最新版；如果仍然出现，请将此提示发给技术支持。`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    dialog.showErrorBox("住颜 AI 页面异常退出", `页面进程已退出（${details.reason}）。请重新打开应用；如果在旧电脑上持续出现，请更新显卡驱动并将此提示发给技术支持。`);
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = process.env.VITE_DEV_SERVER_URL
      ? url.startsWith("http://127.0.0.1:5173/")
      : url.startsWith("file:");
    if (!allowed) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist-renderer", "index.html"));
  }
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!HAS_SINGLE_INSTANCE_LOCK) {
    console.error("ZHUYAN_DESKTOP_ALREADY_RUNNING: another Zhuyan desktop process owns the single-instance lock");
    app.quit();
    return;
  }
  process.env.PI_SOFT_FURNISH_WORKSPACE ||= workspaceRoot();
  process.env.PI_SOFT_FURNISH_RUN_OWNER = RUN_OWNER_ID;
  assets = new AssetRegistry(workspaceRoot());
  providerStore = new ProviderSettingsStore(app.getPath("userData"));
  try {
    configuredProvider = await providerStore.loadRuntime();
  } catch (error) {
    configuredProvider = null;
    providerSettingsError = safeError(error);
  }
  try {
    runtime = await prepareRuntime(configuredProvider);
  } catch (error) {
    if (!configuredProvider) throw error;
    providerSettingsError = safeError(error);
    configuredProvider = null;
    runtime = await prepareRuntime(null);
  }
  protocol.handle("zhuyan-asset", (request) => assets.response(request.url));
  registerIpc();
  await createWindow();
}).catch((error) => {
  const message = safeError(error);
  console.error(`ZHUYAN_DESKTOP_STARTUP_FAILED: ${message}`);
  dialog.showErrorBox("住颜 AI 启动失败", message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (process.platform === "darwin" && BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => {
  for (const controller of activeRuns.values()) controller.abort(new Error("应用退出"));
  referenceAnalysisController?.abort(new Error("应用退出"));
  shoppingListController?.abort(new Error("应用退出"));
  providerTestController?.abort(new Error("应用退出"));
  void runtime?.dispose();
});
