import { randomUUID } from "node:crypto";
import path from "node:path";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ProviderRuntimeSettings } from "./provider-settings.js";

const BUSINESS_TOOLS = [
  "extract_reference_style",
  "extract_reference_furnishing_set",
  "retrieve_style_recipe",
  "recover_interrupted_design_runs",
  "list_design_projects",
  "get_design_project",
  "manage_design_project",
  "extract_furnishing_items",
  "get_furnishing_list",
  "save_furnishing_list",
  "retry_room_design",
  "redesign_room",
  "revise_room_design",
] as const;

type BusinessToolName = typeof BUSINESS_TOOLS[number];
type ToolUpdate = { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> };
type ToolResult = { content: Array<{ type: string; text?: string }>; details: Record<string, unknown> };
type ExecutableTool = {
  name: string;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: ToolUpdate) => void,
  ): Promise<ToolResult>;
};

export class PiBusinessRuntime {
  private sessionPromise: Promise<AgentSession> | undefined;
  private activeExecutions = 0;

  constructor(
    private readonly cwd: string,
    private readonly agentDir: string,
    private readonly providerSettings?: ProviderRuntimeSettings,
    private readonly bundledExtensionPath?: string,
  ) {}

  private async createSession(): Promise<AgentSession> {
    const settingsManager = this.bundledExtensionPath
      ? SettingsManager.inMemory({ defaultThinkingLevel: "off" })
      : SettingsManager.create(this.cwd, this.agentDir);
    const modelRuntime = this.providerSettings
      ? await ModelRuntime.create({
          credentials: new InMemoryCredentialStore(),
          modelsPath: null,
        })
      : await ModelRuntime.create({
          authPath: path.join(this.agentDir, "auth.json"),
          modelsPath: path.join(this.agentDir, "models.json"),
        });
    let runtimeModel: Model<Api> | undefined;
    if (this.providerSettings) {
      const modelIds = [...new Set([this.providerSettings.visionModel, this.providerSettings.imageModel])];
      modelRuntime.registerProvider(this.providerSettings.providerId, {
        name: "住颜 AI 用户 Provider",
        baseUrl: this.providerSettings.baseUrl,
        api: "openai-completions",
        authHeader: true,
        models: modelIds.map((id) => ({
          id,
          name: id,
          api: "openai-completions",
          reasoning: false,
          input: ["text", "image"] as ("text" | "image")[],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384,
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
        })),
      });
      await modelRuntime.setRuntimeApiKey(this.providerSettings.providerId, this.providerSettings.apiKey);
      runtimeModel = modelRuntime.getModel(this.providerSettings.providerId, this.providerSettings.visionModel);
      if (!runtimeModel) throw new Error("无法注册当前视觉分析模型");
    }
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager,
      additionalExtensionPaths: this.bundledExtensionPath ? [this.bundledExtensionPath] : undefined,
      noSkills: Boolean(this.bundledExtensionPath),
      noPromptTemplates: Boolean(this.bundledExtensionPath),
      noThemes: Boolean(this.bundledExtensionPath),
      noContextFiles: Boolean(this.bundledExtensionPath),
    });
    await resourceLoader.reload();
    const { session, extensionsResult } = await createAgentSession({
      cwd: this.cwd,
      agentDir: this.agentDir,
      modelRuntime,
      model: runtimeModel,
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.inMemory(this.cwd),
      tools: [...BUSINESS_TOOLS],
      thinkingLevel: "off",
    });
    if (extensionsResult.errors.length > 0) {
      session.dispose();
      throw new Error(`Pi 扩展加载失败：${extensionsResult.errors.map((item) => path.basename(item.path)).join("、")}`);
    }
    const registered = new Set(session.agent.state.tools.map((tool) => tool.name));
    const missing = BUSINESS_TOOLS.filter((name) => !registered.has(name));
    if (missing.length > 0) {
      session.dispose();
      throw new Error(`住颜业务工具未加载：${missing.join("、")}`);
    }
    return session;
  }

  private session(): Promise<AgentSession> {
    this.sessionPromise ||= this.createSession().catch((error) => {
      this.sessionPromise = undefined;
      throw error;
    });
    return this.sessionPromise;
  }

  isBusy(): boolean {
    return this.activeExecutions > 0;
  }

  async execute(
    name: BusinessToolName,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: ToolUpdate) => void,
  ): Promise<ToolResult> {
    if (!BUSINESS_TOOLS.includes(name)) throw new Error(`不允许调用工具：${name}`);
    this.activeExecutions += 1;
    try {
      const session = await this.session();
      const tool = session.agent.state.tools.find((candidate) => candidate.name === name) as ExecutableTool | undefined;
      if (!tool) throw new Error(`找不到业务工具：${name}`);
      return await tool.execute(`desktop-${randomUUID()}`, params, signal, onUpdate);
    } finally {
      this.activeExecutions -= 1;
    }
  }

  async dispose(): Promise<void> {
    if (!this.sessionPromise) return;
    try {
      (await this.sessionPromise).dispose();
    } finally {
      this.sessionPromise = undefined;
    }
  }
}
