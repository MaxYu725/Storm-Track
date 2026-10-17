(function attachStormArchivePagination(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormArchivePagination = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormArchivePagination() {
  'use strict';

  const STORM_PAGE_SIZE = 100;
  const ADVISORY_PAGE_SIZE = 200;

  function appendStormPage(existing, response, offset, limit = STORM_PAGE_SIZE) {
    if (!Array.isArray(existing) || !response || !Array.isArray(response.storms)) {
      throw new Error('歷史風暴 API 返回不正確的資料格式');
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset !== existing.length) {
      throw new Error('歷史風暴分頁起點不一致，請重新載入');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || response.storms.length > limit) {
      throw new Error('歷史風暴分頁筆數超出限制');
    }

    const metadata = response.pagination;
    const supportsOffset = Number.isSafeInteger(metadata?.offset)
      && Number.isSafeInteger(metadata?.limit)
      && metadata.offset === offset
      && metadata.limit === limit;
    if (offset > 0 && !supportsOffset) {
      throw new Error('正式歷史 API 未確認支援 offset 分頁，為避免重複資料已停止載入');
    }

    const seen = new Set();
    for (const item of existing) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) {
        throw new Error('已有風暴清單的識別碼不完整或重複');
      }
      seen.add(item.id);
    }
    for (const item of response.storms) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) {
        throw new Error('風暴分頁包含重複或無效識別碼，為避免資料錯亂已停止載入');
      }
      seen.add(item.id);
    }

    const reachedLimit = response.storms.length === limit;
    return {
      storms: existing.concat(response.storms),
      hasMore: reachedLimit && supportsOffset,
      incomplete: reachedLimit && !supportsOffset,
      supportsOffset,
      appended: response.storms.length
    };
  }

  function advisoryCoverage(advisories, reportedCount, limit = ADVISORY_PAGE_SIZE) {
    if (!Array.isArray(advisories)) throw new Error('公報列表格式不正確');
    const count = Number(reportedCount);
    const hasReportedCount = reportedCount !== null && reportedCount !== undefined
      && reportedCount !== '' && Number.isSafeInteger(count) && count >= 0;
    const reachedLimit = advisories.length >= limit;
    const expectedMore = hasReportedCount && count > advisories.length;
    return {
      incomplete: reachedLimit || expectedMore,
      loaded: advisories.length,
      reported: hasReportedCount ? count : null,
      reason: expectedMore ? 'reported-count-exceeds-loaded'
        : reachedLimit ? 'page-limit-reached' : null
    };
  }

  return Object.freeze({ STORM_PAGE_SIZE, ADVISORY_PAGE_SIZE, appendStormPage, advisoryCoverage });
});
