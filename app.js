const translations = {
    pl: {
        title: 'Asystent dla nowych pracowników',
        subtitle: 'Informacje dla pracowników i gości — historia, ludzie i osiągnięcia Damen',
        placeholder: 'Zadaj pytanie...',
        button: 'Zadaj pytanie',
        answer_title: 'Odpowiedź:',
        examples_title: 'Rekomendowane pytania:',
        status: 'Status systemu:',
        language: 'Język:',
        not_found: 'Przepraszam, nie znalazłem odpowiedzi na to pytanie. Spróbuj zadać je inaczej lub wybierz jedno z pytań poniżej.',
        similar_prefix: 'Podobne pytanie: ',
        loading: 'Ładowanie pytań...',
        load_error: 'Nie udało się wczytać danych z api.json. Upewnij się, że plik jest dostępny.',
        no_questions: 'Brak dostępnych pytań.',
        show_all: 'Pokaż wszystkie pytania',
        hide_all: 'Zwiń listę',
        story_kicker: 'POZNAJ NAS',
        story_title: 'O Damen Marine Components — nasza historia',
        story_text: 'Od stoczni braci Damen w 1927 roku, przez przełom Kommera Damen, po dzisiejszą dywizję produkującą układy napędowe, stery i wyposażenie pokładowe dla statków na całym świecie.',
        story_cta: 'Czytaj opowieść →',
        similar_questions: 'Może chodziło Ci o:',
        other_category: 'Pozostałe',
        voice_title: 'Zadaj pytanie głosowo',
        voice_start: 'Słucham... powiedz swoje pytanie',
        voice_unsupported: 'Twoja przeglądarka nie obsługuje rozpoznawania mowy. Użyj Chrome lub Edge.',
        voice_error: 'Wystąpił błąd rozpoznawania mowy. Spróbuj ponownie.',
        voice_permission: 'Brak dostępu do mikrofonu. Zezwól na dostęp i spróbuj ponownie.',
        voice_no_speech: 'Nie wykryto mowy. Spróbuj jeszcze raz.',
        voice_audio: 'Nie znaleziono mikrofonu. Sprawdź urządzenia audio.'
    },
    en: {
        title: 'New Employee Assistant',
        subtitle: 'Information for employees and guests — the history, people and achievements of Damen',
        placeholder: 'Ask a question...',
        button: 'Ask',
        answer_title: 'Answer:',
        examples_title: 'Recommended questions:',
        status: 'System status:',
        language: 'Language:',
        not_found: 'Sorry, I could not find an answer to that question. Try rephrasing it or pick one of the questions below.',
        similar_prefix: 'Similar question: ',
        loading: 'Loading questions...',
        load_error: 'Failed to load data from api.json. Please make sure the file is available.',
        no_questions: 'No questions available.',
        show_all: 'Show all questions',
        hide_all: 'Collapse list',
        story_kicker: 'DISCOVER US',
        story_title: 'About Damen Marine Components — our story',
        story_text: 'From the Damen brothers\' shipyard in 1927, through Kommer Damen\'s breakthrough, to today\'s division producing propulsion systems, rudders and deck equipment for vessels around the world.',
        story_cta: 'Read the story →',
        similar_questions: 'You may have meant:',
        other_category: 'Other',
        voice_title: 'Ask your question by voice',
        voice_start: 'Listening... say your question',
        voice_unsupported: 'Your browser does not support speech recognition. Use Chrome or Edge.',
        voice_error: 'Speech recognition error. Please try again.',
        voice_permission: 'Microphone access denied. Allow access and try again.',
        voice_no_speech: 'No speech detected. Please try again.',
        voice_audio: 'No microphone found. Check your audio devices.'
    }
};

let currentLang = 'pl';
let faqData = [];
let showAllQuestions = false;
let suggestionIndex = -1;

let recognition = null;
let listening = false;
let voiceInitDone = false;
let voiceHintTimer = null;
let voiceHintSticky = false; // blokada chowania komunikatu błędu głosu przed czasem

const ANSWER_THRESHOLD = 20;
const DROPDOWN_THRESHOLD = 20;

// ── Słowa bez treści (pomijane przy dopasowaniu) ────────────────────────────
// Formy w postaci znormalizowanej (bez polskich znaków).
const STOPWORDS = new Set([
    // polski
    'co','czy','jest','sa','jak','jaki','jaka','jakie','jakich','jakis','gdzie','kiedy',
    'do','na','w','o','i','a','z','ze','po','pod','przed','dla','od','u','mozna','prosze',
    'mi','mnie','sie','swoj','swoim','swoje','swoja','ten','ta','to','tego','tej','tym',
    'ze','ktory','ktora','ktore','kto','czego','czemu','dlaczego','mam','masz','miec','byc',
    'nie','oraz','czyli','albo','lub','bardzo','tez','tylko','moge','moze','jesli','jezeli',
    'przedstaw','pokaz','wyjasnij','opisz','podaj','powiedz','podpowiedz','sprawdz','znajdz',
    'szukam','potrzebuje','chce','chcialbym','chcialabym','powinienem','powinnam','wez','zrob',
    // english
    'the','a','an','of','to','in','on','at','for','with','and','or','is','are','do','does',
    'can','how','what','where','when','why','who','my','your','i','you','me','it','we','they',
    'about','please','tell','show','explain','describe','give','know','want','need','there',
    'this','that','would','could','should','have','has','am','be','not','no','its','our'
]);

// ── Lekki stemming (polski/angielski) ───────────────────────────────────────
// Ścina najdłuższą pasującą końcówkę (jeden przebieg), aby formy odmienione
// ("regulaminem", "regulaminie", "regulations") sprowadzić do wspólnego rdzenia.
const STEM_SUFFIXES = [
    'owaniach','ywanie','owanie','owania','owymi','owych','owego',
    'iami','iach','ings','ingly','edly',
    'ami','ach','iem','iom','ens',
    'ow','om','ie','ed','en','es','em','er',
    'y','i','a','a','e','u','o','e','s','n'
].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b.length - a.length);

function stem(word) {
    if (!word || word.length < 4) return word;
    for (const suf of STEM_SUFFIXES) {
        if (word.length - suf.length >= 3 && word.endsWith(suf)) {
            return word.slice(0, word.length - suf.length);
        }
    }
    return word;
}

// ── Podobieństwo znakowe (literówki, bliskie formy) ────────────────────────
function diceSimilarity(a, b) {
    if (a.length < 3 || b.length < 3) return 0;
    const bigrams = (s) => {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
    };
    const A = bigrams(a), B = bigrams(b);
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter++; });
    return (2 * inter) / (A.size + B.size);
}

// ── Pomocnicze funkcje ──────────────────────────────────────────────────────
function normalize(str) {
    return String(str || '').toLowerCase()
        .replace(/[ąćęłńóśźż]/g, c => ({
            'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o',
            'ś': 's', 'ź': 'z', 'ż': 'z'
        }[c]));
}

function getLocalized(obj, lang = currentLang) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang] || obj.pl || obj.en || Object.values(obj)[0] || '';
}

function allLanguages(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return Object.values(obj).join(' ');
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Konwertuje markdown bold (**text**) na HTML <strong>text</strong>
function renderBold(str) {
    if (!str) return '';
    return String(str).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Zamienia tekst na listę unikalnych rdzeni (stemów) bez słów pustych.
function tokenize(text) {
    const words = normalize(text).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
    const tokens = [];
    const seen = new Set();
    words.forEach(w => {
        const st = stem(w);
        if (!seen.has(st)) { seen.add(st); tokens.push(st); }
    });
    return tokens;
}

// ── Indeks wyszukiwania (budowany raz na wpis) ─────────────────────────────
function entryCorpus(item) {
    if (!item._corpus) {
        const qText = allLanguages(item.question) + ' ' +
            (Array.isArray(item.keywords) ? item.keywords.join(' ') : '') + ' ' +
            (Array.isArray(item.synonyms) ? item.synonyms.join(' ') : '');
        item._corpus = {
            qTokens: new Set(tokenize(qText)),
            aTokens: new Set(tokenize(allLanguages(item.answer)))
        };
    }
    return item._corpus;
}

// Ocena trafności wpisu względem zapytania (rdzenie słów).
function scoreEntry(item, queryTokens) {
    const { qTokens, aTokens } = entryCorpus(item);
    let hits = 0, qHits = 0, aHits = 0;

    queryTokens.forEach(t => {
        let matched = false;

        // 1) dokładny rdzeń w pytaniu / słowach kluczowych / synonimach
        if (qTokens.has(t)) { hits++; qHits++; matched = true; }
        else if (t.length >= 4) {
            // 2) prefiks (początek słowa) — "regu" → "regulamin"
            for (const ct of qTokens) {
                if (ct.length >= 3 && (ct.startsWith(t) || t.startsWith(ct))) {
                    hits++; qHits++; matched = true; break;
                }
            }
            // 3) podobieństwo znakowe — literówki i bliskie formy
            if (!matched) {
                for (const ct of qTokens) {
                    if (diceSimilarity(t, ct) >= 0.62) { hits++; qHits++; matched = true; break; }
                }
            }
        }
        if (!matched && aTokens.has(t)) { hits++; aHits++; }
    });

    if (hits === 0) return 0;
    let score = qHits * 12 + aHits * 2;
    score += (hits / queryTokens.length) * 40; // premia za pokrycie całego zapytania
    return score;
}

function findBest(question, exclude) {
    const tokens = tokenize(question);
    if (!tokens.length) return [];
    return faqData
        .filter(f => f !== exclude)
        .map(f => ({ f, s: scoreEntry(f, tokens) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s);
}

// ── Pobieranie danych z pliku api.json ─────────────────────────────────────
async function loadFaq() {
    const examplesEl = document.getElementById('examples-list');
    const t = translations[currentLang] || translations.pl;

    if (examplesEl) {
        examplesEl.innerHTML = `<p class="loading">${escHtml(t.loading)}</p>`;
    }

    try {
        const res = await fetch('api.json', {
            headers: { 'Accept': 'application/json' }
        });

        if (!res.ok) {
            throw new Error(`Błąd HTTP: ${res.status}`);
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
            throw new Error("Pobrane dane nie są tablicą JSON.");
        }

        faqData = data;
        renderExamples();
    } catch (e) {
        console.error("Szczegóły błędu ładowania FAQ:", e);
        if (examplesEl) {
            examplesEl.innerHTML = `<p class="load-error">${escHtml(t.load_error)}</p>`;
        }
    }
}

// ── Wyświetlanie pytań (3 rekomendowane lub pełna lista) ───────────────────
function renderExamples() {
    const container = document.getElementById('examples-list');
    if (!container) return;
    const t = translations[currentLang] || translations.pl;
    container.innerHTML = '';

    if (!faqData || faqData.length === 0) {
        container.innerHTML = `<p>${escHtml(t.no_questions)}</p>`;
        return;
    }

    const renderButtons = (items) => {
        items.forEach(item => {
            const q = getLocalized(item.question);
            if (!q) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'example-question';
            btn.textContent = q;
            btn.addEventListener('click', () => useExample(q));
            container.appendChild(btn);
        });
    };

    if (showAllQuestions) {
        const groups = new Map();
        faqData.forEach(item => {
            const label = getLocalized(item.category) || t.other_category;
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(item);
        });
        groups.forEach((items, label) => {
            const heading = document.createElement('h4');
            heading.className = 'category-heading';
            heading.textContent = label;
            container.appendChild(heading);
            renderButtons(items);
        });
    } else {
        renderButtons(faqData.slice(0, 3));
    }

    if (faqData.length > 3) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'toggle-all';
        toggle.textContent = showAllQuestions ? t.hide_all : `${t.show_all} (${faqData.length})`;
        toggle.addEventListener('click', () => {
            showAllQuestions = !showAllQuestions;
            renderExamples();
        });
        container.appendChild(toggle);
    }
}

// ── Obsługa języków ────────────────────────────────────────────────────────
function setLang(lang) {
    if (!translations[lang]) return;
    if (listening) stopVoice();
    currentLang = lang;
    applyTranslations();
    updateLangLinks();
    renderExamples();
    hideSuggestions();

    const ansBox = document.getElementById('answer-box');
    if (ansBox) ansBox.style.display = 'none';

    const input = document.getElementById('question-input');
    if (input) input.value = '';
}

function applyTranslations() {
    const t = translations[currentLang] || translations['pl'];

    const titleEl = document.getElementById('title');
    if (titleEl) titleEl.textContent = t.title;
    document.title = t.title;

    const subtitleEl = document.getElementById('subtitle');
    if (subtitleEl) subtitleEl.textContent = t.subtitle;

    const inputEl = document.getElementById('question-input');
    if (inputEl) inputEl.placeholder = t.placeholder;

    const askBtn = document.getElementById('ask-btn');
    if (askBtn) askBtn.textContent = t.button;

    const ansTitle = document.getElementById('answer-title');
    if (ansTitle) ansTitle.textContent = t.answer_title;

    const exTitle = document.getElementById('examples-title');
    if (exTitle) exTitle.textContent = t.examples_title;

    const storyKicker = document.getElementById('story-kicker');
    if (storyKicker) storyKicker.textContent = t.story_kicker;
    const storyTitle = document.getElementById('story-title');
    if (storyTitle) storyTitle.textContent = t.story_title;
    const storyText = document.getElementById('story-text');
    if (storyText) storyText.textContent = t.story_text;
    const storyCta = document.getElementById('story-cta');
    if (storyCta) storyCta.textContent = t.story_cta;

    const langLabel = document.getElementById('lang-label');
    if (langLabel) langLabel.textContent = t.language;

    const micBtn = document.getElementById('mic-btn');
    if (micBtn) micBtn.title = t.voice_title;
}

function updateLangLinks() {
    ['pl', 'en'].forEach(lang => {
        const el = document.getElementById('lang-' + lang);
        if (el) {
            el.classList.toggle('active', lang === currentLang);
        }
    });
}

// ── Wyszukiwanie głosowe ───────────────────────────────────────────────────
function initVoice() {
    if (voiceInitDone) return;
    voiceInitDone = true;

    const micBtn = document.getElementById('mic-btn');
    if (!micBtn) return;
    micBtn.addEventListener('click', toggleVoice);
}

function toggleVoice() {
    const micBtn = document.getElementById('mic-btn');
    const t = translations[currentLang] || translations.pl;

    if (listening) { stopVoice(); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        showVoiceHint(t.voice_unsupported, true);
        return;
    }

    recognition = new SR();
    recognition.lang = currentLang === 'en' ? 'en-US' : 'pl-PL';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        listening = true;
        if (micBtn) micBtn.classList.add('listening');
        showVoiceHint(t.voice_start, false);
    };

    recognition.onresult = (e) => {
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            const text = r[0] && r[0].transcript ? r[0].transcript : '';
            if (r.isFinal) final += text; else interim += text;
        }
        const input = document.getElementById('question-input');
        if (input) input.value = (final + ' ' + interim).trim();

        if (final && final.trim()) {
            stopVoice();
            askQuestion();
        }
    };

    recognition.onerror = (e) => {
        let msg = t.voice_error;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') msg = t.voice_permission;
        else if (e.error === 'no-speech') msg = t.voice_no_speech;
        else if (e.error === 'audio-capture') msg = t.voice_audio;
        // najpierw pokaż błąd (ustawia blokadę), potem sprzątaj — komunikat przetrwa onend
        showVoiceHint(msg, true);
        stopVoice();
    };

    recognition.onend = () => {
        stopVoice();
    };

    recognition.start();
}

function stopVoice() {
    if (recognition) {
        try { recognition.stop(); } catch (e) { /* ignoruj */ }
        recognition = null;
    }
    listening = false;
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) micBtn.classList.remove('listening');
    hideVoiceHint();
}

function showVoiceHint(text, isError) {
    const box = document.getElementById('suggestions');
    if (!box) return;
    clearTimeout(voiceHintTimer);
    let hint = document.getElementById('voice-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'voice-hint';
        hint.className = 'voice-hint';
        box.prepend(hint);
    }
    hint.textContent = text;
    hint.classList.toggle('error', !!isError);
    box.style.display = 'block';
    if (isError) {
        voiceHintSticky = true;
        voiceHintTimer = setTimeout(() => {
            voiceHintSticky = false;
            hideVoiceHint();
        }, 5000);
    }
}

function hideVoiceHint() {
    clearTimeout(voiceHintTimer);
    if (voiceHintSticky) return; // nie chowaj komunikatu błędu przed czasem
    const hint = document.getElementById('voice-hint');
    if (hint) hint.remove();
    const box = document.getElementById('suggestions');
    if (box && box.children.length === 0) box.style.display = 'none';
}

// ── Logika wyszukiwania odpowiedzi ─────────────────────────────────────────
function askQuestion() {
    const input = document.getElementById('question-input');
    if (!input) return;

    const question = input.value.trim();
    if (!question) return;

    const t = translations[currentLang] || translations['pl'];
    hideSuggestions();

    // 1. Dokładne dopasowanie pytania w bieżącym języku
    const qn = normalize(question);
    const exact = faqData.find(f => normalize(getLocalized(f.question)) === qn);
    if (exact) {
        statsRecord(exact.id, question, true);
        showAnswer(getLocalized(exact.answer), findBest(question, exact).slice(0, 3).map(x => x.f), exact.media);
        return;
    }

    // 2. Dopasowanie semantyczne (stemming, synonimy, podobieństwo znakowe)
    const scored = findBest(question);
    if (scored.length > 0 && scored[0].s >= ANSWER_THRESHOLD) {
        const top = scored[0];
        statsRecord(top.f.id, question, true);
        showAnswer(`${t.similar_prefix}${getLocalized(top.f.question)}\n\n${getLocalized(top.f.answer)}`,
            scored.slice(1, 4).map(x => x.f), top.f.media);
    } else {
        statsRecord(null, question, false);
        showAnswer(t.not_found, scored.slice(0, 3).map(x => x.f));
    }
}

// ── Podpowiedzi na żywo (podczas pisania) ──────────────────────────────────
function onInput() {
    if (listening) return;

    const input = document.getElementById('question-input');
    if (!input) return;

    const q = input.value.trim();
    if (q.length < 2) { hideSuggestions(); return; }

    const scored = findBest(q).filter(x => x.s >= DROPDOWN_THRESHOLD).slice(0, 5);
    if (!scored.length) { hideSuggestions(); return; }

    renderSuggestions(scored.map(x => x.f));
}

function renderSuggestions(items) {
    const box = document.getElementById('suggestions');
    if (!box) return;
    box.innerHTML = '';
    suggestionIndex = -1;

    items.forEach((f, i) => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = getLocalized(f.question);
        div.addEventListener('mousedown', e => e.preventDefault()); // zachowaj focus w polu
        div.addEventListener('click', () => useExample(getLocalized(f.question)));
        div.addEventListener('mousemove', () => setActiveSuggestion(i));
        box.appendChild(div);
    });

    box.style.display = 'block';
}

function setActiveSuggestion(i) {
    const box = document.getElementById('suggestions');
    if (!box) return;
    suggestionIndex = i;
    Array.from(box.children).forEach((c, j) => c.classList.toggle('active', j === i));
}

function moveSuggestion(delta) {
    const box = document.getElementById('suggestions');
    if (!box || box.style.display !== 'block' || box.children.length === 0) return;
    const n = box.children.length;
    const next = suggestionIndex < 0 ? (delta > 0 ? 0 : n - 1) : (suggestionIndex + delta + n) % n;
    setActiveSuggestion(next);
}

function hideSuggestions() {
    const box = document.getElementById('suggestions');
    if (!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
    suggestionIndex = -1;
}

// ── Wyświetlanie odpowiedzi ────────────────────────────────────────────────
// media: [{ type: 'image'|'video', src: 'data:...'|url, caption: '...' }]
function renderMedia(container, media) {
    if (!container) return;
    container.innerHTML = '';
    if (!media || !media.length) return;

    media.forEach(m => {
        if (!m || !m.src) return;
        const el = document.createElement(m.type === 'video' ? 'video' : 'img');
        el.src = m.src;
        if (m.type === 'video') {
            el.controls = true;
            el.preload = 'metadata';
        } else {
            el.alt = m.caption || 'Odpowiedź wizualna';
        }
        container.appendChild(el);

        if (m.caption) {
            const cap = document.createElement('div');
            cap.className = 'media-caption';
            cap.textContent = m.caption;
            container.appendChild(cap);
        }
    });
}

function showAnswer(text, alternatives, media) {
    const ansText = document.getElementById('answer-text');
    const ansBox = document.getElementById('answer-box');
    const suggWrap = document.getElementById('answer-suggestions');
    const mediaWrap = document.getElementById('answer-media');

    if (!ansText || !ansBox) return;

    ansText.innerHTML = renderBold(text);
    renderMedia(mediaWrap, media);

    if (suggWrap) {
        suggWrap.innerHTML = '';
        if (alternatives && alternatives.length > 0) {
            const t = translations[currentLang] || translations.pl;
            const title = document.createElement('h4');
            title.className = 'suggestions-title';
            title.textContent = t.similar_questions;
            suggWrap.appendChild(title);

            alternatives.forEach(f => {
                const q = getLocalized(f.question);
                if (!q) return;
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'suggestion-chip';
                chip.textContent = q;
                chip.addEventListener('click', () => useExample(q));
                suggWrap.appendChild(chip);
            });
        }
    }

    ansBox.style.display = 'block';
    ansBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Funkcja obsługująca kliknięcie w przycisk z przykładowym pytaniem ──────
function useExample(text) {
    const input = document.getElementById('question-input');
    if (!input) return;
    input.value = text;
    askQuestion();
}

// ── Anonimowe statystyki pytań ─────────────────────────────────────────────
// Liczniki pytań zadawanych przez pracowników. Zapisywane lokalnie (per
// przeglądarka) i wysyłane anonimowo do stats.json (jeśli serwer to obsługuje).
// Bez identyfikatorów użytkowników — tylko liczby pytań i zapytań bez trafienia.
const STATS_KEY = 'faq_stats_v1';
const STATS_MAX_QUESTIONS = 300;
const STATS_MAX_UNANSWERED = 200;

function statsLoad() {
    try {
        const raw = localStorage.getItem(STATS_KEY);
        const d = raw ? JSON.parse(raw) : {};
        return {
            questions: (d.questions && typeof d.questions === 'object') ? d.questions : {},
            unanswered: (d.unanswered && typeof d.unanswered === 'object') ? d.unanswered : {},
            total: typeof d.total === 'number' ? d.total : 0,
            updated: d.updated || null
        };
    } catch (e) {
        return { questions: {}, unanswered: {}, total: 0, updated: null };
    }
}

function statsSave(stats) {
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) { /* tryb prywatny / brak miejsca — ignoruj */ }
}

function statsIncMap(map, key, maxKeys) {
    if (map[key] !== undefined) { map[key] += 1; return; }
    if (Object.keys(map).length >= maxKeys) return; // limit różnych kluczy
    map[key] = 1;
}

// Wysyłka pojedynczego anonimowego zdarzenia do serwera (fire-and-forget).
function statsSyncEvent(event) {
    try {
        fetch('stats.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        }).catch(() => { /* statyczny hosting bez backendu — dane zostają lokalnie */ });
    } catch (e) { /* ignoruj */ }
}

function statsRecord(itemId, rawQuestion, matched) {
    const stats = statsLoad();
    if (matched && itemId != null) {
        statsIncMap(stats.questions, String(itemId), STATS_MAX_QUESTIONS);
        statsSyncEvent({ id: itemId });
    } else {
        const k = normalize(String(rawQuestion || '')).slice(0, 120) || '?';
        statsIncMap(stats.unanswered, k, STATS_MAX_UNANSWERED);
        statsSyncEvent({ text: String(rawQuestion || '').slice(0, 120) });
    }
    stats.total += 1;
    stats.updated = new Date().toISOString();
    statsSave(stats);
}

// ── Inicjalizacja po załadowaniu drzewa DOM ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const inputField = document.getElementById('question-input');
    if (inputField) {
        inputField.addEventListener('keydown', e => {
            const box = document.getElementById('suggestions');
            const isOpen = !!box && box.style.display === 'block' && box.children.length > 0;

            if (e.key === 'Enter') {
                e.preventDefault();
                if (isOpen) {
                    const target = suggestionIndex >= 0 ? box.children[suggestionIndex] : box.children[0];
                    useExample(target.textContent);
                } else {
                    askQuestion();
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (isOpen) moveSuggestion(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (isOpen) moveSuggestion(-1);
            } else if (e.key === 'Escape') {
                hideSuggestions();
            }
        });

        inputField.addEventListener('input', onInput);
        inputField.addEventListener('blur', () => setTimeout(hideSuggestions, 120));
    }

    const askButton = document.getElementById('ask-btn');
    if (askButton) {
        askButton.addEventListener('click', askQuestion);
    }

    ['pl', 'en'].forEach(lang => {
        const langBtn = document.getElementById('lang-' + lang);
        if (langBtn) {
            langBtn.addEventListener('click', (e) => {
                e.preventDefault();
                setLang(lang);
            });
        }
    });

    // Start aplikacji
    applyTranslations();
    updateLangLinks();
    initVoice();
    loadFaq();
});
