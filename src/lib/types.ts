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
  sessionId: string;
  question: string;
  kbScope?: string[];
  createdAt?: string;
};

export type RecentCitation = {
  segmentId: string;
  assetId: string;
  kbId: string;
  fileName?: string;
  title?: string;
  snippet?: string;
  citationReason?: string;
  openedAt?: string;
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
  warnings?: string[];
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
  items?: Array<{
    itemId: string;
    assetId?: string;
    fileName?: string;
    sourceUrl?: string;
    stage: string;
    status: string;
    progress: number;
    dedupeResult?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
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

export type SearchResult = {
  segmentId?: string;
  kbId?: string;
  assetId?: string;
  sourceRef?: string;
  segmentType?: string;
  assetType?: string;
  content?: string;
  snippet?: string;
  pageNo?: number;
  score?: number;
  thumbnail?: string;
  ocrSummary?: string;
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
  nextCursor?: string;
  answer?: SearchAnswer;
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

export type Provider = {
  providerKey: string;
  providerName: string;
  providerType: string;
  selected: boolean;
  enabled: boolean;
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  dimension?: number;
  connected?: boolean;
};

export type ProviderList = {
  providers: Provider[];
};

export type SearchSetting = {
  rerankEnabled?: boolean;
  resultLimit?: number;
  minScore?: number;
};

export type Preference = {
  answerMode?: string;
  citationPolicy?: string;
  language?: string;
  theme?: string;
  fontSize?: string;
  density?: string;
};

export type ConversationMessage = {
  sessionId?: string;
  turnId?: string;
  answer?: string;
  citations?: Array<{
    fileName?: string;
    pageNo?: number;
    snippet?: string;
    hitType?: string;
    assetId?: string;
    segmentId?: string;
  }>;
};
