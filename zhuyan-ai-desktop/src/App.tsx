import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesignProject,
  DesignVersion,
  ProjectListFilter,
  ProjectSummary,
  ProviderConnectionTestResult,
  ProviderSettingsInput,
  ProviderSettingsView,
  ReferenceFurnishingSetAnalysis,
  ReferenceStyleAnalysis,
  RunEvent,
  SelectedRoomImage,
  ShoppingItem,
  ShoppingList,
  ShoppingListEvent,
  ShoppingSearchMode,
  ShoppingSearchPlatform,
  StartDesignInput,
} from "../shared/contracts";

const RECIPES = [
  { id: "warm_white_natural_wood_v1", name: "暖白原木", note: "明亮自然、浅木与暖白" },
  { id: "cream_warm_greige_v1", name: "奶油暖灰", note: "柔和包裹、低对比暖灰" },
  { id: "clean_modern_minimal_v1", name: "现代简约", note: "清爽克制、强调秩序" },
  { id: "modern_mid_century_color_v1", name: "现代撞色", note: "低饱和撞色与中古元素" },
  { id: "warm_greige_light_luxury_v1", name: "暖灰轻奢", note: "暖灰基底、少量精致质感" },
] as const;

const STAGE_LABELS: Record<string, string> = {
  starting: "启动设计任务",
  validating_input: "验证房间图片和约束",
  loading_style_recipe: "读取风格配方",
  building_generation_prompt: "构建设计指令",
  reserving_version: "创建不可覆盖的新版本",
  submitting_generation_request: "生成软装效果图",
  saving_version: "校验并保存图片",
  completed: "设计版本已完成",
  failed: "生成失败",
  cancelling: "正在取消生成",
  cancelled: "已取消",
};

const DEFAULT_KEEP = "电视及其位置\n立式空调及其位置\n大型家具的位置和大致轮廓\n门窗、吊顶、地面和拍摄视角";
const DEFAULT_ALLOWED = "窗帘\n地毯\n沙发套\n抱枕\n茶几和电视柜表面观感\n可移动灯具\n少量绿植";
const DEFAULT_FORBIDDEN = "墙体和建筑结构\n门窗位置和尺寸\n吊顶和地面\n固定设备\n大型家具占地和主要通行动线";

const SHOPPING_SEARCH_MODES: Array<{ id: ShoppingSearchMode; label: string }> = [
  { id: "broad", label: "宽泛" },
  { id: "precise", label: "精准" },
  { id: "material", label: "材质造型" },
];

const SHOPPING_SEARCH_PLATFORMS: Array<{ id: ShoppingSearchPlatform; label: string }> = [
  { id: "taobao", label: "淘宝" },
  { id: "jd", label: "京东" },
  { id: "1688", label: "1688" },
  { id: "pdd", label: "拼多多" },
];

type Page = "projects" | "new" | "project" | "settings";

const EMPTY_PROVIDER_FORM: ProviderSettingsInput = {
  baseUrl: "",
  apiKey: "",
  visionModel: "gpt-5.6-sol",
  imageModel: "gpt-image-2",
};

const DEFAULT_FURNISHING_SET_OPTIONS = {
  selectedItems: [] as Array<{ itemId: string; action: "replace" | "add" }>,
  keepAirConditioner: true,
  keepFloor: true,
  keepCeilingArchitecture: true,
  replaceCeilingLight: false,
  removeWallSconces: false,
  allowWallColorChange: false,
  allowGenericWallArt: false,
};

type FormState = {
  image: SelectedRoomImage | null;
  projectTitle: string;
  projectId: string;
  recipeId: string;
  userInstructions: string;
  keepItems: string;
  allowedChanges: string;
  forbiddenChanges: string;
  rentalFriendly: boolean;
  allowWallArt: boolean;
};

function defaultFormState(): FormState {
  return {
    image: null,
    projectTitle: "",
    projectId: "",
    recipeId: "warm_white_natural_wood_v1",
    userInstructions: "",
    keepItems: DEFAULT_KEEP,
    allowedChanges: DEFAULT_ALLOWED,
    forbiddenChanges: DEFAULT_FORBIDDEN,
    rentalFriendly: true,
    allowWallArt: false,
  };
}

function lines(value: string): string[] {
  return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function versionLabel(version: DesignVersion): string {
  return version.versionId.replace(/^v0*/, "V") || version.versionId.toUpperCase();
}

function failureStatusLabel(status: DesignVersion["displayStatus"]): string {
  return {
    completed: "已完成",
    pending: "生成中",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
  }[status];
}

export default function App() {
  const [page, setPage] = useState<Page>("projects");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectFilter, setProjectFilter] = useState<ProjectListFilter>("active");
  const [project, setProject] = useState<DesignProject | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("original");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunEvent | null>(null);
  const [revision, setRevision] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  const [downloading, setDownloading] = useState(false);
  const [managingProject, setManagingProject] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"design" | "shopping">("design");
  const [shoppingList, setShoppingList] = useState<ShoppingList | null>(null);
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [shoppingGenerating, setShoppingGenerating] = useState(false);
  const [shoppingSaving, setShoppingSaving] = useState(false);
  const [shoppingDirty, setShoppingDirty] = useState(false);
  const [shoppingSearchModes, setShoppingSearchModes] = useState<Record<string, ShoppingSearchMode>>({});
  const [shoppingProgress, setShoppingProgress] = useState("等待生成购物清单");
  const [shoppingStage, setShoppingStage] = useState<ShoppingListEvent["stage"]>("validating_shopping_list");
  const [referenceImage, setReferenceImage] = useState<SelectedRoomImage | null>(null);
  const [referenceMode, setReferenceMode] = useState<"style_inspiration" | "furnishing_set">("furnishing_set");
  const [useBasicStyleFallback, setUseBasicStyleFallback] = useState(false);
  const [referenceAnalysis, setReferenceAnalysis] = useState<ReferenceStyleAnalysis | null>(null);
  const [furnishingSetAnalysis, setFurnishingSetAnalysis] = useState<ReferenceFurnishingSetAnalysis | null>(null);
  const [analyzingReference, setAnalyzingReference] = useState(false);
  const [referenceProgress, setReferenceProgress] = useState("等待解析");
  const [furnishingSetOptions, setFurnishingSetOptions] = useState({ ...DEFAULT_FURNISHING_SET_OPTIONS });
  const [referenceOptions, setReferenceOptions] = useState({
    usePalette: true,
    useMaterials: true,
    useFurnitureLanguage: true,
    useSoftFurnishings: true,
    useLighting: true,
    selectedTransferableElements: [] as string[],
  });
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [providerSettings, setProviderSettings] = useState<ProviderSettingsView | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderSettingsInput>({ ...EMPTY_PROVIDER_FORM });
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<ProviderConnectionTestResult | null>(null);

  const refreshProviderSettings = useCallback(async () => {
    setProviderLoading(true);
    try {
      const settings = await window.zhuyan.getProviderSettings();
      setProviderSettings(settings);
      setProviderForm({
        baseUrl: settings.baseUrl || "",
        apiKey: "",
        visionModel: settings.visionModel || "gpt-5.6-sol",
        imageModel: settings.imageModel || "gpt-image-2",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProviderLoading(false);
    }
  }, []);

  const refreshProjects = useCallback(async (clearError = true) => {
    setLoading(true);
    if (clearError) setError(null);
    try {
      setProjects(await window.zhuyan.listProjects(50, projectFilter));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);

  const resetNewDesignDraft = useCallback(() => {
    setForm(defaultFormState());
    setReferenceImage(null);
    setReferenceMode("furnishing_set");
    setUseBasicStyleFallback(false);
    setReferenceAnalysis(null);
    setFurnishingSetAnalysis(null);
    setFurnishingSetOptions({ ...DEFAULT_FURNISHING_SET_OPTIONS, selectedItems: [] });
    setReferenceOptions({
      usePalette: true,
      useMaterials: true,
      useFurnitureLanguage: true,
      useSoftFurnishings: true,
      useLighting: true,
      selectedTransferableElements: [],
    });
    setReferenceProgress("等待解析");
    setAnalyzingReference(false);
  }, []);

  const openNewDesign = useCallback(() => {
    if (shoppingDirty && !window.confirm("购物清单有未保存修改，创建新设计会放弃这些修改。确认继续？")) return;
    setShoppingDirty(false);
    resetNewDesignDraft();
    setError(null);
    setNotice(null);
    setPage("new");
  }, [resetNewDesignDraft, shoppingDirty]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { void refreshProviderSettings(); }, [refreshProviderSettings]);
  useEffect(() => {
    if (page !== "settings") setProviderForm((current) => current.apiKey ? { ...current, apiKey: "" } : current);
  }, [page]);

  useEffect(() => window.zhuyan.onReferenceAnalysisEvent((event) => {
    setReferenceProgress(event.message);
    if (["cancelled", "failed", "completed"].includes(event.type)) setAnalyzingReference(false);
  }), []);

  useEffect(() => window.zhuyan.onShoppingListEvent((event) => {
    setShoppingProgress(event.message);
    setShoppingStage(event.stage);
    if (["cancelled", "failed", "completed"].includes(event.type)) setShoppingGenerating(false);
  }), []);

  useEffect(() => window.zhuyan.onRunEvent((event) => {
    setRun((current) => current?.runId === event.runId || event.type === "started" ? event : current);
    if (event.type === "failed") setError(event.message || "生成失败，请稍后重试");
    if (event.type === "cancelled") {
      setError(null);
      setNotice("本次生成已取消；如任务已预留版本，该版本会保留取消状态并可安全重试。");
    }
    if ((event.type === "failed" || event.type === "cancelled") && event.project) {
      setProject(event.project);
      setSelectedVersionId(event.project.latestCompletedVersionId || "original");
      setCompareMode(false);
      setPage("project");
      void refreshProjects(false);
    }
    if (event.type === "completed" && event.project) {
      const completedVersionId = event.versionId || event.project.latestCompletedVersionId;
      setProject(event.project);
      setSelectedVersionId(completedVersionId || "original");
      setCompareMode(false);
      setInspectorTab("design");
      setPage("project");
      setRevision("");
      setError(null);
      setNotice(`${completedVersionId?.toUpperCase() || "新版本"} 已生成并保存。`);
      resetNewDesignDraft();
      void refreshProjects();
    }
  }), [refreshProjects, resetNewDesignDraft]);

  const openProject = async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await window.zhuyan.getProject(projectId);
      setProject(loaded);
      setRenameTitle(loaded.title);
      setSelectedVersionId(loaded.latestCompletedVersionId || "original");
      setCompareMode(false);
      setInspectorTab("design");
      setComparePosition(50);
      setPage("project");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const manageCurrentProject = async (action: "rename" | "archive" | "restore") => {
    if (!project || activeRun) return;
    if (action === "archive" && shoppingDirty && !window.confirm("购物清单有未保存修改，归档项目会放弃这些修改。确认继续？")) return;
    const title = action === "rename" ? renameTitle.trim() : undefined;
    if (action === "rename" && !title) return setError("项目名称不能为空");
    if (action === "archive" && !window.confirm("归档后项目会移至“已归档”，Original 和所有版本仍会保留。确认归档？")) return;
    try {
      setManagingProject(true);
      setError(null);
      const result = await window.zhuyan.manageProject(project.projectId, action, title);
      if (action === "archive") {
        setNotice(`“${result.title}”已归档，Original 和全部版本均已保留。`);
        setProjects((current) => current.filter((item) => item.projectId !== project.projectId));
        setProject(null);
        setPage("projects");
        setProjectFilter("active");
      } else {
        const loaded = await window.zhuyan.getProject(project.projectId);
        setProject(loaded);
        setRenameTitle(loaded.title);
        setNotice(action === "rename" ? "项目名称已更新。" : "项目已恢复，可以继续创建版本。");
        if (action === "restore") setProjectFilter("active");
        else await refreshProjects(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setManagingProject(false);
    }
  };

  useEffect(() => {
    let active = true;
    const version = project?.versions.find((item) => item.versionId === selectedVersionId);
    if (!project || selectedVersionId === "original" || version?.status !== "completed" || !version.imageUrl) {
      setShoppingList(null);
      setShoppingDirty(false);
      setShoppingSearchModes({});
      setShoppingLoading(false);
      setShoppingProgress("请选择一个成功设计版本");
      return () => { active = false; };
    }
    setShoppingLoading(true);
    setShoppingList(null);
    setShoppingDirty(false);
    setShoppingSearchModes({});
    setShoppingProgress("正在读取本地购物清单……");
    void window.zhuyan.getShoppingList(project.projectId, selectedVersionId).then((list) => {
      if (!active) return;
      setShoppingList(list);
      setShoppingProgress(list ? `已读取 ${list.items.length} 项购物清单` : "该版本还没有购物清单");
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setShoppingLoading(false);
    });
    return () => { active = false; };
  }, [project?.projectId, project?.versions, selectedVersionId]);

  const openSettings = () => {
    if (shoppingDirty && !window.confirm("购物清单有未保存修改，离开项目会放弃这些修改。确认继续？")) return;
    setShoppingDirty(false);
    setError(null);
    setNotice(null);
    setProviderTestResult(null);
    setPage("settings");
    void refreshProviderSettings();
  };

  const testCurrentProvider = async () => {
    try {
      setProviderTesting(true);
      setProviderTestResult(null);
      setError(null);
      const result = await window.zhuyan.testProviderSettings(providerForm);
      setProviderTestResult(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProviderTesting(false);
    }
  };

  const saveCurrentProvider = async () => {
    try {
      setProviderSaving(true);
      setError(null);
      const settings = await window.zhuyan.saveProviderSettings(providerForm);
      setProviderSettings(settings);
      setProviderForm({
        baseUrl: settings.baseUrl || "",
        apiKey: "",
        visionModel: settings.visionModel,
        imageModel: settings.imageModel,
      });
      setReferenceAnalysis(null);
      setFurnishingSetAnalysis(null);
      setFurnishingSetOptions({ ...DEFAULT_FURNISHING_SET_OPTIONS, selectedItems: [] });
      setReferenceProgress(referenceImage ? "Provider 已更新，请重新分析参考照片" : "等待解析");
      setNotice("Provider 设置已加密保存，Pi Runtime 已重新加载。后续 AI 任务将使用当前配置。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProviderSaving(false);
    }
  };

  const clearCurrentProvider = async () => {
    if (!window.confirm("清除后不会删除任何项目或版本；正式版在重新配置前将不能调用 AI。确认清除 Provider 设置？")) return;
    try {
      setProviderSaving(true);
      setError(null);
      const settings = await window.zhuyan.clearProviderSettings();
      setProviderSettings(settings);
      setProviderForm({ ...EMPTY_PROVIDER_FORM });
      setProviderTestResult(null);
      setReferenceAnalysis(null);
      setFurnishingSetAnalysis(null);
      setFurnishingSetOptions({ ...DEFAULT_FURNISHING_SET_OPTIONS, selectedItems: [] });
      setReferenceProgress(referenceImage ? "Provider 已变更，请重新分析参考照片" : "等待解析");
      setNotice(settings.source === "development_fallback" ? "BYOK 设置已清除，开发模式已恢复使用本机验收 Provider。" : "Provider 设置已清除；已有项目仍可查看。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProviderSaving(false);
    }
  };

  const selectImage = async () => {
    const image = await window.zhuyan.selectRoomImage();
    if (image) setForm((current) => ({ ...current, image }));
  };

  const selectReferenceImage = async () => {
    const image = await window.zhuyan.selectReferenceImage();
    if (!image) return;
    setUseBasicStyleFallback(false);
    setReferenceImage(image);
    setReferenceAnalysis(null);
    setFurnishingSetAnalysis(null);
    setFurnishingSetOptions({ ...DEFAULT_FURNISHING_SET_OPTIONS, selectedItems: [] });
    setReferenceProgress("等待解析");
    setReferenceOptions((current) => ({ ...current, selectedTransferableElements: [] }));
  };

  const analyzeReferenceStyle = async () => {
    if (!referenceImage) return setError("请先选择参考风格照片");
    try {
      setError(null);
      setNotice(null);
      setAnalyzingReference(true);
      setReferenceProgress("正在启动参考风格解析……");
      if (referenceMode === "furnishing_set") {
        const analysis = await window.zhuyan.analyzeReferenceFurnishingSet(referenceImage.token, true);
        setFurnishingSetAnalysis(analysis);
        setReferenceAnalysis(null);
        setFurnishingSetOptions({
          ...DEFAULT_FURNISHING_SET_OPTIONS,
          selectedItems: analysis.items.filter((item) => item.defaultSelected).slice(0, 10).map((item) => ({ itemId: item.id, action: item.recommendedAction })),
          allowGenericWallArt: false,
        });
        setForm((current) => ({ ...current, recipeId: analysis.recommendedBaseRecipeId }));
        setNotice(`参考照片分析完成：${analysis.setName}。系统已预选推荐内容，需要时可展开调整。`);
      } else {
        const analysis = await window.zhuyan.analyzeReferenceStyle(referenceImage.token, true);
        setReferenceAnalysis(analysis);
        setFurnishingSetAnalysis(null);
        setReferenceOptions({
          usePalette: true,
          useMaterials: true,
          useFurnitureLanguage: true,
          useSoftFurnishings: true,
          useLighting: true,
          selectedTransferableElements: analysis.transferableElements.map((item) => item.category),
        });
        setForm((current) => ({ ...current, recipeId: analysis.recommendedBaseRecipeId }));
        setNotice(`参考照片分析完成：${analysis.styleName}。将按确认后的配色、材质和氛围生成。`);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (!/取消/.test(message)) setError(message);
    } finally {
      setAnalyzingReference(false);
    }
  };

  const useBasicStyleWithoutReference = () => {
    clearReferenceStyle();
    setUseBasicStyleFallback(true);
    setNotice("已切换为基础风格生成；参考照片优先流程已跳过。");
  };

  const clearReferenceStyle = () => {
    setReferenceImage(null);
    setReferenceAnalysis(null);
    setFurnishingSetAnalysis(null);
    setFurnishingSetOptions({ ...DEFAULT_FURNISHING_SET_OPTIONS, selectedItems: [] });
    setReferenceProgress("等待解析");
    setReferenceOptions((current) => ({ ...current, selectedTransferableElements: [] }));
  };

  const toggleFurnishingItem = (id: string, recommendedAction: "replace" | "add") => {
    const alreadySelected = furnishingSetOptions.selectedItems.some((item) => item.itemId === id);
    if (!alreadySelected && furnishingSetOptions.selectedItems.length >= 10) {
      setError("首版成套复制一次最多选择 10 件，请先取消一件次要物品");
      return;
    }
    setError(null);
    setFurnishingSetOptions((current) => ({
      ...current,
      selectedItems: current.selectedItems.some((item) => item.itemId === id)
        ? current.selectedItems.filter((item) => item.itemId !== id)
        : [...current.selectedItems, { itemId: id, action: recommendedAction }],
    }));
  };

  const setFurnishingItemAction = (id: string, action: "replace" | "add") => {
    setFurnishingSetOptions((current) => ({
      ...current,
      selectedItems: current.selectedItems.map((item) => item.itemId === id ? { ...item, action } : item),
    }));
  };

  const toggleTransferElement = (name: string) => {
    setReferenceOptions((current) => ({
      ...current,
      selectedTransferableElements: current.selectedTransferableElements.includes(name)
        ? current.selectedTransferableElements.filter((item) => item !== name)
        : [...current.selectedTransferableElements, name],
    }));
  };

  const createDesign = async () => {
    if (!form.image) return setError("请先选择房间照片");
    if (!referenceAnalysis && !furnishingSetAnalysis && !useBasicStyleFallback) return setError("请上传并分析参考照片；如果没有参考图，请展开“没有参考照片”选择基础风格");
    const input: StartDesignInput = {
      sourceImageToken: form.image.token,
      projectTitle: form.projectTitle.trim() || undefined,
      projectId: form.projectId.trim() || undefined,
      recipeId: form.recipeId,
      customStyle: referenceAnalysis ? {
        analysisToken: referenceAnalysis.token,
        ...referenceOptions,
      } : undefined,
      furnishingSet: furnishingSetAnalysis && referenceImage ? {
        analysisToken: furnishingSetAnalysis.token,
        referenceImageToken: referenceImage.token,
        ...furnishingSetOptions,
        rightsConfirmedForGeneration: true,
      } : undefined,
      userInstructions: form.userInstructions.trim() || undefined,
      keepItems: lines(form.keepItems),
      allowedChanges: lines(form.allowedChanges),
      forbiddenChanges: lines(form.forbiddenChanges),
      rentalFriendly: form.rentalFriendly,
      allowWallArt: form.allowWallArt,
    };
    try {
      setError(null);
      const { runId } = await window.zhuyan.startDesign(input);
      setRun({ runId, type: "started", stage: "starting", message: "正在启动住颜 AI 工具……" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const createRevision = async () => {
    if (!project || !revision.trim()) return;
    if (shoppingDirty) return setError("请先保存或放弃购物清单修改，再创建新的设计版本");
    try {
      setError(null);
      const { runId } = await window.zhuyan.startRevision({
        projectId: project.projectId,
        baseVersionId: selectedVersionId === "original" ? undefined : selectedVersionId,
        revisionInstructions: revision.trim(),
      });
      setRun({ runId, type: "started", stage: "starting", message: "正在启动版本修改……" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const retryVersion = async (failedVersionId: string) => {
    if (!project || activeRun) return;
    if (shoppingDirty) return setError("请先保存或放弃购物清单修改，再重试设计版本");
    try {
      setError(null);
      setNotice(null);
      const { runId } = await window.zhuyan.retryVersion(project.projectId, failedVersionId);
      setRun({ runId, type: "started", stage: "starting", message: `正在重试 ${failedVersionId.toUpperCase()}……`, projectId: project.projectId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const generateCurrentShoppingList = async () => {
    if (!project || !selectedVersion || selectedVersion.status !== "completed" || !selectedVersion.imageUrl || project.isArchived) return;
    const replacing = Boolean(shoppingList);
    const message = replacing
      ? `重新分析会替换 ${versionLabel(selectedVersion)} 当前购物清单及未保存编辑，并产生一次视觉模型费用。确认继续？`
      : `将分析 Original 与 ${versionLabel(selectedVersion)} 效果图并产生一次视觉模型费用。确认生成购物清单？`;
    if (!window.confirm(message)) return;
    try {
      setShoppingGenerating(true);
      setError(null);
      setNotice(null);
      setShoppingProgress("正在启动购物清单分析……");
      const list = await window.zhuyan.generateShoppingList(project.projectId, selectedVersion.versionId, replacing);
      setShoppingList(list);
      setShoppingDirty(false);
      setShoppingSearchModes({});
      setNotice(`${versionLabel(selectedVersion)} 购物清单已生成并保存，共 ${list.items.length} 项。`);
    } catch (reason) {
      const messageText = reason instanceof Error ? reason.message : String(reason);
      if (!/取消/.test(messageText)) setError(messageText);
    } finally {
      setShoppingGenerating(false);
    }
  };

  const updateShoppingItem = (itemId: string, changes: Partial<ShoppingItem>) => {
    setShoppingList((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...changes } : item),
    } : current);
    setShoppingDirty(true);
  };

  const saveCurrentShoppingList = async () => {
    if (!shoppingList || project?.isArchived || !shoppingDirty) return;
    try {
      setShoppingSaving(true);
      setError(null);
      const saved = await window.zhuyan.saveShoppingList(shoppingList);
      setShoppingList(saved);
      setShoppingDirty(false);
      setNotice(`${saved.versionId.toUpperCase()} 购物清单已保存（修订 ${saved.revision}）。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setShoppingSaving(false);
    }
  };

  const searchShoppingItem = async (item: ShoppingItem, platform: ShoppingSearchPlatform) => {
    if (!project || !shoppingList || !item.included) return;
    if (shoppingDirty) return setError("请先保存购物清单，再使用最新字段生成购物搜索词");
    try {
      setError(null);
      const mode = shoppingSearchModes[item.id] || "broad";
      const result = await window.zhuyan.openShoppingSearch(project.projectId, shoppingList.versionId, item.id, platform, mode);
      const platformLabel = SHOPPING_SEARCH_PLATFORMS.find((candidate) => candidate.id === platform)?.label || platform;
      setNotice(`已在${platformLabel}打开搜索：${result.keywords}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const copyShoppingItemKeywords = async (item: ShoppingItem) => {
    if (!project || !shoppingList || !item.included) return;
    if (shoppingDirty) return setError("请先保存购物清单，再复制最新组合关键词");
    try {
      setError(null);
      const mode = shoppingSearchModes[item.id] || "broad";
      const result = await window.zhuyan.copyShoppingKeywords(project.projectId, shoppingList.versionId, item.id, mode);
      setNotice(`已复制搜索词：${result.keywords}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const chooseCurrentDesignForShopping = async () => {
    if (!project || !selectedVersion || selectedVersion.status !== "completed" || !selectedVersion.imageUrl) return;
    setInspectorTab("shopping");
    if (!shoppingList && !shoppingLoading) await generateCurrentShoppingList();
  };

  const downloadCurrentVersion = async () => {
    if (!project) return;
    try {
      setDownloading(true);
      setError(null);
      setNotice(null);
      const result = await window.zhuyan.downloadVersion(project.projectId, selectedVersionId);
      if (result.status === "saved") setNotice(`已保存：${result.fileName}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDownloading(false);
    }
  };

  const selectVersion = (versionId: string) => {
    if (shoppingDirty && versionId !== selectedVersionId && !window.confirm("当前购物清单有未保存修改，切换版本会放弃这些修改。确认继续？")) return;
    setSelectedVersionId(versionId);
    setShoppingDirty(false);
    setComparePosition(50);
    if (versionId === "original") setCompareMode(false);
  };

  const activeRun = run && ["started", "progress", "cancelling"].includes(run.type) ? run : null;
  const hasSelectedReferenceStyle = referenceAnalysis && (
    referenceOptions.usePalette
    || referenceOptions.useMaterials
    || referenceOptions.useFurnitureLanguage
    || referenceOptions.useSoftFurnishings
    || referenceOptions.useLighting
    || referenceOptions.selectedTransferableElements.length > 0
  );
  const selectedFurnishingItems = furnishingSetAnalysis?.items.filter((item) => furnishingSetOptions.selectedItems.some((selected) => selected.itemId === item.id)) || [];
  const needsGenericWallArtPermission = selectedFurnishingItems.some((item) => /(画|墙饰|wall\s*art|painting|artwork)/i.test(item.category));
  const hasSelectedFurnishingSet = furnishingSetAnalysis
    && furnishingSetOptions.selectedItems.length > 0
    && (!needsGenericWallArtPermission || furnishingSetOptions.allowGenericWallArt);
  const selectedVersion = project?.versions.find((item) => item.versionId === selectedVersionId);
  const selectedVersionName = selectedVersion ? versionLabel(selectedVersion) : selectedVersionId.toUpperCase();
  const selectedImage = selectedVersionId === "original"
    ? project?.source.imageUrl
    : selectedVersion?.imageUrl;
  const previewVersions = useMemo(
    () => project?.versions.filter((item) => item.status === "completed" && item.imageUrl) || [],
    [project],
  );
  const canCompare = Boolean(project?.source.imageUrl && selectedVersion?.imageUrl && selectedVersion?.status === "completed");
  const abnormalVersions = useMemo(
    () => project?.versions.filter((item) => item.displayStatus !== "completed") || [],
    [project],
  );
  const shoppingIncludedCount = shoppingList?.items.filter((item) => item.included).length || 0;
  const shoppingPurchasedCount = shoppingList?.items.filter((item) => item.included && item.purchased).length || 0;

  const changeInspectorTab = (tab: "design" | "shopping") => {
    if (tab !== inspectorTab && shoppingDirty && !window.confirm("购物清单有未保存修改，切换页面会保留当前草稿，但离开项目或切换版本会丢失。仍要切换？")) return;
    setInspectorTab(tab);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">住</span><div><strong>住颜 AI</strong><small>软装设计工作台</small></div></div>
        <nav>
          <button className={page === "projects" ? "nav-active" : ""} onClick={() => { if (shoppingDirty && !window.confirm("购物清单有未保存修改，离开项目会放弃这些修改。确认继续？")) return; setShoppingDirty(false); setPage("projects"); void refreshProjects(); }}><span>⌂</span>我的项目</button>
          <button className={page === "new" ? "nav-active" : ""} onClick={openNewDesign}><span>＋</span>新建设计</button>
          <button className={page === "settings" ? "nav-active" : ""} onClick={openSettings}><span>⚙</span>设置</button>
        </nav>
        <div className={`runtime-card ${providerSettings?.runtimeReady ? "" : "runtime-warning"}`}><span className="status-dot" /><div><strong>{providerSettings?.runtimeReady ? "Pi Runtime 已连接" : "AI Provider 待配置"}</strong><small>{providerSettings?.runtimeReady ? `${providerSettings.imageModel} · 本地版本存储` : "已有项目仍可查看"}</small></div></div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="eyebrow">ZHǓYÁN WORKSPACE</span><h1>{page === "new" ? "创建新设计" : page === "project" ? project?.title : page === "settings" ? "设置" : "我的项目"}</h1></div>
          {page === "settings" ? <button className="ghost" onClick={() => { setProviderForm((current) => ({ ...current, apiKey: "" })); setPage("projects"); void refreshProjects(); }}>返回项目</button> : <button className="primary small" onClick={openNewDesign}>＋ 新建设计</button>}
        </header>

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
        {notice && <div className="notice-banner"><span>{notice}</span><button onClick={() => setNotice(null)}>×</button></div>}

        {page === "projects" && (
          <section className="content projects-page">
            <div className="section-heading"><div><h2>{projectFilter === "archived" ? "已归档项目" : "继续你的空间设计"}</h2><p>{projectFilter === "archived" ? "归档只隐藏项目，不删除 Original 或任何版本。" : "项目和所有历史版本保存在本地，不会覆盖原图。"}</p></div><div className="project-filter"><button className={projectFilter === "active" ? "active" : ""} onClick={() => setProjectFilter("active")}>进行中</button><button className={projectFilter === "archived" ? "active" : ""} onClick={() => setProjectFilter("archived")}>已归档</button><span>{projects.length} 个项目</span></div></div>
            {loading ? <EmptyState title="正在读取本地项目…" /> : projects.length === 0 ? (
              projectFilter === "archived" ? <EmptyState title="还没有归档项目" /> : <EmptyState title="还没有设计项目" action="上传第一张房间照片" onAction={openNewDesign} />
            ) : (
              <div className="project-grid">
                {projects.map((item) => (
                  <button className="project-card" key={item.projectId} onClick={() => void openProject(item.projectId)}>
                    <div className="project-image">
                      {item.latestImageUrl ? <img src={item.latestImageUrl} alt={item.title} /> : <div className="image-placeholder">等待首版设计</div>}
                      <span>{item.latestCompletedVersionId?.toUpperCase() || "ORIGINAL"}</span>
                    </div>
                    <div className="project-info"><div><h3>{item.title}</h3><p>{formatDate(item.updatedAt)} · {item.completedVersionCount} 个完成版本{item.isArchived ? " · 已归档" : ""}</p></div><b>→</b></div>
                  </button>
                ))}
                {projectFilter === "active" && <button className="new-project-card" onClick={openNewDesign}><span>＋</span><strong>创建新项目</strong><small>从一张真实房间照片开始</small></button>}
              </div>
            )}
          </section>
        )}

        {page === "settings" && (
          <section className="content settings-page">
            <div className="section-heading"><div><h2>AI Provider</h2><p>配置你自己的 OpenAI 兼容服务。设置不会写入项目、日志或 Renderer 本地存储。</p></div><span>{providerSettings?.configured ? "已配置 BYOK" : providerSettings?.source === "development_fallback" ? "开发模式回退" : "尚未配置"}</span></div>
            {providerLoading ? <EmptyState title="正在读取 Provider 设置…" /> : <div className="settings-layout">
              <div className="panel provider-settings-panel">
                <div className="settings-status"><span className={`status-dot ${providerSettings?.runtimeReady ? "" : "warning"}`} /><div><strong>{providerSettings?.runtimeReady ? "当前配置可供 Runtime 使用" : "当前没有可用的正式 Provider"}</strong><small>{providerSettings?.configured ? `凭据已由系统安全存储加密 · ${providerSettings.updatedAt ? formatDate(providerSettings.updatedAt) : ""}` : providerSettings?.source === "development_fallback" ? "仅开发模式继续使用本机验收 Provider；正式打包不会包含开发者密钥。" : "配置前仍可查看项目、版本和已保存购物清单。"}</small></div></div>
                {providerSettings?.error && <div className="settings-inline-error">{providerSettings.error}</div>}
                {!providerSettings?.secureStorageAvailable && <div className="settings-inline-error">系统安全存储当前不可用。应用会拒绝以明文保存 API Key。</div>}
                <div className="provider-form">
                  <label>API Base URL<input value={providerForm.baseUrl} disabled={providerSaving || providerTesting} onChange={(event) => { setProviderForm((current) => ({ ...current, baseUrl: event.target.value })); setProviderTestResult(null); }} placeholder="http://example.com/v1" /></label>
                  <label>API Key<input type="password" autoComplete="off" value={providerForm.apiKey || ""} disabled={providerSaving || providerTesting} onChange={(event) => { setProviderForm((current) => ({ ...current, apiKey: event.target.value })); setProviderTestResult(null); }} placeholder={providerSettings?.hasApiKey ? "已加密保存；留空则保持不变" : "输入 Provider API Key"} /></label>
                  <div className="field-row"><label>视觉分析模型<input value={providerForm.visionModel} disabled={providerSaving || providerTesting} onChange={(event) => { setProviderForm((current) => ({ ...current, visionModel: event.target.value })); setProviderTestResult(null); }} placeholder="gpt-5.6-sol" /></label><label>图片生成模型<input value={providerForm.imageModel} disabled={providerSaving || providerTesting} onChange={(event) => { setProviderForm((current) => ({ ...current, imageModel: event.target.value })); setProviderTestResult(null); }} placeholder="gpt-image-2" /></label></div>
                </div>
                {providerTestResult && <div className="provider-test-result"><strong>✓ {providerTestResult.message}</strong><small>/models 返回 {providerTestResult.availableModelCount} 个模型。连接测试不会生成图片，也不能保证图片编辑接口一定受支持。</small></div>}
                <div className="settings-actions"><button className="ghost" disabled={providerSaving || providerTesting || !providerForm.baseUrl || (!providerForm.apiKey && !providerSettings?.hasApiKey)} onClick={() => void testCurrentProvider()}>{providerTesting ? "正在测试连接…" : "测试连接"}</button><button className="primary" disabled={providerSaving || providerTesting || !providerSettings?.secureStorageAvailable || !providerForm.baseUrl || !providerForm.visionModel || !providerForm.imageModel || (!providerForm.apiKey && !providerSettings?.hasApiKey)} onClick={() => void saveCurrentProvider()}>{providerSaving ? "正在保存并重载…" : "保存配置"}</button>{(providerSettings?.configured || providerSettings?.error) && <button className="ghost danger" disabled={providerSaving || providerTesting} onClick={() => void clearCurrentProvider()}>{providerSettings?.error ? "清除异常配置" : "清除配置"}</button>}</div>
              </div>
              <aside className="settings-help panel"><h3>配置说明</h3><ul><li>服务必须兼容 OpenAI 的 <code>/chat/completions</code>、<code>/images/edits</code> 和建议支持 <code>/models</code>。</li><li>HTTP 和 HTTPS 服务地址均可使用；HTTP 为明文传输，API Key 和提交给 Provider 的图片可能被链路上的第三方读取。</li><li>API Key 使用 Electron safeStorage 和当前系统用户凭据加密；Windows 使用系统加密能力，macOS 使用钥匙串。</li><li>视觉分析与图片生成可使用不同模型，但第一版共用一个服务地址和 API Key。</li><li>测试连接只读取模型列表，通常不产生模型推理费用。</li></ul><div className="settings-boundary"><strong>固定图片参数</strong><span>1536×1024 · low · input fidelity high</span><small>这些参数继续由应用锁定，避免误设置影响设计稳定性。</small></div></aside>
            </div>}
          </section>
        )}

        {page === "new" && (
          <section className="content design-form-page">
            <div className="form-column">
              <div className="panel"><PanelTitle number="1" title="选择房间照片" note="JPG、PNG 或 WebP，原图只读" />
                <button className={`upload-box ${form.image ? "has-image" : ""}`} onClick={() => void selectImage()}>
                  {form.image ? <><img src={form.image.previewUrl} alt="待设计房间" /><div><strong>{form.image.name}</strong><small>点击重新选择</small></div></> : <><span>↑</span><strong>选择本地房间照片</strong><small>用户照片是空间结构与视角的唯一事实来源</small></>}
                </button>
              </div>
              <div className="panel reference-style-panel"><PanelTitle number="2" title="上传喜欢的参考照片" note="默认整体参考家具、软装、配色和材质；系统不会复制参考户型" />
                <details className="reference-method"><summary>参考方式：{referenceMode === "furnishing_set" ? "整体参考（推荐）" : "只参考氛围"}</summary><div className="reference-mode-switch"><button className={referenceMode === "furnishing_set" ? "active" : ""} disabled={analyzingReference} onClick={() => { setReferenceMode("furnishing_set"); setReferenceAnalysis(null); setFurnishingSetAnalysis(null); }}>整体参考</button><button className={referenceMode === "style_inspiration" ? "active" : ""} disabled={analyzingReference} onClick={() => { setReferenceMode("style_inspiration"); setReferenceAnalysis(null); setFurnishingSetAnalysis(null); }}>只参考氛围</button></div><p>整体参考会逐件确认内容并把已授权参考图作为第二张图片参与生成；只参考氛围只迁移确认后的文字配方。</p></details>
                {!referenceImage ? <button className="reference-upload" onClick={() => void selectReferenceImage()}><span>◇</span><div><strong>选择参考照片</strong><small>{referenceMode === "furnishing_set" ? "优先使用家具主体清晰、遮挡少的近景照片" : "提取配色、材质、家具语言、软装和灯光氛围"}</small></div></button> : <div className="reference-workspace">
                  <div className="reference-preview"><img src={referenceImage.previewUrl} alt="参考照片" /><div><strong>{referenceImage.name}</strong><small>{furnishingSetAnalysis ? `已解析：${furnishingSetAnalysis.setName}` : referenceAnalysis ? `已解析：${referenceAnalysis.styleName}` : "尚未解析"}</small><button className="text-button" disabled={analyzingReference} onClick={() => void selectReferenceImage()}>重新选择</button></div></div>
                  {!referenceAnalysis && !furnishingSetAnalysis && <div className="rights-analysis"><p>请仅提交本人所有或已获授权的图片。参考图会发送至已配置的视觉模型并可能产生少量调用费用；点击解析即表示确认可用于本次 AI 分析。系统不会从照片推断预算、产权、租赁状态、施工范围或精确尺寸，也不会把它包装成改造前后对比。</p>{analyzingReference && <p className="reference-progress">{referenceProgress}</p>}<div><button className="primary" disabled={analyzingReference || Boolean(activeRun) || providerSettings?.runtimeReady !== true} onClick={() => void analyzeReferenceStyle()}>{analyzingReference ? "正在解析参考照片…" : providerSettings?.runtimeReady !== true ? "请先配置 AI Provider" : "确认有权使用并分析参考图"}</button>{analyzingReference && <button className="ghost danger" onClick={() => void window.zhuyan.cancelReferenceAnalysis()}>取消解析</button>}<button className="ghost" disabled={analyzingReference} onClick={clearReferenceStyle}>不使用参考图</button></div></div>}
                  {furnishingSetAnalysis && <div className="style-analysis-card furnishing-set-card"><div className="analysis-heading"><div><span className="eyebrow">整体参考</span><h3>{furnishingSetAnalysis.setName}</h3><p>{furnishingSetAnalysis.setSummary}</p></div><button className="ghost" onClick={clearReferenceStyle}>移除</button></div><div className="analysis-meta"><span>识别 {furnishingSetAnalysis.items.length} 件</span><span>已采用 {furnishingSetOptions.selectedItems.length} 件</span><span>可信度：{furnishingSetAnalysis.confidence}</span></div><div className="selected-reference-summary"><strong>将参考</strong><div>{selectedFurnishingItems.map((item) => <span key={item.id}>✓ {item.name}</span>)}</div><small>原房间户型、门窗、视角、空调、地面和吊顶结构保持为准。</small></div><details className="reference-adjustments"><summary>调整采用内容与高级处理</summary><h4>逐件选择要采用的家具软装（最多 10 件）</h4><div className="furnishing-item-grid">{furnishingSetAnalysis.items.map((item) => { const selected = furnishingSetOptions.selectedItems.find((candidate) => candidate.itemId === item.id); return <div key={item.id} className={selected ? "furnishing-item active" : "furnishing-item"}><button className="furnishing-item-toggle" onClick={() => toggleFurnishingItem(item.id, item.recommendedAction)}><span>{selected ? "✓" : "+"}</span><div><strong>{item.name}</strong><small>{item.category} · {item.color || "颜色未确定"} · {item.material || "材质未确定"}</small><p>{item.silhouette || item.visualDescription}</p>{item.artworkLike && <em>仅生成不相同的通用近似设计</em>}{item.warnings.length > 0 && <em>分析限制：{item.warnings[0]}</em>}</div></button>{selected && <div className="item-action-switch"><button className={selected.action === "replace" ? "active" : ""} onClick={() => setFurnishingItemAction(item.id, "replace")}>替换{item.replacementTarget ? `原${item.replacementTarget}` : "原同类"}</button><button className={selected.action === "add" ? "active" : ""} onClick={() => setFurnishingItemAction(item.id, "add")}>作为新增</button></div>}</div>; })}</div><h4>原房间保留与冲突处理</h4><div className="set-option-grid">{[
                    ["keepAirConditioner", "保留空调及位置"], ["keepFloor", "保留原地面"], ["keepCeilingArchitecture", "保留吊顶和石膏线"], ["replaceCeilingLight", "主吊灯改简约吸顶灯"], ["removeWallSconces", "移除装饰壁灯"], ["allowWallColorChange", "允许调整墙面颜色"], ["allowGenericWallArt", "允许新增通用墙画"],
                  ].map(([key, label]) => { const requiredKeep = key === "keepAirConditioner" || key === "keepFloor" || key === "keepCeilingArchitecture"; return <label key={key}><input type="checkbox" checked={Boolean(furnishingSetOptions[key as keyof Omit<typeof furnishingSetOptions, "selectedItems">])} disabled={requiredKeep} onChange={(event) => setFurnishingSetOptions((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}{requiredKeep ? "（必须）" : ""}</span></label>; })}</div></details><p className="analysis-safety">原房间图始终决定户型、门窗、阳台、视角和尺度。不会承诺品牌、型号、精确尺寸或艺术作品原样复制。</p>{furnishingSetAnalysis.warnings.length > 0 && <details><summary>查看 {furnishingSetAnalysis.warnings.length} 条分析限制</summary><ul>{furnishingSetAnalysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}</div>}
                  {referenceAnalysis && <div className="style-analysis-card"><div className="analysis-heading"><div><span className="eyebrow">只参考氛围</span><h3>{referenceAnalysis.styleName}</h3><p>{referenceAnalysis.styleSummary}</p></div><button className="ghost" onClick={clearReferenceStyle}>移除</button></div><div className="palette-row">{referenceAnalysis.palette.map((item) => <div key={`${item.name}-${item.hex}`} title={`${item.name} ${item.ratioPercent}%`}><span style={{ background: item.hex || "#ddd" }} /><small>{item.name}<br />{item.ratioPercent}%</small></div>)}</div><div className="analysis-meta"><span>空间：{referenceAnalysis.roomType}</span><span>可信度：{referenceAnalysis.confidence}</span><span>装饰密度：{referenceAnalysis.decorationDensity}</span></div><h4>选择要迁移的方向</h4><div className="style-toggles">{[
                    ["usePalette", "配色"], ["useMaterials", "材质"], ["useFurnitureLanguage", "家具语言"], ["useSoftFurnishings", "软装"], ["useLighting", "灯光氛围"],
                  ].map(([key, label]) => <label key={key}><input type="checkbox" checked={referenceOptions[key as keyof Omit<typeof referenceOptions, "selectedTransferableElements">]} onChange={(event) => setReferenceOptions((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>)}</div><h4>可迁移元素</h4><div className="transfer-chips">{referenceAnalysis.transferableElements.map((item) => <button key={item.category} className={referenceOptions.selectedTransferableElements.includes(item.category) ? "active" : ""} title={item.guidance || item.description} onClick={() => toggleTransferElement(item.category)}>{referenceOptions.selectedTransferableElements.includes(item.category) ? "✓ " : ""}{item.category}</button>)}</div>{referenceAnalysis.warnings.length > 0 && <details><summary>查看 {referenceAnalysis.warnings.length} 条分析限制</summary><ul>{referenceAnalysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}<p className="analysis-safety">不会复制：{referenceAnalysis.doNotCopy.slice(0, 4).join("；")}。</p></div>}
                </div>}
              </div>
              <div className="panel fallback-panel">
                <details open={useBasicStyleFallback}>
                  <summary><span>没有参考照片？</span><small>改用基础风格生成</small></summary>
                  <div className="fallback-content"><p>参考照片是推荐主流程。只有确实没有参考图时，才需要手动选择基础风格。</p><div className="recipe-grid">{RECIPES.map((recipe) => <button key={recipe.id} className={form.recipeId === recipe.id ? "recipe active" : "recipe"} onClick={() => { setForm({ ...form, recipeId: recipe.id }); useBasicStyleWithoutReference(); }}><span className={`swatch swatch-${recipe.id}`} /><strong>{recipe.name}</strong><small>{recipe.note}</small></button>)}</div></div>
                </details>
              </div>
              <div className="panel requirements-panel"><PanelTitle number="3" title="补充要求" note="只写你特别在意的内容，其余由系统保守处理" />
                <label>还有什么特别要求？（可选）<textarea value={form.userInstructions} onChange={(event) => setForm({ ...form, userInstructions: event.target.value })} placeholder="例如：保留电视和空调；沙发不要太大；不要新增墙画；整体明亮一些。" /></label>
                <details className="advanced-settings"><summary>高级设置</summary><div className="advanced-settings-content"><div className="field-row"><label>项目名称<input value={form.projectTitle} onChange={(event) => setForm({ ...form, projectTitle: event.target.value })} placeholder="例如：客厅参考图改造" /></label><label>项目 ID（可选）<input value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} placeholder="living-room-01" /></label></div><div className="constraint-grid"><label>必须保留<textarea value={form.keepItems} onChange={(event) => setForm({ ...form, keepItems: event.target.value })} /></label><label>允许修改<textarea value={form.allowedChanges} onChange={(event) => setForm({ ...form, allowedChanges: event.target.value })} /></label><label>禁止修改<textarea value={form.forbiddenChanges} onChange={(event) => setForm({ ...form, forbiddenChanges: event.target.value })} /></label></div><div className="toggles"><label><input type="checkbox" checked={form.rentalFriendly} disabled={Boolean(furnishingSetAnalysis)} onChange={(event) => setForm({ ...form, rentalFriendly: event.target.checked })} /><span>租房友好 / 可逆软装{furnishingSetAnalysis ? "（整体参考由逐项动作控制）" : ""}</span></label><label><input type="checkbox" checked={furnishingSetAnalysis ? furnishingSetOptions.allowGenericWallArt : form.allowWallArt} disabled={Boolean(furnishingSetAnalysis)} onChange={(event) => setForm({ ...form, allowWallArt: event.target.checked })} /><span>允许新增墙画{furnishingSetAnalysis ? "（请在参考内容中调整）" : ""}</span></label></div></div></details>
              </div>
              <div className="form-actions"><p>{providerSettings?.runtimeReady !== true ? "请先到设置页配置可用的 AI Provider；已有项目和历史版本不会受影响。" : furnishingSetAnalysis ? needsGenericWallArtPermission && !furnishingSetOptions.allowGenericWallArt ? "已选择墙画/墙饰，请先在调整内容中开启通用墙画。" : `将采用参考图中确认的 ${furnishingSetOptions.selectedItems.length} 件内容；点击生成即再次确认参考图可用于本次设计。` : referenceAnalysis ? `将使用“${referenceAnalysis.styleName}”确认后的氛围配方；参考原图不会直接发送给图片生成模型。` : useBasicStyleFallback ? `没有参考图，将使用${RECIPES.find((item) => item.id === form.recipeId)?.name || "基础风格"}生成。` : "请先上传并分析参考照片；没有参考图时可使用上方基础风格入口。"}</p><button className="primary" disabled={providerSettings?.runtimeReady !== true || !form.image || (!referenceAnalysis && !furnishingSetAnalysis && !useBasicStyleFallback) || Boolean(activeRun) || analyzingReference || Boolean(referenceAnalysis && !hasSelectedReferenceStyle) || Boolean(furnishingSetAnalysis && !hasSelectedFurnishingSet)} onClick={() => void createDesign()}>{providerSettings?.runtimeReady !== true ? "先配置 AI Provider" : "生成设计图"}</button></div>
            </div>
          </section>
        )}

        {page === "project" && project && (
          <section className="project-workbench">
            <div className="canvas-area">
              <div className="workbench-toolbar"><div className="version-tabs"><button className={selectedVersionId === "original" ? "active" : ""} onClick={() => selectVersion("original")}>Original</button>{previewVersions.map((version) => <button className={selectedVersionId === version.versionId ? "active" : ""} key={version.versionId} onClick={() => selectVersion(version.versionId)}>{versionLabel(version)}</button>)}</div><div className="canvas-actions"><button className={compareMode ? "active" : ""} disabled={!canCompare} onClick={() => setCompareMode((current) => !current)}>◐ {compareMode ? "退出对比" : "原图对比"}</button><button disabled={!selectedImage || downloading} onClick={() => void downloadCurrentVersion()}>⇩ {downloading ? "保存中…" : "下载当前版本"}</button></div></div>
              {compareMode && project.source.imageUrl && selectedVersion?.imageUrl ? <CompareCanvas original={project.source.imageUrl} design={selectedVersion.imageUrl} position={comparePosition} onPosition={setComparePosition} versionName={selectedVersionName} /> : <div className="design-canvas">{selectedImage ? <img src={selectedImage} alt={`${project.title} ${selectedVersionId}`} /> : <div className="image-placeholder">该版本没有可预览图片</div>}<span className="canvas-badge">{selectedVersionId === "original" ? "原始房间" : `${selectedVersionName} · ${selectedVersion?.status || "不可用"}`}</span></div>}
              <p className="disclaimer">AI 效果图用于软装方向可视化，可能存在局部生成式重绘，不作为施工图或精确尺寸依据。</p>
            </div>
            <aside className="inspector">
              <div className="project-meta"><span className="status-dot" /><div><strong>{project.isArchived ? "项目已归档" : `${project.latestCompletedVersionId?.toUpperCase()} 已保存`}</strong><small>{project.counts.completed} 个完成版本 · {project.isArchived ? "只读保留" : "本地存储"}</small></div></div>
              <div className="inspector-tabs"><button className={inspectorTab === "design" ? "active" : ""} onClick={() => changeInspectorTab("design")}>设计</button><button className={inspectorTab === "shopping" ? "active" : ""} onClick={() => changeInspectorTab("shopping")}>购物清单{shoppingList ? ` · ${shoppingIncludedCount}` : ""}</button></div>
              {inspectorTab === "design" ? <>
              <div className="inspector-section project-management"><h3>项目管理</h3><label>项目名称<input value={renameTitle} disabled={managingProject} onChange={(event) => setRenameTitle(event.target.value)} /></label><div><button className="ghost" disabled={managingProject || !renameTitle.trim() || renameTitle.trim() === project.title} onClick={() => void manageCurrentProject("rename")}>保存名称</button>{project.isArchived ? <button className="restore-button" disabled={managingProject} onClick={() => void manageCurrentProject("restore")}>恢复项目</button> : <button className="archive-button" disabled={managingProject || Boolean(activeRun)} onClick={() => void manageCurrentProject("archive")}>归档项目</button>}</div><small>归档不会删除 Original、效果图或版本历史。</small></div>
              <div className="inspector-section"><h3>当前版本</h3><dl><div><dt>版本</dt><dd>{selectedVersionId === "original" ? "Original" : selectedVersionName}</dd></div><div><dt>基于</dt><dd>{selectedVersion?.parentVersionId?.toUpperCase() || "—"}</dd></div><div><dt>模式</dt><dd>{selectedVersion?.styleSource === "reference_furnishing_set" ? "整体参考" : selectedVersion?.styleSource === "extracted_text_recipe" ? "只参考氛围" : selectedVersionId === "original" ? "原始房间" : "基础风格"}</dd></div>{selectedVersion?.selectedItemCount ? <div><dt>迁移物品</dt><dd>{selectedVersion.selectedItemCount} 件（替换 {selectedVersion.selectedReplaceCount || 0} / 新增 {selectedVersion.selectedAddCount || 0}）</dd></div> : null}<div><dt>风格底座</dt><dd>{selectedVersion?.styleName || RECIPES.find((item) => item.id === selectedVersion?.recipeId)?.name || "原始房间"}</dd></div><div><dt>模型</dt><dd>{selectedVersion?.modelId || "—"}</dd></div></dl>{selectedVersion?.status === "completed" && selectedVersion.imageUrl && <div className="choose-design-card"><strong>{shoppingList ? `${selectedVersionName} 已有购物清单` : `满意 ${selectedVersionName} 的设计？`}</strong><p>{shoppingList ? "进入该版本清单继续编辑、勾选购买或搜索商品。" : "选定后将对比 Original 与当前效果图，并在你确认后调用一次视觉模型生成版本购物清单。"}</p><button className="primary" disabled={(providerSettings?.runtimeReady !== true && !shoppingList) || shoppingGenerating || shoppingLoading || Boolean(activeRun) || Boolean(project.isArchived && !shoppingList)} onClick={() => void chooseCurrentDesignForShopping()}>{shoppingList ? "查看当前版本购物清单" : project.isArchived ? "恢复项目后生成购物清单" : shoppingLoading ? "正在检查购物清单…" : "选定此设计并生成购物清单"}</button></div>}</div>
              <div className="inspector-section revision-box"><h3>继续修改</h3><p>{project.isArchived ? "归档项目为只读状态，恢复后才能继续修改。" : "只写需要变化的内容，未请求部分会要求保持。"}</p><textarea value={revision} disabled={project.isArchived} onChange={(event) => setRevision(event.target.value)} placeholder="例如：地毯换成浅暖灰，保留窗帘，其他全部不变。" /><button className="primary" disabled={providerSettings?.runtimeReady !== true || project.isArchived || !revision.trim() || selectedVersionId === "original" || Boolean(activeRun)} onClick={() => void createRevision()}>{providerSettings?.runtimeReady !== true ? "请先配置 AI Provider" : "创建新版本"}</button>{selectedVersionId === "original" && !project.isArchived && <small>请先选择一个成功设计版本作为修改基础。</small>}</div>
              {abnormalVersions.length > 0 && <div className="failure-section"><h3>异常任务</h3>{[...abnormalVersions].reverse().map((version) => <div className="failure-card" key={version.versionId}><div className="failure-heading"><span className={`version-status ${version.displayStatus}`} /><div><strong>{versionLabel(version)} · {failureStatusLabel(version.displayStatus)}</strong><small>{version.failureStage ? `停止于：${STAGE_LABELS[version.failureStage] || version.failureStage}` : "未记录失败阶段"}</small></div></div><p>{version.error || "任务未正常完成。"}</p>{version.retryBlockedReason && <p className="retry-blocked">{version.retryBlockedReason}</p>}{version.retryable && !project.isArchived && <button className="retry-button" disabled={providerSettings?.runtimeReady !== true || Boolean(activeRun)} onClick={() => void retryVersion(version.versionId)}>↻ {providerSettings?.runtimeReady !== true ? "请先配置 AI Provider" : "重新尝试并创建新版本"}</button>}</div>)}</div>}
              <div className="version-history"><h3>版本历史</h3>{[...project.versions].reverse().map((version) => <button key={version.versionId} disabled={!version.imageUrl} onClick={() => version.imageUrl && selectVersion(version.versionId)}><span className={`version-status ${version.displayStatus}`} /> <div><strong>{versionLabel(version)}{version.retryOfVersionId ? ` · 重试 ${version.retryOfVersionId.toUpperCase()}` : ""}</strong><small>{version.operation === "revision" ? `基于 ${version.parentVersionId?.toUpperCase()}` : version.operation === "retry" ? "安全重试" : "首次设计"} · {formatDate(version.createdAt)}</small></div><em>{failureStatusLabel(version.displayStatus)}</em></button>)}</div>
              </> : <div className="shopping-panel">
                <div className="shopping-heading"><div><h3>{selectedVersion ? `${selectedVersionName} 购物清单` : "购物清单"}</h3><p>清单与当前成功版本绑定，切换版本后会读取对应清单。</p></div>{shoppingList && <span>修订 {shoppingList.revision}</span>}</div>
                {selectedVersionId === "original" || !selectedVersion || selectedVersion.status !== "completed" || !selectedVersion.imageUrl ? <div className="shopping-empty"><span>◇</span><strong>请选择一个成功设计版本</strong><p>Original、失败、取消和中断版本不能生成购物清单。</p></div> : shoppingLoading ? <div className="shopping-empty"><strong>正在读取本地购物清单…</strong></div> : !shoppingList ? <div className="shopping-empty"><span>🛒</span><strong>{selectedVersionName} 还没有购物清单</strong><p>首次生成会把 Original 和当前效果图发送给视觉模型，只提取通用家具软装，不识别品牌、价格或精确尺寸。</p><button className="primary" disabled={providerSettings?.runtimeReady !== true || project.isArchived || shoppingGenerating || Boolean(activeRun)} onClick={() => void generateCurrentShoppingList()}>{providerSettings?.runtimeReady !== true ? "请先配置 AI Provider" : project.isArchived ? "归档项目不能生成" : "生成购物清单"}</button></div> : <>
                  <div className="shopping-summary"><p>{shoppingList.summary}</p><div><span>采用 {shoppingIncludedCount} 项</span><span>已购买 {shoppingPurchasedCount} 项</span><span>版本 {shoppingList.versionId.toUpperCase()}</span></div></div>
                  <div className="shopping-toolbar"><button className="ghost" disabled={providerSettings?.runtimeReady !== true || project.isArchived || shoppingGenerating || Boolean(activeRun)} onClick={() => void generateCurrentShoppingList()}>重新分析</button><button className="primary" disabled={project.isArchived || !shoppingDirty || shoppingSaving || shoppingGenerating} onClick={() => void saveCurrentShoppingList()}>{shoppingSaving ? "保存中…" : shoppingDirty ? "保存修改" : "已保存"}</button></div>
                  {shoppingDirty && <p className="shopping-unsaved">有未保存修改；保存后才能使用最新搜索词。</p>}
                  <div className="shopping-items">{shoppingList.items.map((item) => <div className={`shopping-item ${item.included ? "" : "excluded"}`} key={item.id}>
                    <div className="shopping-item-title"><label><input type="checkbox" checked={item.included} disabled={project.isArchived} onChange={(event) => updateShoppingItem(item.id, { included: event.target.checked })} /><span>{item.included ? "采用" : "不采用"}</span></label><span className={`priority priority-${item.priority}`}>{item.priority === "high" ? "高优先" : item.priority === "low" ? "低优先" : "中优先"}</span></div>
                    <label>名称<input value={item.name} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { name: event.target.value })} /></label>
                    <div className="shopping-row"><label>动作<select value={item.action} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { action: event.target.value as "replace" | "add" })}><option value="replace">替换</option><option value="add">新增</option></select></label><label>数量<input type="number" min="1" max="20" value={item.quantity} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { quantity: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label><label>优先级<select value={item.priority} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { priority: event.target.value as ShoppingItem["priority"] })}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label></div>
                    <div className="shopping-row"><label>颜色<input value={item.color} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { color: event.target.value })} /></label><label>材质<input value={item.material} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { material: event.target.value })} /></label></div>
                    <label>款式特征<input value={item.style} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { style: event.target.value })} /></label>
                    <label>尺寸选择注意事项<textarea value={item.sizeGuidance} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { sizeGuidance: event.target.value })} /></label>
                    <label>购物搜索词<input value={item.searchKeywords} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { searchKeywords: event.target.value })} /></label>
                    <label>我的备注<textarea value={item.notes} disabled={project.isArchived || !item.included} placeholder="例如：预算上限、偏好店铺、需现场复尺" onChange={(event) => updateShoppingItem(item.id, { notes: event.target.value })} /></label>
                    <div className="shopping-search-box">
                      <div className="shopping-search-heading"><strong>组合搜索</strong><small>由已保存字段本地组合，不调用模型</small></div>
                      <div className="shopping-search-modes">{SHOPPING_SEARCH_MODES.map((mode) => <button key={mode.id} className={(shoppingSearchModes[item.id] || "broad") === mode.id ? "active" : ""} disabled={!item.included || shoppingDirty} onClick={() => setShoppingSearchModes((current) => ({ ...current, [item.id]: mode.id }))}>{mode.label}</button>)}</div>
                      <div className="shopping-platforms">{SHOPPING_SEARCH_PLATFORMS.map((platform) => <button key={platform.id} disabled={!item.included || shoppingDirty} onClick={() => void searchShoppingItem(item, platform.id)}>{platform.label} ↗</button>)}<button disabled={!item.included || shoppingDirty} onClick={() => void copyShoppingItemKeywords(item)}>复制搜索词</button></div>
                    </div>
                    <div className="shopping-item-actions"><label><input type="checkbox" checked={item.purchased} disabled={project.isArchived || !item.included} onChange={(event) => updateShoppingItem(item.id, { purchased: event.target.checked })} /><span>已购买</span></label><small>{shoppingDirty ? "请先保存再搜索" : "平台页面可能要求登录；住颜 AI 不读取电商账号或商品数据"}</small></div>
                  </div>)}</div>
                  <p className="shopping-disclaimer">{shoppingList.disclaimer}</p>
                </>}
              </div>}
            </aside>
          </section>
        )}
      </main>

      {activeRun && <GenerationOverlay run={activeRun} onCancel={() => void window.zhuyan.cancelRun(activeRun.runId)} />}
      {shoppingGenerating && <ShoppingListOverlay stage={shoppingStage} message={shoppingProgress} onCancel={() => void window.zhuyan.cancelShoppingList()} />}
    </div>
  );
}

function CompareCanvas({ original, design, position, onPosition, versionName }: { original: string; design: string; position: number; onPosition: (position: number) => void; versionName: string }) {
  return <div className="design-canvas compare-canvas">
    <img className="compare-original" src={original} alt="原始房间" />
    <div className="compare-design-clip" style={{ clipPath: `inset(0 0 0 ${position}%)` }}><img src={design} alt={`${versionName} 设计图`} /></div>
    <div className="compare-divider" style={{ left: `${position}%` }}><span>↔</span></div>
    <input className="compare-range" type="range" min="0" max="100" value={position} aria-label="拖动比较原图和设计图" onChange={(event) => onPosition(Number(event.target.value))} />
    <span className="compare-label before">Original</span><span className="compare-label after">{versionName}</span>
  </div>;
}

function PanelTitle({ number, title, note }: { number: string; title: string; note: string }) {
  return <div className="panel-title"><span>{number}</span><div><h2>{title}</h2><p>{note}</p></div></div>;
}

function EmptyState({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span>◇</span><h2>{title}</h2>{action && <button className="primary" onClick={onAction}>{action}</button>}</div>;
}

function ShoppingListOverlay({ stage, message, onCancel }: { stage: ShoppingListEvent["stage"]; message: string; onCancel: () => void }) {
  const stageIndex = stage === "validating_shopping_list" ? 0 : stage === "analyzing_shopping_list" ? 1 : 2;
  const labels = ["验证项目与版本", "对比 Original 与效果图", "保存版本购物清单"];
  return <div className="overlay"><div className="generation-card shopping-generation-card"><div className="pi-orbit"><span>清单</span></div><span className="eyebrow">REAL VISUAL ANALYSIS</span><h2>{stageIndex === 0 ? "正在验证成功设计版本" : stageIndex === 1 ? "正在提取家具与软装" : "正在保存购物清单"}</h2><p>{message}</p><div className="shopping-analysis-stages">{labels.map((label, index) => <div className={index < stageIndex ? "done" : index === stageIndex ? "active" : ""} key={label}><span>{index < stageIndex ? "✓" : index + 1}</span><em>{label}</em></div>)}</div><div className="progress-note">这里不显示模拟百分比。只有本次首次分析会调用视觉模型，编辑、勾选、保存和购物搜索均不调用模型。</div><button className="ghost danger" onClick={onCancel}>取消购物清单分析</button></div></div>;
}

function GenerationOverlay({ run, onCancel }: { run: RunEvent; onCancel: () => void }) {
  const stage = run.stage || "starting";
  const stages = ["validating_input", "loading_style_recipe", "building_generation_prompt", "reserving_version", "submitting_generation_request", "saving_version"];
  const cancelling = run.type === "cancelling";
  const activeIndex = cancelling ? -1 : Math.max(0, stages.indexOf(stage));
  return <div className="overlay"><div className="generation-card"><div className={`pi-orbit ${cancelling ? "cancelling" : ""}`}><span>PI</span></div><span className="eyebrow">REAL TOOL PROGRESS</span><h2>{STAGE_LABELS[stage] || "正在处理设计"}</h2><p>{run.message || "请稍候，住颜 AI 正在处理你的房间。"}</p><div className="stage-list">{stages.map((item, index) => <div className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={item}><span>{index < activeIndex ? "✓" : index + 1}</span><em>{STAGE_LABELS[item]}</em></div>)}</div><div className="progress-note">{cancelling ? "正在等待主进程确认请求终止，请不要重复提交任务。" : "这里不显示模拟百分比，每一步都来自 Pi Tool 的真实事件。"}</div><button className="ghost danger" disabled={cancelling} onClick={onCancel}>{cancelling ? "正在取消……" : "取消生成"}</button></div></div>;
}
