/**
 * 全局常量定义
 * 所有魔法数字、阈值、配置项集中管理
 */

export const THRESHOLDS = Object.freeze({
  /** 模糊匹配最低相似度 */
  FUZZY_MATCH: 0.85,
  /** 语义去重相似度阈值 */
  SEMANTIC_DEDUP: 0.88,
  /** 题目最小字符数 */
  MIN_QUESTION_LENGTH: 4,
  /** 云端缓存有效期 (ms) */
  CLOUD_CACHE_TTL: 5 * 60 * 1000,
  /** 提交延迟范围 (秒) */
  SUBMIT_DELAY_MIN: 20,
  SUBMIT_DELAY_MAX: 30,
  /** SHA 冲突重试次数 */
  MAX_SHA_RETRIES: 3,
  /** SHA 重试间隔 (ms) */
  SHA_RETRY_DELAY: 500,
});

export const STORAGE_KEYS = Object.freeze({
  CONFIG: 'qxy_cfg_v4',
  DATABASE: 'qxy_merged_v4',
  SOURCE_MAP: 'qxy_source_v4',
  TAG_DB: 'ata_tag_db',
  TAG_MAP: 'ata_tag_map',
});

export const CLOUD_DEFAULTS = Object.freeze({
  FILE_PATH: 'minutestars_qa.json',
  BRANCH: 'main',
  ENCRYPT_PASSWORD: '1129',
});

export const ANSWER_METHODS = Object.freeze({
  LIBRARY: 'library',
  RULE_INFER: 'rule_infer',
  NONE: 'none',
});
