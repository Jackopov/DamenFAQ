/* Panel admina FAQ — edycja api.json (pytania, synonimy, tłumaczenia pl/en,
   media: obrazy/wideo), anonimowe statystyki (stats.json, per dzień) + XLSX. */
const LANGS = ['pl', 'en'];
const LANG_NAMES = { pl: '🇵🇱 Polski', en: '🇬🇧 English' };

let items = [];      // dane robocze (aktualizowane przy każdej edycji)
let dirty = false;
let msgTimer = null;
let stats = null;    // anonimowe statystyki z stats.json
let statsPeriod = 0; // 0 = cały czas, 7/30/90 dni
let histGran = 'month'; // 'week' | 'month'
let activeMediaId = null; // pytanie, do którego trafia wklejany obraz / wideo

const $ = (id) => document.getElementById(id);

function escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function blankLang() {
    return { pl: '', en: '' };
}

function newItem(id) {
    return { id, category: blankLang(), question: blankLang(), answer: blankLang(), keywords: [], synonyms: [], media: [] };
}

/* Normalizuje element z dowolnego źródła (fetch, import, otwarty plik). */
function normalize(item, fallbackId) {
    const langObj = (v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            return { pl: String(v.pl ?? ''), en: String(v.en ?? '') };
        }
        return { pl: String(v ?? ''), en: '' };
    };
    return {
        id: typeof item.id === 'number' ? item.id : fallbackId,
        category: langObj(item.category),
        question: langObj(item.question),
        answer: langObj(item.answer),
        keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : [],
        synonyms: Array.isArray(item.synonyms) ? item.synonyms.map(String) : [],
        media: Array.isArray(item.media)
            ? item.media.filter((m) => m && m.src).map((m) => ({
                type: m.type === 'video' ? 'video' : 'image',
                src: String(m.src),
                caption: String(m.caption || '')
            }))
            : []
    };
}

/* Naprawia duplikaty i braki id. */
function ensureUniqueIds(list) {
    const seen = new Set();
    let maxId = 0;
    list.forEach((it) => { if (typeof it.id === 'number' && it.id > maxId) maxId = it.id; });
    return list.map((it) => {
        if (typeof it.id !== 'number' || seen.has(it.id)) {
            maxId += 1;
            it.id = maxId;
        }
        seen.add(it.id);
        return it;
    });
}

function splitTags(value) {
    return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function searchableText(it) {
    return [
        it.question.pl, it.question.en,
        it.category.pl, it.category.en,
        it.answer.pl, it.answer.en,
        it.keywords.join(' '), it.synonyms.join(' ')
    ].join(' ').toLowerCase();
}

/* ── Komunikaty ─────────────────────────────────────────────────────────── */
function showMsg(text, type) {
    const m = $('msg');
    m.textContent = text;
    m.className = 'msg show ' + (type || 'info');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { m.className = 'msg'; }, 6000);
}

/* ── Media (obrazy / wideo w odpowiedzi) ────────────────────────────────── */
// Media są zapisywane jako data-URL w api.json (działa na statycznym hostingu).

function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// Zmniejsza obraz (maxDim px) i zwraca data-URL (JPEG, chyba że jest przezroczystość → PNG).
function downscaleImage(file, maxDim) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                let hasAlpha = false;
                try {
                    const d = ctx.getImageData(0, 0, w, h).data;
                    for (let i = 3; i < d.length; i += 32) {
                        if (d[i] < 250) { hasAlpha = true; break; }
                    }
                } catch (e) { /* ignoruj */ }
                const out = canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.85);
                URL.revokeObjectURL(url);
                resolve(out);
            } catch (e) {
                URL.revokeObjectURL(url);
                reject(e);
            }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
        img.src = url;
    });
}

function addMedia(itemId, file) {
    const item = items.find((i) => i.id === itemId);
    if (!item || !file) return;
    if (!Array.isArray(item.media)) item.media = [];

    if (file.type.startsWith('image/')) {
        downscaleImage(file, 1400).then((dataUrl) => {
            item.media.push({ type: 'image', src: dataUrl, caption: '' });
            setDirty(true);
            renderAll(itemId);
            showMsg('Dodano obraz do pytania #' + itemId + ' (' + fmtBytes(Math.round(dataUrl.length * 0.75)) + '). Zapisz, aby utrwalić.', 'ok');
        }).catch(() => showMsg('Nie udało się przetworzyć obrazu.', 'error'));
    } else if (file.type.startsWith('video/')) {
        if (file.size > 25 * 1024 * 1024) {
            if (!confirm('Wideo ma ponad 25 MB. Duży plik znacząco powiększy api.json. Dodać mimo to?')) return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            item.media.push({ type: 'video', src: reader.result, caption: '' });
            setDirty(true);
            renderAll(itemId);
            showMsg('Dodano wideo do pytania #' + itemId + ' (' + fmtBytes(file.size) + '). Zapisz, aby utrwalić.', 'ok');
        };
        reader.onerror = () => showMsg('Nie udało się odczytać pliku wideo.', 'error');
        reader.readAsDataURL(file);
    }
}

function mediaEntryHtml(item, m, i) {
    const preview = m.type === 'video'
        ? `<video src="${escHtml(m.src)}" controls preload="metadata"></video>`
        : `<img src="${escHtml(m.src)}" alt="">`;
    return `
        <div class="media-entry">
            <div class="media-preview">${preview}</div>
            <div class="media-fields">
                <span class="media-type">${m.type === 'video' ? '🎬 Wideo' : '🖼️ Obraz'}</span>
                <input type="text" data-media-caption="${i}" placeholder="Podpis (opcjonalny)" value="${escHtml(m.caption)}">
                <button type="button" class="icon-btn danger" data-media-del="${i}" title="Usuń media">✕</button>
            </div>
        </div>`;
}

/* ── Anonimowe statystyki (buckety dzienne) ─────────────────────────────── */
// stats.json: { daily: { "YYYY-MM-DD": { questions: {id: n}, unanswered: {text: n}, total: n } }, updated: iso }

const PL_MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
    'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

function localDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pl-PL');
    } catch (e) {
        return iso;
    }
}

function statsQuestionText(id) {
    const item = items.find((i) => String(i.id) === String(id));
    if (item) return item.question.pl || item.question.en || '(pytanie #' + id + ')';
    return '(pytanie #' + id + ' — usunięte z api.json)';
}

function statsDailyList() {
    const days = [];
    (stats && stats.daily) && Object.entries(stats.daily).forEach(([date, b]) => {
        const q = b.questions || {}, u = b.unanswered || {};
        let tq = 0, tu = 0;
        Object.values(q).forEach((v) => { tq += v; });
        Object.values(u).forEach((v) => { tu += v; });
        days.push({ date, q, u, total: (typeof b.total === 'number' ? b.total : tq + tu) });
    });
    days.sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
    return days;
}

function filterDays(days) {
    if (!statsPeriod) return days;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - statsPeriod);
    const ck = localDateKey(cutoff);
    return days.filter((d) => d.date >= ck);
}

function mergeBuckets(days) {
    const q = {}, u = {};
    let total = 0;
    days.forEach((d) => {
        total += d.total;
        Object.entries(d.q).forEach(([k, v]) => { q[k] = (q[k] || 0) + v; });
        Object.entries(d.u).forEach(([k, v]) => { u[k] = (u[k] || 0) + v; });
    });
    return { q, u, total };
}

function weekStartKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = (d.getDay() + 6) % 7; // poniedziałek = 0
    d.setDate(d.getDate() - day);
    return localDateKey(d);
}

/* Grupuje dni w okresy (tydzień / miesiąc), sortuje malejąco, bierze 12 ostatnich. */
function groupDays(days, gran) {
    const groups = new Map();
    days.forEach((d) => {
        const key = gran === 'week' ? weekStartKey(d.date) : d.date.slice(0, 7);
        const g = groups.get(key) || { key, total: 0, q: {}, u: {} };
        g.total += d.total;
        Object.entries(d.q).forEach(([k, v]) => { g.q[k] = (g.q[k] || 0) + v; });
        Object.entries(d.u).forEach(([k, v]) => { g.u[k] = (g.u[k] || 0) + v; });
        groups.set(key, g);
    });
    return Array.from(groups.values())
        .sort((a, b) => a.key < b.key ? 1 : (a.key > b.key ? -1 : 0))
        .slice(0, 12);
}

function periodLabel(key, gran) {
    if (gran === 'week') {
        const d = new Date(key + 'T00:00:00');
        return 'tydz. ' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0');
    }
    const [y, m] = key.split('-');
    return PL_MONTHS[Number(m) - 1] + ' ' + y;
}

function periodSelectLabel() {
    const v = Number($('stats-period').value);
    return v === 0 ? 'Cały czas' : 'Ostatnie ' + v + ' dni';
}

function renderStats() {
    const body = $('stats-body');
    if (!stats || !stats.daily || Object.keys(stats.daily).length === 0) {
        body.innerHTML = '<p class="empty-note">Brak danych. Statystyki zbiorą się automatycznie, gdy pracownicy zaczną zadawać pytania na stronie FAQ — każde pytanie jest zapisywane w dziennym przedziale, więc historia się kumuluje.</p>';
        return;
    }

    const days = filterDays(statsDailyList());
    const merged = mergeBuckets(days);
    const topQ = Object.entries(merged.q).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topU = Object.entries(merged.u).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxQ = topQ.length ? topQ[0][1] : 0;
    const maxU = topU.length ? topU[0][1] : 0;
    const history = groupDays(statsDailyList(), histGran);
    const maxH = history.length ? history[0].total : 0;

    const bar = (v, max) => '<span style="width:' + (max ? Math.round((v / max) * 100) : 0) + '%"></span>';

    const rows = (entries, max, textFn) => entries.length
        ? entries.map(([k, v]) => `
            <div class="stat-row">
                <div class="stat-q">${escHtml(textFn(k))}</div>
                <div class="stat-bar">${bar(v, max)}</div>
                <div class="stat-count">${v}×</div>
            </div>`).join('')
        : '<p class="stats-empty">Brak wpisów w wybranym okresie.</p>';

    const histRows = history.length
        ? history.map((g) => `
            <div class="hist-row">
                <span class="hist-lbl">${escHtml(periodLabel(g.key, histGran))}</span>
                <span class="hist-bar">${bar(g.total, maxH)}</span>
                <span class="hist-num">${g.total}</span>
            </div>`).join('')
        : '<p class="stats-empty">Brak historii.</p>';

    body.innerHTML = `
        <div class="stats-summary">
            <div class="stat-tile"><div class="num">${merged.total}</div><div class="lbl">zadanych pytań</div></div>
            <div class="stat-tile"><div class="num">${Object.keys(merged.q).length}</div><div class="lbl">różnych pytań</div></div>
            <div class="stat-tile"><div class="num">${Object.keys(merged.u).length}</div><div class="lbl">zapytań bez odpowiedzi</div></div>
        </div>
        <div class="stats-cols">
            <div class="stats-col">
                <h3>Najczęściej zadawane pytania</h3>
                ${rows(topQ, maxQ, statsQuestionText)}
            </div>
            <div class="stats-col">
                <h3>Zapytania bez trafienia</h3>
                ${rows(topU, maxU, (k) => '„' + k + '”')}
            </div>
        </div>
        <div class="unanswered-detail" id="unanswered-detail">
            <h3>🔍 Nietrafione zapytania — do uzupełnienia bazy wiedzy</h3>
            <p class="stats-empty" id="unanswered-empty">Ładowanie...</p>
            <div id="unanswered-list"></div>
        </div>
        <div class="stats-history">
            <div class="hist-head">
                <h3>Historia pytań (dane kumulowane, nic nie jest kasowane)</h3>
                <div class="hist-toggle">
                    <button type="button" data-hist="month" class="${histGran === 'month' ? 'active' : ''}">Miesiące</button>
                    <button type="button" data-hist="week" class="${histGran === 'week' ? 'active' : ''}">Tygodnie</button>
                </div>
            </div>
            <div id="stats-history-body">${histRows}</div>
        </div>
        <div class="stats-meta">Okres: ${periodSelectLabel()} · ostatnia aktualizacja: ${fmtDate(stats.updated)} · dane anonimowe, bez identyfikacji użytkowników</div>`;
}

/* ── Sekcja "Nietrafione zapytania" — lista + przycisk Dodaj do FAQ ─── */
function renderUnansweredDetail() {
    const panel = $('unanswered-panel');
    const container = $('unanswered-list');
    const emptyEl = $('unanswered-empty');
    if (!container) return;

    // Zbierz nietrafione zapytania z wszystkich dziennych bucketów
    const queries = new Map(); // normalized -> { raw, count, dates }
    if (stats && stats.daily) {
        Object.entries(stats.daily).forEach(([date, bucket]) => {
            const u = bucket.unanswered || {};
            Object.entries(u).forEach(([k, v]) => {
                const existing = queries.get(k);
                if (existing) {
                    existing.count += v;
                    if (!existing.dates.includes(date)) existing.dates.push(date);
                } else {
                    queries.set(k, { raw: k, count: v, dates: [date] });
                }
            });
        });
    }

    // Posortuj malejąco po liczbie wystąpień
    const sorted = Array.from(queries.values())
        .sort((a, b) => b.count - a.count);

    if (sorted.length === 0) {
        if (panel) panel.style.display = 'none';
        return;
    }

    if (panel) panel.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';

    container.innerHTML = sorted.map((q, i) => {
        const lastDate = q.dates.sort().pop();
        // Sprawdź czy to zapytanie już jest w FAQ (porównanie znormalizowane)
        const existsInFaq = items.some((it) => {
            const qNorm = (it.question.pl || '').toLowerCase().trim();
            return qNorm === q.raw.toLowerCase().trim();
        });
        const btnLabel = existsInFaq ? '✅ W FAQ' : '➕ Do FAQ';
        const btnClass = existsInFaq ? 'unanswered-add-btn added' : 'unanswered-add-btn';
        const btnDisabled = existsInFaq ? 'disabled' : '';
        return `
            <div class="unanswered-row">
                <span class="unanswered-text">„${escHtml(q.raw)}"</span>
                <span class="unanswered-count">${q.count}×${q.dates.length > 1 ? ' (' + q.dates.length + ' dni)' : ''}</span>
                <span class="unanswered-date">${escHtml(lastDate)}</span>
                <button type="button" class="${btnClass}" data-add-faq="${escHtml(q.raw)}" ${btnDisabled} title="Dodaj to jako nowe pytanie w FAQ">${btnLabel}</button>
            </div>`;
    }).join('');
}

/* Dodaje nietrafione zapytanie jako nowe puste pytanie w FAQ */
function addUnansweredToFaq(text) {
    const id = items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
    const newItem = {
        id,
        category: { pl: '', en: '' },
        question: { pl: text, en: '' },
        answer: { pl: '', en: '' },
        keywords: [],
        synonyms: [],
        media: []
    };
    items.push(newItem);
    renderAll(id);
    setDirty(true);
    showMsg('Dodano pytanie #' + id + ' z nietrafionego zapytania: „' + text + '”. Uzupełnij odpowiedź i zapisz.', 'ok');

    // Oznacz przycisk jako dodany
    const btn = document.querySelector(`[data-add-faq="${text}"]`);
    if (btn) {
        btn.textContent = '✅ Dodano';
        btn.classList.add('added');
        btn.disabled = true;
    }

    // Przewiń do nowego pytania
    setTimeout(() => {
        const card = document.querySelector(`.item-card[data-id="${id}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

async function loadStats() {
    const body = $('stats-body');
    if (body) body.innerHTML = '<p class="empty-note">Ładowanie statystyk...</p>';
    try {
        const res = await fetch('stats.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        stats = await res.json();
    } catch (e) {
        stats = null;
    }
    renderStats();
    renderUnansweredDetail();
}

/* ── Eksport do XLSX (bez zewnętrznych bibliotek) ───────────────────────── */

function xlsxEscape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function xlsxCol(n) { // 1 -> A, 27 -> AA
    let s = '';
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function xlsxSheetXml(sheet) {
    const rows = sheet.rows.map((r, ri) => {
        const cells = r.map((c, ci) => {
            const ref = xlsxCol(ci + 1) + (ri + 1);
            if (c === null || c === undefined || c === '') return `<c r="${ref}"/>`;
            if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t>${xlsxEscape(c)}</t></is></c>`;
        });
        return `<row r="${ri + 1}">${cells.join('')}</row>`;
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        rows.join('') + '</sheetData></worksheet>';
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function utf8(str) { return new TextEncoder().encode(str); }

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/* sheets: [{ name, rows: [[cell,...], ...] }] */
function xlsxBuild(sheets) {
    const files = [];
    const add = (name, data) => files.push({ name, data });

    add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>');

    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>');

    add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        sheets.map((s, i) => `<sheet name="${xlsxEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>');

    add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>');

    add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        '</styleSheet>');

    sheets.forEach((s, i) => add('xl/worksheets/sheet' + (i + 1) + '.xml', xlsxSheetXml(s)));

    // ZIP (metoda STORE — bez kompresji, Excel akceptuje)
    let offset = 0;
    const parts = [];
    const central = [];
    files.forEach((f) => {
        const nameBytes = utf8(f.name);
        const dataBytes = utf8(f.data);
        const crc = crc32(dataBytes);
        const size = dataBytes.length;

        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true);
        lh.setUint16(4, 20, true);
        lh.setUint16(6, 0, true);
        lh.setUint16(8, 0, true); // STORE
        lh.setUint16(10, 0, true);
        lh.setUint16(12, 0, true);
        lh.setUint32(14, crc, true);
        lh.setUint32(18, size, true);
        lh.setUint32(22, size, true);
        lh.setUint16(26, nameBytes.length, true);
        lh.setUint16(28, 0, true);
        parts.push(new Uint8Array(lh.buffer), nameBytes, dataBytes);

        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true);
        ch.setUint16(4, 20, true);
        ch.setUint16(6, 20, true);
        ch.setUint16(8, 0, true);
        ch.setUint16(10, 0, true);
        ch.setUint16(12, 0, true);
        ch.setUint16(14, 0, true);
        ch.setUint32(16, crc, true);
        ch.setUint32(20, size, true);
        ch.setUint32(24, size, true);
        ch.setUint16(28, nameBytes.length, true);
        ch.setUint16(30, 0, true);
        ch.setUint16(32, 0, true);
        ch.setUint16(34, 0, true);
        ch.setUint16(36, 0, true);
        ch.setUint32(38, 0, true);
        ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), nameBytes);
        offset += 30 + nameBytes.length + size;
    });

    const cdSize = central.reduce((a, u) => a + u.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    eocd.setUint16(20, 0, true);

    return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportXlsx() {
    if (!stats || !stats.daily || Object.keys(stats.daily).length === 0) {
        showMsg('Brak danych do eksportu — statystyki zbiorą się po pierwszych pytaniach pracowników.', 'error');
        return;
    }

    const days = filterDays(statsDailyList());
    const merged = mergeBuckets(days);
    const topQ = Object.entries(merged.q).sort((a, b) => b[1] - a[1]).slice(0, 50);
    const topU = Object.entries(merged.u).sort((a, b) => b[1] - a[1]).slice(0, 50);
    const history = groupDays(statsDailyList(), 'month');

    const rowsStats = [];
    rowsStats.push(['Statystyki pytań — FAQ Damen']);
    rowsStats.push(['Wygenerowano', new Date().toLocaleString('pl-PL')]);
    rowsStats.push(['Okres', periodSelectLabel()]);
    rowsStats.push([]);
    rowsStats.push(['PODSUMOWANIE']);
    rowsStats.push(['Zadanych pytań', merged.total]);
    rowsStats.push(['Różnych pytań', Object.keys(merged.q).length]);
    rowsStats.push(['Zapytań bez odpowiedzi', Object.keys(merged.u).length]);
    rowsStats.push([]);
    rowsStats.push(['NAJCZĘŚCIEJ ZADAWANE PYTANIA']);
    rowsStats.push(['Pytanie', 'Liczba']);
    topQ.forEach(([k, v]) => rowsStats.push([statsQuestionText(k), v]));
    if (!topQ.length) rowsStats.push(['(brak)']);
    rowsStats.push([]);
    rowsStats.push(['ZAPYTANIA BEZ TRAFIENIA']);
    rowsStats.push(['Treść zapytania', 'Liczba']);
    topU.forEach(([k, v]) => rowsStats.push(['„' + k + '”', v]));
    if (!topU.length) rowsStats.push(['(brak)']);
    rowsStats.push([]);
    rowsStats.push(['HISTORIA (WEDŁUG MIESIĘCY)']);
    rowsStats.push(['Miesiąc', 'Liczba pytań']);
    history.forEach((g) => rowsStats.push([periodLabel(g.key, 'month'), g.total]));

    const rowsFaq = [['ID', 'Kategoria (PL)', 'Pytanie PL', 'Pytanie EN',
        'Odpowiedź PL', 'Odpowiedź EN', 'Słowa kluczowe', 'Synonimy']];
    items.forEach((it) => rowsFaq.push([
        it.id, it.category.pl, it.question.pl, it.question.en,
        it.answer.pl, it.answer.en,
        it.keywords.join(', '), it.synonyms.join(', ')
    ]));

    const blob = xlsxBuild([
        { name: 'Statystyki', rows: rowsStats },
        { name: 'FAQ - odpowiedzi', rows: rowsFaq }
    ]);
    downloadBlob(blob, 'faq_statystyki.xlsx');
    showMsg('Pobrano faq_statystyki.xlsx — arkusz „Statystyki” + arkusz „FAQ - odpowiedzi”.', 'ok');
}

/* ── Renderowanie ───────────────────────────────────────────────────────── */
function renderCard(item, open) {
    const card = document.createElement('div');
    card.className = 'item-card' + (open ? ' open' : '');
    card.dataset.id = item.id;

    const body = `
        <div class="card-body">
            <div class="lang-cols">
                ${LANGS.map((l) => `
                    <div class="lang-col">
                        <h4>${LANG_NAMES[l]}</h4>
                        <label>Kategoria
                            <input data-field="category" data-lang="${l}" value="${escHtml(item.category[l])}">
                        </label>
                        <label>Pytanie
                            <textarea data-field="question" data-lang="${l}" rows="2">${escHtml(item.question[l])}</textarea>
                        </label>
                        <label>Odpowiedź
                            <textarea data-field="answer" data-lang="${l}" rows="6">${escHtml(item.answer[l])}</textarea>
                        </label>
                    </div>`).join('')}
            </div>
            <div class="tags-row">
                <label>Słowa kluczowe (oddziel przecinkami)
                    <input data-field="keywords" data-lang="all" value="${escHtml(item.keywords.join(', '))}">
                </label>
                <label>Synonimy (oddziel przecinkami)
                    <input data-field="synonyms" data-lang="all" value="${escHtml(item.synonyms.join(', '))}">
                </label>
            </div>
            <div class="media-row">
                <div class="media-head">
                    <span class="media-label">Media w odpowiedzi (obraz / wideo)</span>
                    <button type="button" class="media-add-btn" data-media-add="img">📋 Wklej obraz (Ctrl+V)</button>
                    <button type="button" class="media-add-btn" data-media-add="vid">🎬 Dodaj wideo</button>
                </div>
                <div class="media-hint">Wklej obraz ze schowka (skopiuj obraz, potem kliknij tu i naciśnij Ctrl+V) lub wybierz plik wideo. Media trafią do odpowiedzi jako grafika/odtwarzacz.</div>
                <div class="media-list">
                    ${Array.isArray(item.media) && item.media.length ? item.media.map((m, i) => mediaEntryHtml(item, m, i)).join('') : ''}
                </div>
            </div>
        </div>`;

    card.innerHTML = `
        <div class="card-header" data-act="toggle">
            <span class="item-id">#${item.id}</span>
            <span class="item-q">${escHtml(item.question.pl) || '(brak pytania po polsku)'}</span>
            <span class="item-cat">${escHtml(item.category.pl) || '—'}</span>
            <span class="card-actions">
                <button type="button" class="icon-btn" data-act="up" title="Przesuń w górę">▲</button>
                <button type="button" class="icon-btn" data-act="down" title="Przesuń w dół">▼</button>
                <button type="button" class="icon-btn danger" data-act="delete" title="Usuń pytanie">✕</button>
                <button type="button" class="icon-btn" data-act="toggle" title="Rozwiń / zwiń">▾</button>
            </span>
        </div>
        ${body}`;

    return card;
}

function renderAll(openId) {
    const listEl = $('items-list');
    listEl.innerHTML = '';
    if (items.length === 0) {
        listEl.innerHTML = '<p class="empty-note">Brak pytań. Kliknij „Dodaj pytanie”.</p>';
    } else {
        items.forEach((it) => listEl.appendChild(renderCard(it, it.id === openId)));
    }
    updateCount();
}

function updateCount() {
    const t = ($('filter-input').value || '').trim().toLowerCase();
    if (!t) {
        $('count').textContent = items.length + (items.length === 1 ? ' pytanie' : ' pytań');
        return;
    }
    const shown = items.filter((it) => searchableText(it).includes(t)).length;
    $('count').textContent = shown + ' / ' + items.length;
}

function applyFilter() {
    const t = ($('filter-input').value || '').trim().toLowerCase();
    items.forEach((it) => {
        const card = document.querySelector('.item-card[data-id="' + it.id + '"]');
        if (!card) return;
        card.style.display = (!t || searchableText(it).includes(t)) ? '' : 'none';
    });
    updateCount();
}

function setDirty(v) {
    dirty = v;
    const b = $('btn-save');
    b.disabled = !v;
    b.textContent = v ? '💾 Zapisz zmiany' : '💾 Zapisz api.json';
}

/* ── Zapis ──────────────────────────────────────────────────────────────── */
function downloadJson(json) {
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, 'api.json');
}

function save() {
    const json = JSON.stringify(items, null, 4);

    // Ostrzeżenia, ale nie blokujemy zapisu — HR może być w trakcie edycji.
    const missing = items.filter((it) => !it.question.pl.trim() || !it.answer.pl.trim());
    if (missing.length > 0) {
        showMsg('Uwaga: ' + missing.map((it) => '#' + it.id).join(', ') + ' — brak polskiego pytania lub odpowiedzi. Zapisuję mimo to.', 'error');
    }
    const bigMedia = items.filter((it) => (it.media || []).some((m) => m.src && m.src.length > 4 * 1024 * 1024));
    if (bigMedia.length > 0) {
        showMsg('Uwaga: pytania ' + bigMedia.map((it) => '#' + it.id).join(', ') + ' mają duże media (powyżej ~4 MB) — plik api.json będzie ciężki.', 'error');
    }

    downloadJson(json);
    setDirty(false);
    showMsg('Pobrano api.json — zastąp nim plik na serwerze, aby zmiany były widoczne.', 'info');
}

/* ── Zdarzenia ──────────────────────────────────────────────────────────── */
function bind() {
    const listEl = $('items-list');

    listEl.addEventListener('click', (e) => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const card = el.closest('.item-card');
        if (!card) return;
        const id = Number(card.dataset.id);
        const act = el.dataset.act;

        if (act === 'toggle') {
            card.classList.toggle('open');
            return;
        }

        if (act === 'delete') {
            const item = items.find((i) => i.id === id);
            if (!item) return;
            if (!confirm('Usunąć pytanie #' + id + '?\n\n' + (item.question.pl || '(brak treści)'))) return;
            items = items.filter((i) => i.id !== id);
            renderAll();
            setDirty(true);
            showMsg('Usunięto pytanie #' + id + '.', 'ok');
            return;
        }

        if (act === 'up' || act === 'down') {
            const idx = items.findIndex((i) => i.id === id);
            const to = act === 'up' ? idx - 1 : idx + 1;
            if (to < 0 || to >= items.length) return;
            const [it] = items.splice(idx, 1);
            items.splice(to, 0, it);
            renderAll();
            setDirty(true);
        }
    });

    // Media: dodawanie obrazu / wideo / usuwanie
    listEl.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-media-add]');
        if (addBtn) {
            const card = addBtn.closest('.item-card');
            if (!card) return;
            activeMediaId = Number(card.dataset.id);
            if (addBtn.dataset.mediaAdd === 'vid') {
                const file = $('media-file');
                if (file) file.click();
            } else {
                const head = addBtn.closest('.media-head');
                if (head) head.focus();
                showMsg('Skopiuj obraz (Ctrl+C) i wciśnij Ctrl+V — trafi do pytania #' + activeMediaId + '.', 'info');
            }
            return;
        }
        const delBtn = e.target.closest('[data-media-del]');
        if (delBtn) {
            const card = delBtn.closest('.item-card');
            if (!card) return;
            const item = items.find((i) => i.id === Number(card.dataset.id));
            if (!item) return;
            const idx = Number(delBtn.dataset.mediaDel);
            if (idx >= 0 && idx < item.media.length) {
                item.media.splice(idx, 1);
                setDirty(true);
                renderAll(item.id);
                showMsg('Usunięto media z pytania #' + item.id + '.', 'ok');
            }
        }
    });

    // Wklejanie obrazu ze schowka (Ctrl+V)
    document.addEventListener('paste', (e) => {
        if (!activeMediaId) return;
        const files = e.clipboardData && e.clipboardData.files;
        const img = files && Array.from(files).find((f) => f.type.startsWith('image/'));
        if (!img) return;
        e.preventDefault();
        addMedia(activeMediaId, img);
        activeMediaId = null;
    });

    // Podpisy mediów
    listEl.addEventListener('input', (e) => {
        const capEl = e.target.closest('[data-media-caption]');
        if (capEl) {
            const card = capEl.closest('.item-card');
            if (!card) return;
            const item = items.find((i) => i.id === Number(card.dataset.id));
            if (!item) return;
            const idx = Number(capEl.dataset.mediaCaption);
            if (item.media[idx]) item.media[idx].caption = capEl.value;
            setDirty(true);
            return;
        }
        const f = e.target.dataset.field;
        if (!f) return;
        const card = e.target.closest('.item-card');
        if (!card) return;
        const item = items.find((i) => i.id === Number(card.dataset.id));
        if (!item) return;
        const lang = e.target.dataset.lang;

        if (f === 'keywords') item.keywords = splitTags(e.target.value);
        else if (f === 'synonyms') item.synonyms = splitTags(e.target.value);
        else item[f][lang] = e.target.value;

        setDirty(true);

        if (f === 'question' && lang === 'pl') {
            const q = card.querySelector('.item-q');
            if (q) q.textContent = item.question.pl || '(brak pytania po polsku)';
        }
        if (f === 'category' && lang === 'pl') {
            const c = card.querySelector('.item-cat');
            if (c) c.textContent = item.category.pl || '—';
        }
    });

    const fileInput = $('media-file');
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (file && activeMediaId) {
                addMedia(activeMediaId, file);
            }
            activeMediaId = null;
            fileInput.value = '';
        });
    }

    $('btn-add').addEventListener('click', () => {
        const id = items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
        items.push(newItem(id));
        renderAll(id);
        setDirty(true);
        showMsg('Dodano nowe pytanie #' + id + ' — uzupełnij pola i zapisz.', 'ok');
    });

    $('btn-save').addEventListener('click', save);
    $('btn-xlsx').addEventListener('click', exportXlsx);
    $('btn-stats-refresh').addEventListener('click', () => {
        loadStats();
        showMsg('Odświeżono statystyki (dane historyczne pozostają nienaruszone).', 'info');
    });

    $('stats-period').addEventListener('change', (e) => {
        statsPeriod = Number(e.target.value);
        renderStats();
    });

    // Delegacja: przełącznik tygodnie/miesiące powstaje dopiero przy renderowaniu.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-hist]');
        if (!btn) return;
        histGran = btn.dataset.hist;
        document.querySelectorAll('.hist-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
        renderStats();
    });

    $('filter-input').addEventListener('input', applyFilter);

    // Ctrl+S / Cmd+S zapisuje zmiany.
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (dirty) save();
        }
    });

    // Delegacja: przyciski "➕ Do FAQ" przy nietrafionych zapytaniach.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-add-faq]');
        if (!btn) return;
        const text = btn.dataset.addFaq;
        if (text) addUnansweredToFaq(text);
    });
}

/* ── Start ──────────────────────────────────────────────────────────────── */
async function init() {
    bind();

    try {
        const res = await fetch('api.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const parsed = await res.json();
        if (!Array.isArray(parsed)) throw new Error('to nie jest tablica');
        items = ensureUniqueIds(parsed.map(normalize));
        renderAll();
        loadStats();
        showMsg('Wczytano api.json. Zmiany zapiszesz przez „Zapisz api.json” (pobranie pliku) — zastępujesz nim plik na serwerze.', 'info');
    } catch (e) {
        showMsg('Nie udało się wczytać api.json (' + e.message + ').', 'error');
        renderAll();
        loadStats();
    }
}

document.addEventListener('DOMContentLoaded', init);
