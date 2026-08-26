# Damen FAQ — Asystent dla nowych pracowników

Interaktywny asystent FAQ dla nowych pracowników i gości **Damen Marine Components**.  
Zawiera bazę pytań i odpowiedzi dotyczących wynagrodzeń, urlopów, zwolnień lekarskich, rejestracji czasu pracy oraz wiele innych tematów codziennej pracy.

## Funkcje

- **Wyszukiwanie pytań** — wpisz pytanie lub użyj podpowiedzi na żywo
- **Obsługa głosowa** — zadawaj pytania za pomocą mikrofonu (Chrome/Edge)
- **Dwujęzyczność** — polski (PL) i angielski (EN)
- **Panel administracyjny** — zarządzanie pytaniami i odpowiedziami
- **Strona "O nas"** — historia firmy Damen z osiami czasu i rozdziałami
- **Anonimowe statystyki** — śledzenie popularności pytań (lokalnie)

## Struktura projektu

```
├── Frontend/
│   ├── index.html          # Strona główna z wyszukiwarką FAQ
│   ├── o-damen.html        # Strona "O Damen Marine Components"
│   ├── admin.html          # Panel administracyjny
│   ├── admin.js            # Logika panelu administracyjnego
│   ├── app.js              # Główna logika aplikacji (wyszukiwanie, głos, języki)
│   ├── style.css           # Style aplikacji
│   ├── api.json            # Baza pytań i odpowiedzi FAQ
│   └── stats.json          # Anonimowe statystyki pytań
├── images/
│   ├── damen-1927.svg
│   ├── dmc-dywizja.svg
│   ├── dmc-optima.svg
│   ├── ster-strumieniowy.svg
│   ├── van-der-velden.svg
│   └── zaklad-produkcyjny.svg
├── .gitattributes
└── README.md
```

## Szybki start

1. Otwórz plik `Frontend/index.html` w przeglądarce internetowej
2. Lub uruchom lokalny serwer HTTP w katalogu głównym:
   ```bash
   # Python 3
   python3 -m http.server 8080

   # Node.js (jeśli zainstalowany)
   npx serve .
   ```
3. Otwórz `http://localhost:8080/Frontend/index.html`

## Technologie

- **HTML5** — struktura stron
- **CSS3** — style, responsywność, gradienty
- **Vanilla JavaScript** — logika aplikacji, fuzzy search, Web Speech API
- **JSON** — baza danych pytań (bez serwera backend)
- **SVG** — grafiki placeholder

##ansomowe statystyki

Pytania zadawane przez pracowników zapisywane są anonimowo w pliku `stats.json` (brak identyfikatorów użytkowników, tylko liczby). Dane służą do identyfikacji najczęstszych pytań i ulepszania zawartości FAQ.

## Licencja

Projekt wewnętrzny — Damen Marine Components.
