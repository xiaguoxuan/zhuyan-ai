export const IPC = {
  selectRoomImage: "zhuyan:select-room-image",
  selectReferenceImage: "zhuyan:select-reference-image",
  analyzeReferenceStyle: "zhuyan:analyze-reference-style",
  analyzeReferenceFurnishingSet: "zhuyan:analyze-reference-furnishing-set",
  cancelReferenceAnalysis: "zhuyan:cancel-reference-analysis",
  listProjects: "zhuyan:list-projects",
  getProject: "zhuyan:get-project",
  manageProject: "zhuyan:manage-project",
  generateShoppingList: "zhuyan:generate-shopping-list",
  getShoppingList: "zhuyan:get-shopping-list",
  saveShoppingList: "zhuyan:save-shopping-list",
  cancelShoppingList: "zhuyan:cancel-shopping-list",
  openShoppingSearch: "zhuyan:open-shopping-search",
  copyShoppingKeywords: "zhuyan:copy-shopping-keywords",
  startDesign: "zhuyan:start-design",
  startRevision: "zhuyan:start-revision",
  retryVersion: "zhuyan:retry-version",
  cancelRun: "zhuyan:cancel-run",
  downloadVersion: "zhuyan:download-version",
  getProviderSettings: "zhuyan:get-provider-settings",
  testProviderSettings: "zhuyan:test-provider-settings",
  saveProviderSettings: "zhuyan:save-provider-settings",
  clearProviderSettings: "zhuyan:clear-provider-settings",
  runEvent: "zhuyan:run-event",
  referenceAnalysisEvent: "zhuyan:reference-analysis-event",
  shoppingListEvent: "zhuyan:shopping-list-event",
} as const;

export type DesignConstraints = {
  keepItems: string[];
  allowedChanges: string[];
  forbiddenChanges: string[];
  rentalFriendly: boolean;
  allowWallArt: boolean;
};

export type SelectedRoomImage = {
  token: string;
  name: string;
  previewUrl: string;
};

export type ReferenceStyleItem = {
  category: string;
  description: string;
  traits: string[];
  color: string | null;
  material: string | null;
  guidance: string | null;
};

export type ReferenceStyleAnalysis = {
  token: string;
  styleName: string;
  styleSummary: string;
  confidence: "low" | "medium" | "high";
  roomType: string;
  imageQuality: "poor" | "fair" | "good";
  imageNotes: string;
  palette: Array<{ name: string; hex: string | null; ratioPercent: number; role: string }>;
  materials: ReferenceStyleItem[];
  furnitureLanguage: string[];
  furniture: ReferenceStyleItem[];
  softFurnishings: ReferenceStyleItem[];
  lighting: ReferenceStyleItem[];
  decorationDensity: string;
  transferableElements: ReferenceStyleItem[];
  doNotCopy: string[];
  warnings: string[];
  recommendedBaseRecipeId: string;
};

export type ReferenceFurnishingItem = {
  id: string;
  category: string;
  name: string;
  visualDescription: string;
  silhouette: string;
  color: string;
  material: string;
  relativePosition: string;
  groupRelationship: string;
  replacementTarget: string;
  recommendedAction: "replace" | "add";
  transferGuidance: string;
  defaultSelected: boolean;
  artworkLike: boolean;
  confidence: "low" | "medium" | "high";
  warnings: string[];
};

export type ReferenceFurnishingSetAnalysis = {
  token: string;
  setName: string;
  setSummary: string;
  confidence: "low" | "medium" | "high";
  roomType: string;
  imageQuality: "poor" | "fair" | "good";
  imageNotes: string;
  palette: Array<{ name: string; hex: string | null; ratioPercent: number; role: string }>;
  items: ReferenceFurnishingItem[];
  doNotCopy: string[];
  warnings: string[];
  recommendedBaseRecipeId: string;
};

export type CustomStyleSelection = {
  analysisToken: string;
  usePalette: boolean;
  useMaterials: boolean;
  useFurnitureLanguage: boolean;
  useSoftFurnishings: boolean;
  useLighting: boolean;
  selectedTransferableElements: string[];
};

export type FurnishingItemSelection = {
  itemId: string;
  action: "replace" | "add";
};

export type FurnishingSetSelection = {
  analysisToken: string;
  referenceImageToken: string;
  rightsConfirmedForGeneration: boolean;
  selectedItems: FurnishingItemSelection[];
  keepAirConditioner: boolean;
  keepFloor: boolean;
  keepCeilingArchitecture: boolean;
  replaceCeilingLight: boolean;
  removeWallSconces: boolean;
  allowWallColorChange: boolean;
  allowGenericWallArt: boolean;
};

export type StartDesignInput = DesignConstraints & {
  sourceImageToken: string;
  recipeId: string;
  customStyle?: CustomStyleSelection;
  furnishingSet?: FurnishingSetSelection;
  projectId?: string;
  projectTitle?: string;
  userInstructions?: string;
};

export type StartRevisionInput = Partial<DesignConstraints> & {
  projectId: string;
  baseVersionId?: string;
  revisionInstructions: string;
};

export type ProjectSummary = {
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceImageUrl: string | null;
  latestCompletedVersionId: string | null;
  latestImageUrl: string | null;
  versionCount: number;
  completedVersionCount: number;
  pendingVersionCount: number;
  failedVersionCount: number;
  interruptedVersionCount: number;
  archivedAt: string | null;
  isArchived: boolean;
};

export type DesignVersion = {
  versionId: string;
  versionNumber: number;
  status: "pending" | "completed" | "failed";
  displayStatus: "pending" | "completed" | "failed" | "cancelled" | "interrupted";
  operation: "redesign" | "revision" | "retry";
  parentVersionId: string | null;
  recipeId: string;
  styleName: string | null;
  styleSource: "curated_recipe" | "extracted_text_recipe" | "reference_furnishing_set";
  selectedItemCount: number | null;
  selectedReplaceCount: number | null;
  selectedAddCount: number | null;
  createdAt: string;
  completedAt: string | null;
  imageUrl: string | null;
  providerId: string | null;
  modelId: string | null;
  requestedSize: string | null;
  quality: string | null;
  inputFidelity: string | null;
  outputSha256: string | null;
  error: string | null;
  failureKind: "error" | "cancelled" | "interrupted" | null;
  failureStage: string | null;
  retryOfVersionId: string | null;
  retryable: boolean;
  retryBlockedReason: string | null;
};

export type DesignProject = {
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  isArchived: boolean;
  source: {
    imageUrl: string | null;
    filename: string;
    sha256: string;
    bytes: number;
    format: string;
  };
  latestCompletedVersionId: string | null;
  nextVersionNumber: number;
  counts: { completed: number; pending: number; failed: number; interrupted: number };
  versions: DesignVersion[];
};

export type ProjectListFilter = "active" | "archived" | "all";

export type ManageProjectAction = "rename" | "archive" | "restore";

export type ManageProjectResult = {
  projectId: string;
  title: string;
  action: ManageProjectAction;
  archivedAt: string | null;
  isArchived: boolean;
  updatedAt: string;
};

export type ShoppingItem = {
  id: string;
  category: string;
  name: string;
  action: "replace" | "add";
  quantity: number;
  priority: "high" | "medium" | "low";
  color: string;
  material: string;
  style: string;
  sizeGuidance: string;
  searchKeywords: string;
  notes: string;
  included: boolean;
  purchased: boolean;
  confidence: "low" | "medium" | "high";
};

export type ShoppingList = {
  projectId: string;
  versionId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  generatedAt: string;
  providerId: string;
  modelId: string;
  summary: string;
  disclaimer: string;
  items: ShoppingItem[];
};

export type ShoppingSearchPlatform = "taobao" | "jd" | "1688" | "pdd";

export type ShoppingSearchMode = "precise" | "broad" | "material";

export type ShoppingSearchResult = {
  platform: ShoppingSearchPlatform;
  mode: ShoppingSearchMode;
  keywords: string;
};

export type ShoppingKeywordsResult = {
  mode: ShoppingSearchMode;
  keywords: string;
};

export type ShoppingListEvent = {
  type: "started" | "progress" | "completed" | "failed" | "cancelled";
  stage: "validating_shopping_list" | "analyzing_shopping_list" | "shopping_list_completed" | "failed" | "cancelled";
  message: string;
  projectId?: string;
  versionId?: string;
};

export type DownloadVersionResult = {
  status: "saved" | "cancelled";
  fileName?: string;
};

export type ProviderSettingsSource = "byok" | "development_fallback" | "unconfigured";

export type ProviderSettingsView = {
  configured: boolean;
  source: ProviderSettingsSource;
  baseUrl: string | null;
  visionModel: string;
  imageModel: string;
  hasApiKey: boolean;
  secureStorageAvailable: boolean;
  runtimeReady: boolean;
  error: string | null;
  updatedAt: string | null;
};

export type ProviderSettingsInput = {
  baseUrl: string;
  apiKey?: string;
  visionModel: string;
  imageModel: string;
};

export type ProviderConnectionTestInput = ProviderSettingsInput;

export type ProviderConnectionTestResult = {
  ok: true;
  message: string;
  modelsEndpointSupported: boolean;
  visionModelFound: boolean;
  imageModelFound: boolean;
  availableModelCount: number;
};

export type ReferenceAnalysisEvent = {
  type: "started" | "progress" | "completed" | "failed" | "cancelled";
  stage: "validating_reference" | "analyzing_reference" | "reference_analysis_completed" | "failed" | "cancelled";
  message: string;
};

export type RunEvent = {
  runId: string;
  type: "started" | "progress" | "cancelling" | "completed" | "failed" | "cancelled";
  stage?: string;
  message?: string;
  projectId?: string;
  versionId?: string;
  project?: DesignProject;
};

export type ZhuyanDesktopApi = {
  selectRoomImage(): Promise<SelectedRoomImage | null>;
  selectReferenceImage(): Promise<SelectedRoomImage | null>;
  analyzeReferenceStyle(referenceImageToken: string, rightsConfirmed: boolean): Promise<ReferenceStyleAnalysis>;
  analyzeReferenceFurnishingSet(referenceImageToken: string, rightsConfirmed: boolean): Promise<ReferenceFurnishingSetAnalysis>;
  cancelReferenceAnalysis(): Promise<boolean>;
  listProjects(limit?: number, filter?: ProjectListFilter): Promise<ProjectSummary[]>;
  getProject(projectId: string): Promise<DesignProject>;
  manageProject(projectId: string, action: ManageProjectAction, title?: string): Promise<ManageProjectResult>;
  generateShoppingList(projectId: string, versionId: string, replaceExisting?: boolean): Promise<ShoppingList>;
  getShoppingList(projectId: string, versionId: string): Promise<ShoppingList | null>;
  saveShoppingList(shoppingList: ShoppingList): Promise<ShoppingList>;
  cancelShoppingList(): Promise<boolean>;
  openShoppingSearch(projectId: string, versionId: string, itemId: string, platform: ShoppingSearchPlatform, mode: ShoppingSearchMode): Promise<ShoppingSearchResult>;
  copyShoppingKeywords(projectId: string, versionId: string, itemId: string, mode: ShoppingSearchMode): Promise<ShoppingKeywordsResult>;
  startDesign(input: StartDesignInput): Promise<{ runId: string }>;
  startRevision(input: StartRevisionInput): Promise<{ runId: string }>;
  retryVersion(projectId: string, failedVersionId: string): Promise<{ runId: string }>;
  cancelRun(runId: string): Promise<boolean>;
  downloadVersion(projectId: string, versionId: string): Promise<DownloadVersionResult>;
  getProviderSettings(): Promise<ProviderSettingsView>;
  testProviderSettings(input: ProviderConnectionTestInput): Promise<ProviderConnectionTestResult>;
  saveProviderSettings(input: ProviderSettingsInput): Promise<ProviderSettingsView>;
  clearProviderSettings(): Promise<ProviderSettingsView>;
  onReferenceAnalysisEvent(listener: (event: ReferenceAnalysisEvent) => void): () => void;
  onShoppingListEvent(listener: (event: ShoppingListEvent) => void): () => void;
  onRunEvent(listener: (event: RunEvent) => void): () => void;
};
