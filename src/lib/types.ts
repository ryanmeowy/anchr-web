export type ApiResult<T> = {
  code: number;
  message: string;
  errorCode?: string;
  data: T;
  traceId?: string;
  errorId?: string;
};

export type PagedList<T> = {
  items: T[];
  total: number;
  page: number;
  size: number;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description?: string;
  status: string;
  documentCount: number;
  segmentCount: number;
  lastIngestedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DocumentAsset = {
  id: string;
  kbId: string;
  fileName: string;
  title?: string;
  fileType?: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceUrl?: string;
  parseStatus: string;
  indexStatus: string;
  segmentCount: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RecentQuestion = {
  turnId: string;
  sessionId?: string | null;
  question?: string | null;
  kbScope?: string[];
  knowledgeBaseNames?: string[];
  createdAt?: string;
};

export type RecentCitation = {
  segmentId: string;
  assetId?: string | null;
  kbId?: string | null;
  fileName?: string | null;
  title?: string | null;
  snippet?: string | null;
  citationReason?: string | null;
  openedAt?: string;
};

export type RecentQuestionList = {
  items: RecentQuestion[];
  nextCursor?: string | null;
};

export type RecentCitationList = {
  items: RecentCitation[];
  nextCursor?: string | null;
};

export type HomeSummary = {
  favoriteKbs?: Array<{
    kbId: string;
    name: string;
    documentCount: number;
    segmentCount: number;
    updatedAt?: string;
  }>;
  recentQuestions?: RecentQuestion[];
  recentCitations?: RecentCitation[];
  recentIngestionTasks?: IngestionTaskSummary[];
  helpLinks?: Array<{
    title: string;
    url: string;
  }>;
  warnings?: string[];
  state?: {
    loading: boolean;
    empty: boolean;
    error: boolean;
  };
};

export type SupportedFormat = {
  fileType: string;
  extensions: string[];
  mimeTypes: string[];
  enabled: boolean;
  priority: string;
};

export type IngestionCapability = {
  supportedFormats: SupportedFormat[];
  maxFileSizeBytes: number;
  maxFilesPerBatch: number;
  dedupeStrategies: string[];
  defaultDedupeStrategy: string;
  ingestionStages: string[];
};

export type IngestionTaskSummary = {
  taskId: string;
  kbId: string;
  sourceType: string;
  status: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  runningCount: number;
  failureReason?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type IngestionTaskList = {
  items: IngestionTaskSummary[];
  nextCursor?: string;
};

export type IngestionTask = IngestionTaskSummary & {
  finishedAt?: string;
  items?: IngestionTaskItem[];
};

export type IngestionTaskItem = {
  itemId: string;
  assetId?: string | null;
  fileName?: string | null;
  fileHash?: string | null;
  sourceUrl?: string | null;
  stage: string;
  status: string;
  progress: number;
  dedupeResult?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  updatedAt?: string;
  finishedAt?: string | null;
};

export type StsToken = {
  endpoint: string;
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
  expiration: string;
};

export type UploadIngestionItem = {
  fileName: string;
  title?: string;
  fileType: string;
  mimeType?: string;
  sizeBytes?: number;
  objectKey: string;
  fileHash?: string;
};

export type SearchAssetType = "PDF" | "IMAGE" | "TXT" | "MARKDOWN";
export type SearchHitType = "TEXT" | "IMAGE" | "MIXED";
export type SearchStrategy = "KB_RRF" | "KB_RRF_RERANK";
export type SearchAnswerMode = "STRICT";

export type SearchRequest = {
  query: string;
  topK?: number;
  limit?: number;
  strategy?: SearchStrategy;
  kbIds?: string[];
  assetTypes?: SearchAssetType[];
  hitTypes?: SearchHitType[];
  dateRange?: {
    from?: number;
    to?: number;
  };
  cursor?: string;
  sort?: string;
  withAnswer?: boolean;
  answerMode?: SearchAnswerMode;
};

export type SearchResult = {
  segmentId?: string;
  kbId?: string;
  assetId?: string;
  sourceRef?: string;
  segmentType?: string;
  assetType: SearchAssetType;
  content?: string;
  snippet?: string;
  pageNo?: number;
  score?: number;
  thumbnail?: string;
  ocrSummary?: string;
  resultType?: SearchHitType;
  explain?: {
    strategyEffective?: string;
    hitSources?: string[];
    segments?: {
      keyword?: boolean;
      ocr?: boolean;
      tag?: boolean;
      vector?: boolean;
    };
  };
  anchor?: {
    pageNo?: number | null;
    chunkOrder?: number | null;
  };
  totalHits?: number;
  topChunks?: Array<{
    segmentId: string;
    snippet?: string;
    pageNo?: number | null;
    chunkOrder?: number | null;
  }>;
};

export type SearchAnswer = {
  answer?: string;
  citations?: Array<{
    citationIndex: number;
    segmentId: string;
    assetId?: string;
    kbId?: string;
    fileName?: string;
    pageNo?: number;
    snippet?: string;
  }>;
};

export type SearchPage = {
  items: SearchResult[];
  total: number;
  nextCursor?: string | null;
  facets?: {
    assetType?: Array<{
      value: SearchAssetType;
      count: number;
    }>;
  } | null;
  answer?: SearchAnswer | null;
};

export type PreviewSegment = {
  segmentId: string;
  assetId?: string;
  kbId?: string;
  assetType?: string;
  segmentType?: string;
  fileName?: string;
  previewType?: string;
  previewUrl?: string;
  expiresAt?: number;
  sourceRef?: string;
  thumbnail?: string;
  title?: string;
  snippet?: string;
  ocrSummary?: string;
  anchor?: {
    pageNo?: number;
    chunkOrder?: number;
    bbox?: unknown;
    imageWidth?: number;
    imageHeight?: number;
  };
  surroundingChunks?: Array<{
    segmentId: string;
    content?: string;
    snippet?: string;
    pageNo?: number;
    chunkOrder?: number;
    relation?: string;
  }>;
  citationContext?: {
    sourceQuestion?: string;
    answerClaim?: string;
    citationIndex?: number;
    citationReason?: string;
  };
};

// ── capability config ──────────────────────────────────────────────────

export type CapabilityConfig = {
  id: number;
  baseUrl: string;
  modelName?: string;
  extraConfig?: Record<string, unknown>;
  apiKeyMasked: string;
  enabled: boolean;
};

export type CapabilityConfigUpdateRequest = {
  baseUrl: string;
  apiKey?: string;
  modelName?: string;
  extraConfig?: Record<string, unknown>;
};

export type CapabilityConnectionTestRequest = {
  capability: string;
  baseUrl: string;
  apiKey?: string;
  modelName?: string;
  configId?: number;
};

export type CapabilityConnectionTestResult = {
  success: boolean;
  latencyMs: number;
  message: string;
  dimension?: number;
};

export type CapabilityParams = {
  params: ParamItem[];
};

export type ParamItem = {
  key: string;
  label: string;
};

// ── storage config ─────────────────────────────────────────────────────

export type StorageConfig = {
  id: number;
  endpoint: string;
  bucket: string;
  region?: string;
  prefix?: string;
  roleArn?: string;
  accessKeyMasked: string;
  secretKeyMasked: string;
  enabled: boolean;
};

export type StorageConfigUpdateRequest = {
  endpoint: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  region?: string;
  prefix?: string;
  roleArn?: string;
};

export type StorageConnectionTestResult = {
  success: boolean;
  latencyMs: number;
  message: string;
};

export type ConversationCitation = {
  fileName?: string;
  pageNo?: number;
  snippet?: string;
  hitType?: string;
  assetId?: string;
  segmentId?: string;
};

export type ConversationSession = {
  sessionId: string;
  userId?: string;
  title?: string | null;
  status?: string;
  lastMessagePreview?: string | null;
  kbScope?: string[];
  createdAt?: number;
  updatedAt?: number;
  expiresAt?: number;
};

export type ConversationSessionList = {
  items: ConversationSession[];
  nextCursor?: string | null;
};

export type ConversationTurn = {
  turnId: string;
  sessionId: string;
  query?: string;
  rewrittenQuery?: string;
  answer?: string;
  kbScope?: string[];
  answerMode?: string;
  citations?: ConversationCitation[];
  resultCards?: Array<{
    assetId?: string;
    assetType?: string;
    fileName?: string;
    title?: string;
    score?: number;
    hitCount?: number;
    primaryHit?: {
      segmentId?: string;
      snippet?: string;
      score?: number;
      pageNo?: number;
      anchor?: unknown;
      hitType?: string;
    };
    additionalHits?: Array<{
      segmentId?: string;
      snippet?: string;
      score?: number;
      pageNo?: number;
      anchor?: unknown;
      hitType?: string;
    }>;
  }>;
  createdAt?: number;
};

export type ConversationMessageList = {
  sessionId: string;
  turns: ConversationTurn[];
};

export type ConversationMessage = {
  sessionId?: string;
  turnId?: string;
  title?: string | null;
  rewrittenQuery?: string;
  answer?: string;
  kbScope?: string[];
  answerMode?: string;
  retrievalStage?: string;
  citations?: ConversationCitation[];
  suggestedQuestions?: string[];
  createdAt?: number;
};
