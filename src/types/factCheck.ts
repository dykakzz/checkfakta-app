export type VerdictCategory =
  | 'FAKTA'
  | 'HOAKS'
  | 'MANIPULASI_AI'
  | 'KURANG_KONTEKS'
  | 'OPINI'
  | 'BELUM_TERBUKTI'
  | 'TIDAK_DAPAT_DIAKSES';

export type EmbeddedFactCheckStatus = 'TERVERIFIKASI' | 'KELIRU' | 'BELUM_TERBUKTI';

export interface EmbeddedFactCheckItem {
  claim: string;
  status: EmbeddedFactCheckStatus;
  explanation: string;
}

export interface OpinionAnalysisReport {
  hasPersonalOpinion: boolean;
  subjectiveOpinionPoints: string[];
  embeddedFactChecks: EmbeddedFactCheckItem[];
}

export type AnalysisMode = 'deep' | 'fast';

export type ContentAccessStatus =
  | 'full_video_analyzed'
  | 'caption_only'
  | 'text_or_media_direct'
  | 'blocked_login_wall';

export type MediaSourcePlatform =
  | 'tiktok'
  | 'instagram_reel'
  | 'facebook'
  | 'youtube'
  | 'x_twitter'
  | 'article'
  | 'direct_upload'
  | 'text_only';

export interface GroundingSource {
  title: string;
  uri: string;
  publisher?: string;
}

export interface MediaForensicsReport {
  analyzedMediaType: 'video' | 'image' | 'audio' | 'none';
  isAiOrDeepfakeSuspected: boolean;
  authenticityScore: number; // 0 to 100 (100 = authentic, 0 = synthetic/manipulated)
  summary: string;
  anomalies: string[];
}

export interface UrlExtractionMetadata {
  url: string;
  resolvedUrl?: string;
  platform: MediaSourcePlatform;
  title?: string;
  author?: string;
  caption?: string;
  thumbnailUrl?: string;
  videoStreamFetchedToRam: boolean;
  videoStreamSizeBytes?: number;
  hasMeaningfulCaption: boolean;
  isLoginWallBlocked: boolean;
  accessStatus: ContentAccessStatus;
  extractionNotes: string;
}

export interface FactCheckResult {
  id: string;
  timestamp: string;
  accessStatus: ContentAccessStatus;
  blockedReason?: string;
  verdict: VerdictCategory;
  verdictLabel: string;
  confidenceScore: number; // 0 to 100
  claimExtracted: string;
  spokenTranscriptSummary: string;
  explanationSummary: string;
  keyFindings: string[];
  opinionAnalysis?: OpinionAnalysisReport;
  mediaForensics: MediaForensicsReport;
  urlMetadata?: UrlExtractionMetadata;
  sources: GroundingSource[];
  whatsappShareText: string;
  processingStats: {
    durationMs: number;
    ramBufferCleared: boolean;
    diskBytesUsed: 0;
    modeUsed: AnalysisMode;
    cachedFromFamilyRam?: boolean;
    modelUsed?: string;
  };
}

export interface FactCheckApiRequest {
  text?: string;
  url?: string;
  media?: {
    mimeType: string;
    data: string; // base64 payload processed strictly in RAM
    fileName?: string;
  };
  mode: AnalysisMode;
  bypassCache?: boolean;
  previousContext?: {
    claimExtracted: string;
    verdict: VerdictCategory;
    explanationSummary: string;
  };
}
