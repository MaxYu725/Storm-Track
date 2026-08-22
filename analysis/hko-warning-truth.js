(function attachHkoWarningTruth(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkoWarningTruth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkoWarningTruth() {
  'use strict';

  const VERSION = 'hko-warning-truth/v1';
  const TC_CODES = new Set(['TC1', 'TC3', 'TC8NE', 'TC8SE', 'TC8SW', 'TC8NW', 'TC9', 'TC10', 'CANCEL']);

  function clean(value) {
    return value == null ? null : String(value).trim() || null;
  }

  function normalizeTcCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return TC_CODES.has(code) ? code : null;
  }

  function signalLevel(code) {
    if (code === 'TC1') return 1;
    if (code === 'TC3') return 3;
    if (code && code.startsWith('TC8')) return 8;
    if (code === 'TC9') return 9;
    if (code === 'TC10') return 10;
    return null;
  }

  function summaryState(warnsum) {
    const item = warnsum && typeof warnsum === 'object' ? warnsum.WTCSGNL : null;
    if (!item || typeof item !== 'object') {
      return {
        present: false,
        code: null,
        level: null,
        type: null,
        actionCode: null,
        issueTime: null,
        updateTime: null,
        expireTime: null
      };
    }
    const code = normalizeTcCode(item.code || item.subtype);
    return {
      present: Boolean(code && code !== 'CANCEL'),
      code,
      level: signalLevel(code),
      type: clean(item.type || item.name),
      actionCode: clean(item.actionCode)?.toUpperCase() || null,
      issueTime: clean(item.issueTime),
      updateTime: clean(item.updateTime),
      expireTime: clean(item.expireTime)
    };
  }

  function warningDetails(warningInfo) {
    const details = Array.isArray(warningInfo?.details)
      ? warningInfo.details
      : Array.isArray(warningInfo) ? warningInfo : [];
    return details
      .filter(item => item && typeof item === 'object')
      .filter(item => String(item.warningStatementCode || '').toUpperCase() === 'WTCSGNL')
      .map(item => ({
        warningStatementCode: 'WTCSGNL',
        subtype: normalizeTcCode(item.subtype),
        updateTime: clean(item.updateTime),
        contents: Array.isArray(item.contents) ? item.contents.map(clean).filter(Boolean) : []
      }));
  }

  function pre8Details(warningInfo) {
    const details = Array.isArray(warningInfo?.details)
      ? warningInfo.details
      : Array.isArray(warningInfo) ? warningInfo : [];
    return details
      .filter(item => item && typeof item === 'object')
      .filter(item => String(item.warningStatementCode || '').toUpperCase() === 'WTCPRE8')
      .map(item => ({
        warningStatementCode: 'WTCPRE8',
        updateTime: clean(item.updateTime),
        contents: Array.isArray(item.contents) ? item.contents.map(clean).filter(Boolean) : []
      }));
  }

  function specialWeatherTips(swt) {
    const rows = Array.isArray(swt?.swt) ? swt.swt : [];
    return rows
      .filter(item => item && typeof item === 'object')
      .map(item => ({ desc: clean(item.desc), updateTime: clean(item.updateTime) }))
      .filter(item => item.desc || item.updateTime);
  }

  function normalizeSnapshot({ warnsum, warningInfo, swt, retrievedAt, sourceHashes, sourceCommit }) {
    const warning = summaryState(warnsum);
    const details = warningDetails(warningInfo);
    const pre8 = pre8Details(warningInfo);
    const tips = specialWeatherTips(swt);
    return {
      schemaVersion: VERSION,
      retrievedAt: clean(retrievedAt),
      sourceCommit: clean(sourceCommit),
      authority: 'Hong Kong Observatory Open Data API',
      truth: {
        warningStatementCode: 'WTCSGNL',
        ...warning,
        details
      },
      context: {
        pre8,
        specialWeatherTips: tips
      },
      sourceHashes: sourceHashes || {}
    };
  }

  function fingerprintMaterial(snapshot) {
    return {
      schemaVersion: snapshot?.schemaVersion || VERSION,
      truth: snapshot?.truth || null,
      context: snapshot?.context || null,
      sourceHashes: snapshot?.sourceHashes || {}
    };
  }

  return Object.freeze({
    VERSION,
    TC_CODES,
    normalizeTcCode,
    signalLevel,
    summaryState,
    warningDetails,
    pre8Details,
    specialWeatherTips,
    normalizeSnapshot,
    fingerprintMaterial
  });
});
