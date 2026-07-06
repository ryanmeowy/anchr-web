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

export type KnowledgeBaseQueryRequest = {
  keyword?: string;
  status?: string;
  updateAfter?: string;
  updateBefore?: string;
  page?: number;
  size?: number;
};

export type KnowledgeBaseUpdateRequest = {
  name: string;
  description?: string;
};

export type KnowledgeBaseListResponse = PagedList<KnowledgeBase>;

export type KnowledgeBaseStats = {
  kbId: string;
  documentCount: number;
  segmentCount: number;
  lastIngestedAt?: string | null;
  lastIngestionStatus?: string | null;
  lastIngestionTotalCount: number;
  lastIngestionSuccessCount: number;
  lastIngestionFailureCount: number;
  lastIngestionRunningCount: number;
  updatedAt?: string | null;
};

export type KnowledgeBaseHealthDocuments = {
  total: number;
  indexed: number;
  pending: number;
  failed: number;
};

export type KnowledgeBaseHealthSegments = {
  total: number;
  indexed: number;
};

export type KnowledgeBaseHealthSourceType = {
  type: string;
  label: string;
  count: number;
  percentage: number;
};

export type KnowledgeBaseHealth = {
  kbId: string;
  kbName: string;
  status: string;
  score: number;
  documents: KnowledgeBaseHealthDocuments;
  segments: KnowledgeBaseHealthSegments;
  sourceTypes: KnowledgeBaseHealthSourceType[];
};

export type ElasticsearchHealthIndices = {
  count: number;
  docsCount: number;
  storeSizeBytes: number;
};

export type ElasticsearchHealth = {
  connected: boolean;
  status?: "green" | "yellow" | "red" | string | null;
  clusterName?: string | null;
  nodeCount?: number;
  dataNodeCount?: number;
  activeShards?: number;
  activePrimaryShards?: number;
  unassignedShards?: number;
  initializingShards?: number;
  relocatingShards?: number;
  indices?: ElasticsearchHealthIndices | null;
  version?: string | null;
  error?: string | null;
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
  recordId?: string;
  segmentId: string;
  assetId?: string | null;
  kbId?: string | null;
  kbName?: string | null;
  fileName?: string | null;
  title?: string | null;
  snippet?: string | null;
  citationReason?: string | null;
  openedAt?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sessionId?: string | null;
  citationIndex?: string | null;
  question?: string | null;
};

export type RecentSearch = {
  query: string;
  kbIds: string[];
  knowledgeBaseNames?: string[];
  total: number;
  searchedAt?: string;
  assetTypes?: string[];
  dateRange?: {
    from?: number | null;
    to?: number | null;
  } | null;
  withAnswer?: boolean | null;
  answerMode?: string | null;
};

export type ConversationAnswerMode = "STRICT" | "SUMMARY" | "EXPLORE";

export type RecentQuestionList = {
  items: RecentQuestion[];
  nextCursor?: string | null;
};

export type RecentCitationList = {
  items: RecentCitation[];
  nextCursor?: string | null;
};

export type RecentSearchList = {
  items: RecentSearch[];
  nextCursor?: string | null;
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

export type SearchAssetType = string;
export type SearchHitType = "TEXT_CHUNK" | "IMAGE_OCR_BLOCK";
export type SearchResultType = "TEXT" | "IMAGE" | "MIXED";
export type SearchStrategy = "KB_RRF" | "KB_RRF_RERANK";
export type SearchAnswerMode = "STRICT";

export type SearchRequest = {
  query: string;
  limit?: number;
  strategy?: SearchStrategy;
  kbIds?: string[];
  assetIdList?: string[];
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
  resultType?: SearchResultType;
  explain?: {
    strategyEffective?: string;
    hitSources?: string[];
    segments?: {
      keyword?: boolean;
      ocr?: boolean;
      tag?: boolean;
      vector?: boolean;
    };
    matchedBy?: {
      vector?: boolean;
      title?: boolean;
      content?: boolean;
      ocr?: boolean;
    };
    textSignals?: {
      semantic?: boolean;
      keyword?: boolean;
      pageHit?: boolean;
      chunkHit?: boolean;
    };
    imageSignals?: {
      vector?: boolean;
      ocr?: boolean;
      caption?: boolean;
      tag?: boolean;
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
    why?: {
      score?: number | null;
      hitSources?: string[];
      matchedBy?: {
        vector?: boolean;
        title?: boolean;
        content?: boolean;
        ocr?: boolean;
      } | null;
      matchSummary?: string | null;
    } | null;
  }>;
};

export type SearchInsight = {
  pipeline?: {
    keywordCandidates?: number;
    vectorCandidates?: number;
    fusedRetained?: number;
    rerankAdopted?: number;
  } | null;
  relevanceDistribution?: {
    high?: number;
    medium?: number;
    low?: number;
  } | null;
  risk?: {
    lowRelevanceCount?: number;
  } | null;
  hitSourceDistribution?: {
    vectorCount?: number;
    contentCount?: number;
    ocrCount?: number;
    tagCount?: number;
    titleCount?: number;
  } | null;
  queryIntent?: {
    intent?: string | null;
    category?: string | null;
    fallback?: boolean;
  } | null;
  latencyMs?: number | null;
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
    assetTypes?: Array<{
      value: SearchAssetType;
      count: number;
    }>;
    hitTypes?: Array<{
      value: SearchHitType;
      count: number;
    }>;
  } | null;
  answer?: SearchAnswer | null;
  rewrittenKeywords?: string[] | null;
  suggestedQuestions?: string[] | null;
  insight?: SearchInsight | null;
};

export type PreviewCitationInfo = {
  segmentId?: string;
  citationIndex?: string;
  reason?: string;
  why?: {
    score?: string;
    hitSources?: string[];
    matchSummary?: string;
  };
};

export type PreviewRequest = {
  recordId?: string;
  sourceType?: "ASK" | "SEARCH";
  sourceId?: string;
  sessionId?: string;
  question?: string;
  citationInfo?: PreviewCitationInfo;
};

export type PreviewSegment = {
  segmentId: string;
  assetId?: string;
  kbId?: string;
  kbName?: string;
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
    bbox?: PreviewBBoxRecord[] | null;
    imageWidth?: number;
    imageHeight?: number;
  };
  surroundingChunks?: Array<{
    segmentId: string;
    content?: string;
    snippet?: string;
    title?: string;
    pageNo?: number;
    chunkOrder?: number;
    relation?: string;
    bbox?: PreviewBBoxRecord[] | null;
  }>;
  citationContext?: {
    sourceQuestion?: string;
    answerClaim?: string;
    citationIndex?: number;
    citationReason?: string;
  };
};

export type PreviewBBox = {
  l: number;
  t: number;
  r: number;
  b: number;
  coordOrigin?: string;
  coord_origin?: string;
};

export type PreviewBBoxRecord = {
  bbox?: PreviewBBox | null;
  pageNo?: number | null;
};

// ── capability config ──────────────────────────────────────────────────

export type CapabilityConfig = {
  id: number;
  baseUrl?: string | null;
  modelName?: string | null;
  extraConfig?: Record<string, unknown> | null;
  apiKeyMasked?: string | null;
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
  extraConfig?: Record<string, unknown>;
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
  why?: {
    score?: number | null;
    hitSources?: string[];
    matchSummary?: string | null;
  } | null;
};

export type ConversationSession = {
  sessionId: string;
  userId?: string;
  title?: string | null;
  status?: string;
  lastMessagePreview?: string | null;
  kbScope?: string[];
  assetScope?: string[];
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
  assetScope?: string[];
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
  assetScope?: string[];
  answerMode?: string;
  retrievalStage?: string;
  citations?: ConversationCitation[];
  suggestedQuestions?: string[];
  createdAt?: number;
};
export type SegmentIndexStatus = {
  status: "NOT_READY" | "INITIALIZING" | "READY" | "REBUILDING";
  indexExists: boolean;
  readable: boolean;
  writable: boolean;
  actualDim?: number | null;
  actualModel?: string | null;
  actualProfileFingerprint?: string | null;
  expectedDim?: number | null;
  expectedModel?: string | null;
  expectedProfileFingerprint?: string | null;
  pendingRebuild?: {
    taskId: string;
    expectedDim: number;
    reason: string;
    createdAt: string;
  } | null;
  rebuildProgress?: {
    migrated: number;
    total: number;
    phase: "MIGRATING" | "SWITCHING_ALIAS" | "COMPLETED" | "FAILED";
  } | null;
  lastError?: string | null;
};
