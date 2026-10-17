(function attachStormArchiveAdvisoryCursor(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormArchiveAdvisoryCursor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormArchiveAdvisoryCursor() {
  'use strict';

  // Proposed WEB-04B contract. This is NOT proof that the deployed Worker supports it.
  const CONTRACT = 'storm-history-advisory-cursor/v1';
  const ORDER = 'issued_at_desc,id_desc';
  const DEFAULT_LIMIT = 200;
  const MAX_CURSOR_LENGTH = 2048;

  function isStrictlyOlder(newer, older) {
    // Compare instants, not ISO text: the source may express the same cycle
    // with a UTC Z suffix or an explicit time-zone offset.
    const newerMs = Date.parse(newer.issued_at);
    const olderMs = Date.parse(older.issued_at);
    return olderMs < newerMs || (olderMs === newerMs && older.id < newer.id);
  }

  function validateRows(rows, stormId, ordered) {
    const seen = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || typeof row.id !== 'string' || !row.id.trim()
        || typeof row.issued_at !== 'string' || !Number.isFinite(Date.parse(row.issued_at))) {
        throw new Error('歷史公報頁面包含無效 ID 或發報時間');
      }
      if (row.storm_id != null && row.storm_id !== stormId) {
        throw new Error('歷史公報回應包含其他風暴的記錄');
      }
      if (seen.has(row.id)) throw new Error('同一頁包含重複公報 ID');
      if (ordered && i > 0 && !isStrictlyOlder(rows[i - 1], row)) {
        throw new Error('歷史公報排序不符合穩定游標合約');
      }
      seen.add(row.id);
    }
    return seen;
  }

  function appendAdvisoryPage(previous, response, options = {}) {
    const stormId = options.stormId;
    const limit = options.limit ?? DEFAULT_LIMIT;
    const cursor = options.cursor ?? null;
    const seenCursors = options.seenCursors || [];
    if (typeof stormId !== 'string' || !stormId.trim()) throw new Error('必須提供風暴 ID');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_LIMIT) {
      throw new Error('公報分頁 limit 無效');
    }
    if (!Array.isArray(previous) || !response || !Array.isArray(response.advisories)) {
      throw new Error('歷史公報 API 回應格式不正確');
    }
    if (response.advisories.length > limit) throw new Error('歷史公報頁面超出數量上限');
    if (response.stormId != null && response.stormId !== stormId) {
      throw new Error('歷史公報回應的風暴 ID 不一致');
    }
    const paging = response.pagination;
    const supported = paging?.contract === CONTRACT;
    if (!supported) {
      if (cursor != null || previous.length) {
        throw new Error('正式 API 未提供已驗證的公報游標分頁合約');
      }
      validateRows(response.advisories, stormId, false);
      return {
        advisories: response.advisories.slice(), supported: false, hasMore: false,
        nextCursor: null, seenCursors: [], complete: false,
        reason: 'cursor-contract-not-verified'
      };
    }
    if (paging.limit !== limit || paging.order !== ORDER || typeof paging.hasMore !== 'boolean') {
      throw new Error('公報分頁協定版本或排序資訊不一致');
    }
    if (paging.count != null && paging.count !== response.advisories.length) {
      throw new Error('公報分頁 count 與資料筆數不同');
    }
    const next = paging.nextCursor;
    if (paging.hasMore) {
      if (typeof next !== 'string' || !next || next.length > MAX_CURSOR_LENGTH) {
        throw new Error('API 表示有下一頁但沒有有效游標');
      }
      if (!response.advisories.length) throw new Error('API 返回空白分頁卻聲稱有下一頁');
      if (next === cursor || seenCursors.includes(next)) throw new Error('公報游標循環');
    } else if (next != null) {
      throw new Error('末頁仍傳回下一頁游標');
    }
    if (cursor != null && (typeof cursor !== 'string' || !cursor || !seenCursors.includes(cursor))) {
      throw new Error('公報游標與已驗證的頁面狀態不一致');
    }
    if (previous.length && cursor == null) {
      throw new Error('追加公報時缺少已驗證的游標');
    }

    const oldIds = validateRows(previous, stormId, true);
    validateRows(response.advisories, stormId, true);
    for (const row of response.advisories) {
      if (oldIds.has(row.id)) throw new Error('歷史公報跨頁重複');
    }
    if (previous.length && response.advisories.length
      && !isStrictlyOlder(previous[previous.length - 1], response.advisories[0])) {
      throw new Error('歷史公報跨頁排序不一致');
    }
    const knownCursors = seenCursors.slice();
    if (paging.hasMore) knownCursors.push(next);
    return {
      advisories: previous.concat(response.advisories),
      supported: true,
      hasMore: paging.hasMore,
      nextCursor: paging.hasMore ? next : null,
      seenCursors: knownCursors,
      complete: !paging.hasMore,
      reason: paging.hasMore ? 'more-pages-available' : null
    };
  }

  return Object.freeze({ CONTRACT, ORDER, DEFAULT_LIMIT, appendAdvisoryPage });
});
