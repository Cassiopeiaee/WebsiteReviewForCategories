// ===== Limits (müssen mit dem Frontend übereinstimmen bzw. dürfen strenger sein) =====
var LIMITS = {
  TITLE_MAX: 200,
  DESCRIPTION_MAX: 2000,
  STEPS_MAX: 1000,
  EMAIL_MAX: 254,
  MAX_FILES: 5,
  MAX_TOTAL_SIZE: 25 * 1024 * 1024, // Bytes, nach Base64-Dekodierung
  MIN_ELAPSED_MS: 3000,             // Submits schneller als 3 s => Bot
  RATE_LIMIT_WINDOW_SEC: 3600,      // Zeitfenster fuer das globale Limit
  RATE_LIMIT_MAX: 20                // max. Reports pro Zeitfenster
};

var ALLOWED_TYPES = {
  'image/jpeg': true, 'image/png': true, 'image/gif': true, 'image/webp': true,
  'video/mp4': true, 'video/quicktime': true, 'video/webm': true
};

function doPost(e) {
  try {
    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResponse({ success: false, error: 'Invalid request' });
    }

    // ---- Honeypot: Feld muss leer sein ----
    if (data.website) {
      // Bot erkannt: Erfolg vortaeuschen, damit er nichts lernt
      return jsonResponse({ success: true });
    }

    // ---- Timing: zu schneller Submit => Bot ----
    if (typeof data.elapsedMs !== 'number' || data.elapsedMs < LIMITS.MIN_ELAPSED_MS) {
      return jsonResponse({ success: true });
    }

    // ---- Rate Limiting (global, ueber CacheService) ----
    if (!checkRateLimit()) {
      return jsonResponse({ success: false, error: 'Too many requests. Please try again later.' });
    }

    // ---- Feld-Validierung ----
    var title = cleanString(data.title, LIMITS.TITLE_MAX);
    var description = cleanString(data.description, LIMITS.DESCRIPTION_MAX);
    var steps = cleanString(data.steps, LIMITS.STEPS_MAX);
    var email = cleanString(data.email, LIMITS.EMAIL_MAX);

    if (!title || !description) {
      return jsonResponse({ success: false, error: 'Missing required fields' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ success: false, error: 'Invalid email' });
    }

    // ---- Datei-Validierung ----
    var files = Array.isArray(data.files) ? data.files : [];
    if (files.length > LIMITS.MAX_FILES) {
      return jsonResponse({ success: false, error: 'Too many files' });
    }

    var totalSize = 0;
    var validatedFiles = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || typeof f.content !== 'string' || typeof f.name !== 'string') {
        return jsonResponse({ success: false, error: 'Invalid file' });
      }
      if (!ALLOWED_TYPES[f.type]) {
        return jsonResponse({ success: false, error: 'File type not allowed' });
      }

      var bytes;
      try {
        bytes = Utilities.base64Decode(f.content);
      } catch (err) {
        return jsonResponse({ success: false, error: 'Invalid file' });
      }

      totalSize += bytes.length;
      if (totalSize > LIMITS.MAX_TOTAL_SIZE) {
        return jsonResponse({ success: false, error: 'Files too large' });
      }

      if (!magicBytesMatch(bytes, f.type)) {
        return jsonResponse({ success: false, error: 'File content does not match its type' });
      }

      validatedFiles.push({
        name: sanitizeFilename(f.name),
        type: f.type,
        content: f.content,
        bytes: bytes
      });
    }

    // ---- GitHub-Issue erstellen ----
    var result = createGitHubIssue(title, description, steps, email, validatedFiles);
    return jsonResponse(result);

  } catch (err) {
    // Keine Interna nach aussen geben
    return jsonResponse({ success: false, error: 'Internal error' });
  }
}

// ===== Antwort-Helfer =====
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== Rate Limiting =====
function checkRateLimit() {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var count = parseInt(cache.get('report_count') || '0', 10);
    if (count >= LIMITS.RATE_LIMIT_MAX) return false;
    cache.put('report_count', String(count + 1), LIMITS.RATE_LIMIT_WINDOW_SEC);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ===== Magic-Byte-Pruefung =====
function magicBytesMatch(bytes, mimeType) {
  if (bytes.length < 12) return false;
  // Apps Script liefert signed bytes (-128..127) => maskieren
  var b = [];
  for (var i = 0; i < 12; i++) b.push(bytes[i] & 0xFF);

  switch (mimeType) {
    case 'image/jpeg':
      return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    case 'image/png':
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    case 'image/gif':
      return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
    case 'image/webp':
      return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
             b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    case 'video/mp4':
    case 'video/quicktime':
      // "ftyp" an Offset 4
      return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
    case 'video/webm':
      // EBML-Header
      return b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3;
    default:
      return false;
  }
}

// ===== Hilfsfunktionen =====
function cleanString(value, maxLen) {
  if (typeof value !== 'string') return '';
  // Steuerzeichen entfernen (ausser Zeilenumbruch/Tab), dann Laenge begrenzen
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
              .trim()
              .slice(0, maxLen);
}

function sanitizeFilename(name) {
  return name.replace(/[^\w.\- ]/g, '_').slice(0, 100);
}

// Verhindert @-Mentions, Issue-Referenzen (#123) und HTML im Issue-Text
function escapeUserText(text) {
  return text
    .replace(/@/g, '@\u200B')   // Zero-Width-Space verhindert Mention-Pings
    .replace(/#(\d)/g, '#\u200B$1')
    .replace(/</g, '&lt;');
}

// ===== GitHub =====
function createGitHubIssue(title, description, steps, email, files) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var repo = props.getProperty('GITHUB_REPO');
  if (!token || !repo) {
    return { success: false, error: 'Server not configured' };
  }

  var body = '### Description\n\n' + escapeUserText(description) + '\n';
  if (steps) {
    body += '\n### Steps to Reproduce\n\n' + escapeUserText(steps) + '\n';
  }
  // E-Mail NICHT ins oeffentliche Issue schreiben (Datenschutz).
  // Nur vermerken, ob Kontakt moeglich ist; Adresse separat loggen.
  body += '\n### Contact\n\n' + (email ? 'Reporter provided a contact email (stored privately).' : 'No contact email provided.') + '\n';

  if (email) {
    logContactEmail(email, title);
  }

  // Anhaenge: Hinweis im Issue; Dateien selbst kannst du z. B. in Google Drive
  // ablegen und hier verlinken — passe diesen Block an dein bisheriges Vorgehen an.
  if (files.length > 0) {
    body += '\n### Attachments\n\n';
    for (var i = 0; i < files.length; i++) {
      body += '- ' + files[i].name + ' (' + files[i].type + ', ' +
              Math.round(files[i].bytes.length / 1024) + ' KB)\n';
    }
  }

  var response = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/issues', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify({
      title: '[Bug Report] ' + escapeUserText(title),
      body: body,
      labels: ['bug', 'user-report']
    }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
    return { success: true };
  }
  // Details nur serverseitig loggen, nicht an den Client geben
  console.error('GitHub API error: ' + response.getResponseCode() + ' ' + response.getContentText());
  return { success: false, error: 'Could not create report' };
}

// Kontakt-E-Mails privat ablegen (hier: Script-Log; alternativ ein privates Sheet)
function logContactEmail(email, title) {
  console.log('Contact for "' + title + '": ' + email);
}
