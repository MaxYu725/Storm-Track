(function attachArchiveKeysetProposal(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormArchiveKeysetProposal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createArchiveKeysetProposal() {
  'use strict';
  // WEB-04B-5 isolated candidate. NOT loaded by live HTML or deployed Worker.
  // No HMAC: cursor is a public positioning token, not an authorization token.
  const CONTRACT = 'storm-history-advisory-cursor/v1';
  const ORDER = 'issued_at_desc,id_desc';
  const LIMIT_MAX = 200;
  const CURSOR_MAX = 2048;
  const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  function textField(value, label, max = 512) {
    if (typeof value !== 'string' || !value.length || value.length > max
        || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error('Invalid ' + label);
    }
    return value;
  }
  function canonicalTime(value) {
    if (typeof value !== 'string' || !ISO_UTC.test(value)) throw new Error('Non-canonical issued_at');
    const d = new Date(value);
    if (!Number.isFinite(d.getTime()) || d.toISOString() !== value)
      throw new Error('Invalid issued_at');
    return value;
  }
  function normalizedAgency(agency) {
    if (agency == null || agency === '') return null;
    if (typeof agency !== 'string') throw new Error('Invalid agency');
    const normalized = agency.toUpperCase();
    if (!['HKO','CMA','JMA','CWA'].includes(normalized)) throw new Error('Invalid agency');
    return normalized;
  }
  function limitValue(limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMIT_MAX)
      throw new Error('Invalid page limit');
    return limit;
  }
  function context(input) {
    const stormId = textField(input?.stormId, 'canonical storm ID', 256);
    const agency = normalizedAgency(input.agency);
    const limit = limitValue(input.limit);
    return { stormId, agency, limit };
  }
  function encodeBase64Url(json) {
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function decodeBase64Url(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)
       || text.length % 4 === 1) throw new Error('Malformed cursor encoding');
    const base64 = text.replace(/-/g,'+').replace(/_/g,'/');
    const raw = atob(base64);
    const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  function cursorBody(ctx, timestamp, id) {
    return {v:1,s:ctx.stormId,a:ctx.agency,l:ctx.limit,
      t:canonicalTime(timestamp),i:textField(id,'advisory ID')};
  }
  function encodeCursor(ctxInput, row) {
    const ctx = context(ctxInput);
    const encoded = 'v1.' + encodeBase64Url(JSON.stringify(cursorBody(ctx,row.issued_at,row.id)));
    if (encoded.length > CURSOR_MAX) throw new Error('Cursor too long');
    return encoded;
  }
  function decodeCursor(token, ctxInput) {
    const ctx = context(ctxInput);
    if (typeof token !== 'string' || token.length > CURSOR_MAX
        || !token.startsWith('v1.')) throw new Error('Unsupported or oversized cursor');
    let body;
    try { body = JSON.parse(decodeBase64Url(token.slice(3))); }
    catch { throw new Error('Malformed cursor'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'a,i,l,s,t,v')
      throw new Error('Cursor shape mismatch');
    if (body.v !== 1 || body.s !== ctx.stormId || body.a !== ctx.agency
        || body.l !== ctx.limit) throw new Error('Cursor context mismatch');
    const canonical = cursorBody(ctx,body.t,body.i);
    if ('v1.' + encodeBase64Url(JSON.stringify(canonical)) !== token)
      throw new Error('Non-canonical cursor encoding');
    return {issued_at:canonical.t,id:canonical.i};
  }
  function buildQuery(ctxInput, token = null) {
    const ctx = context(ctxInput);
    const predicates = ["storm_id=?", "ingest_status='complete'"];
    const params = [ctx.stormId];
    if (ctx.agency) {predicates.push('agency=?');params.push(ctx.agency);}
    if (token != null) {
      const p = decodeCursor(token,ctx);
      predicates.push('(issued_at < ? OR (issued_at = ? AND id < ?))');
      params.push(p.issued_at,p.issued_at,p.id);
    }
    params.push(ctx.limit + 1);
    const sql = `SELECT id, storm_id, agency, issued_at, fetched_at, source_code, source_url,
           raw_object_key, parser_version, point_count
      FROM advisories WHERE ${predicates.join(' AND ')}
      ORDER BY issued_at DESC, id DESC LIMIT ?`;
    return {sql,params,limit:ctx.limit};
  }
  function strictlyOlder(newer, older) {
    return older.issued_at < newer.issued_at
      || (older.issued_at === newer.issued_at && older.id < newer.id);
  }
  function buildResponse(ctxInput, rawRows, workerVersion) {
    const ctx = context(ctxInput);
    if (!Array.isArray(rawRows) || rawRows.length > ctx.limit + 1)
      throw new Error('Unexpected D1 page size');
    const ids = new Set();
    for (let i=0;i<rawRows.length;i++) {
      const row=rawRows[i];
      if (!row || textField(row.id,'advisory ID') == null
          || canonicalTime(row.issued_at) == null
          || row.storm_id !== ctx.stormId
          || (ctx.agency && row.agency !== ctx.agency)
          || !['HKO','CMA','JMA','CWA'].includes(row.agency)
          || ids.has(row.id)
          || (i>0 && !strictlyOlder(rawRows[i-1],row)))
        throw new Error('Invalid, duplicated or unordered advisory page');
      ids.add(row.id);
    }
    const advisories = rawRows.slice(0,ctx.limit);
    const hasMore = rawRows.length > ctx.limit;
    const nextCursor = hasMore ? encodeCursor(ctx,advisories.at(-1)) : null;
    return {version:workerVersion,stormId:ctx.stormId,advisories,
      pagination:{contract:CONTRACT,order:ORDER,limit:ctx.limit,
        count:advisories.length,hasMore,nextCursor}};
  }
  return Object.freeze({CONTRACT,ORDER,LIMIT_MAX,canonicalTime,normalizedAgency,
    encodeCursor,decodeCursor,buildQuery,buildResponse,strictlyOlder});
});
