/**
 * Build Google Sheets CSV URLs and fetch the first that returns real data.
 * Works with: Publish to web, or Share → Anyone with the link (Viewer).
 */

function extractSheetMeta(link) {
  const trimmed = String(link || '').trim();
  if (!trimmed) return null;

  let gid = '0';
  const gidMatch = trimmed.match(/[#&?]gid=(\d+)/);
  if (gidMatch) gid = gidMatch[1];

  const pubIdMatch = trimmed.match(/\/spreadsheets\/d\/e\/([^/]+)/);
  if (pubIdMatch) {
    return { type: 'published', pubId: pubIdMatch[1], gid, original: trimmed };
  }

  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch || idMatch[1] === 'e') return null;

  return { type: 'standard', sheetId: idMatch[1], gid, original: trimmed };
}

function buildGoogleSheetCsvUrls(link) {
  const meta = extractSheetMeta(link);
  if (!meta) return [];

  const urls = [];
  const { gid } = meta;

  if (/output=csv|format=csv|tqx=out:csv/i.test(meta.original)) {
    urls.push(meta.original);
  }

  if (meta.type === 'published') {
    const { pubId } = meta;
    urls.push(`https://docs.google.com/spreadsheets/d/e/${pubId}/pub?output=csv&gid=${gid}`);
    urls.push(`https://docs.google.com/spreadsheets/d/e/${pubId}/pub?gid=${gid}&single=true&output=csv`);
  } else {
    const { sheetId } = meta;
    urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
    urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
    urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv&gid=${gid}`);
    urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/pub?gid=${gid}&single=true&output=csv`);
    if (/\/pub(?:html)?/i.test(meta.original)) {
      urls.unshift(`https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv&gid=${gid}`);
    }
  }

  return [...new Set(urls)];
}

function isGoogleLoginPage(text) {
  const sample = String(text || '').trim().slice(0, 800).toLowerCase();
  if (!sample.startsWith('<!doctype') && !sample.startsWith('<html')) return false;
  return (
    sample.includes('accounts.google') ||
    sample.includes('servicelogin') ||
    sample.includes('sign in') ||
    sample.includes('signin') ||
    sample.includes('login')
  );
}

function looksLikeSheetData(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return false;
  if (isGoogleLoginPage(t)) return false;
  if (t.startsWith('{') || t.startsWith('[')) return true;
  if (t.startsWith('<')) return false;
  return t.includes(',') || t.includes('\n') || /^key[,;\t]/i.test(t);
}

async function fetchGoogleSheetCsv(link) {
  const urls = buildGoogleSheetCsvUrls(link);
  if (!urls.length) {
    throw new Error('Invalid Google Sheets URL');
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/csv,text/plain,application/csv,*/*',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  let lastStatus = 0;
  for (const tryUrl of urls) {
    try {
      const res = await fetch(tryUrl, { headers, redirect: 'follow' });
      const body = await res.text();
      lastStatus = res.status;
      if (res.ok && looksLikeSheetData(body)) {
        return body;
      }
    } catch {
      /* try next URL */
    }
  }

  const err = new Error(
    'Could not read this sheet. In Google Sheets open Share → General access → set to "Anyone with the link" (Viewer). ' +
      'Or use File → Share → Publish to web (CSV) and paste that link.'
  );
  err.status = lastStatus || 403;
  throw err;
}

module.exports = {
  buildGoogleSheetCsvUrls,
  extractSheetMeta,
  fetchGoogleSheetCsv,
  looksLikeSheetData,
  isGoogleLoginPage
};
