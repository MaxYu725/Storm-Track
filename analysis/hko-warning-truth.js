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

  function emptySummary() {
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

  function summaryState(warnsum) {
    const item = warnsum && typeof warnsum === 'object' ? warnsum.WTCSGNL : null;
    if (!item || typeof item !== 'object') return emptySummary();
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

  function detailsArray(warningInfo) {
    if (Array.isArray(warningInfo?.details)) return warningInfo.details;
    return Array.isArray(warningInfo) ? warningInfo : [];
  }

  function warningDetails(warningInfo) {
    return detailsArray(warningInfo)
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
    return detailsArray(warningInfo)
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

  function resolveTruth(warnsum, warningInfo) {
    const summary = summaryState(warnsum);
    const details = warningDetails(warningInfo);
    if (summary.code) return { warningStatementCode: 'WTCSGNL', ...summary, details };

    const cancellation = [...details].reverse().find(item => item.subtype === 'CANCEL');
    if (cancellation) {
      return {
        warningStatementCode: 'WTCSGNL',
        ...emptySummary(),
        code: 'CANCEL',
        actionCode: 'CANCEL',
        updateTime: cancellation.updateTime,
        details
      };
    }

    return { warningStatementCode: 'WTCSGNL', ...summary, details };
  }

  function truthStateMaterial(value) {
    const truth = value?.truth && typeof value.truth === 'object' ? value.truth : value;
    const code = normalizeTcCode(truth?.code);
    return {
      warningStatementCode: 'WTCSGNL',
      present: truth?.present === true,
      code,
      level: signalLevel(code),
      actionCode: clean(truth?.actionCode)?.toUpperCase() || null,
      issueTime: clean(truth?.issueTime)
    };
  }

  function normalizeSnapshot({ warnsum, warningInfo, swt, retrievedAt, sourceHashes, sourceCommit }) {
    return {
      schemaVersion: VERSION,
      retrievedAt: clean(retrievedAt),
      sourceCommit: clean(sourceCommit),
      authority: 'Hong Kong Observatory Open Data API',
      truth: resolveTruth(warnsum, warningInfo),
      context: {
        pre8: pre8Details(warningInfo),
        specialWeatherTips: specialWeatherTips(swt)
      },
      sourceHashes: sourceHashes || {}
    };
  }

  function fingerprintMaterial(snapshot) {
    return {
      schemaVersion: snapshot?.schemaVersion || VERSION,
      truth: snapshot?.truth || null,
      context: snapshot?.context || null
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
    resolveTruth,
    truthStateMaterial,
    normalizeSnapshot,
    fingerprintMaterial
  });
});
