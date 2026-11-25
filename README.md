# Lanwatch

[![Tests](https://github.com/Kamilowebski/lanwatch/actions/workflows/test.yml/badge.svg)](https://github.com/Kamilowebski/lanwatch/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Wersja 1.2.1** · [Historia zmian](CHANGELOG.md) · [Licencja MIT](LICENSE)

Lokalna aplikacja do ewidencji urządzeń, monitorowania dostępności i przechowywania
komend administracyjnych. Działa w przeglądarce, z serwerem Node.js i bazą SQLite
na tym samym komputerze. Interfejs jest w języku polskim.

**Dostęp wyłącznie przez localhost.** Serwer nasłuchuje na `127.0.0.1`; nie udostępnia
panelu przez LAN. Na Windows korzysta z systemowego **`ping.exe`**, **OpenSSH (`ssh`)**
i **Windows PowerShell**. Biblioteka komend służy wyłącznie do kopiowania tekstu.

## Funkcje

| Zakładka | Możliwości |
| --- | --- |
| **Maszyny** | Dodawanie i edycja, grupy urządzeń, zależności, wyszukiwanie, filtry z licznikami, stronicowanie, ikony kategorii i zapamiętywanie widoku. |
| **Monitor** | Statusy i opóźnienia, względny czas sprawdzenia, powiadomienia, sortowanie maszyn bez odpowiedzi i notatki na czas monitorowania. |
| **Raport maszyny** | Wykres chwil sprawdzeń, procenty wyników, średnie opóźnienie oraz zakres godziny, doby, tygodnia lub zachowanej historii. |
| **Komendy** | Własne snippety, system i powłoka, kategorie, tagi, wyszukiwanie, ulubione, kopiowanie oraz import i eksport JSON. |
| **Konfiguracja** | Kategorie i lokalizacje z liczbami przypisań, użytkownik SSH, motyw, rozmiar strony i status kopii zapasowych. |

Dodatkowo: automatyczne kopie całej bazy, logi diagnostyczne z rotacją i automatyczne
migracje istniejącej bazy przy uruchomieniu.

## Wymagania

- **Node.js 24 LTS — zalecany**, wraz z npm. Minimalna wersja: **22.13.0**,
  udostępniająca `node:sqlite` bez dodatkowej flagi uruchomieniowej.
- Windows do pełnej obsługi tuneli VNC w PowerShell. Ewidencja, biblioteka i monitoring
  mogą działać także na Linuxie, jeśli dostępne jest systemowe polecenie `ping`.
- **Microsoft Edge — zalecana przeglądarka.** W dotychczasowym użytkowaniu Firefox
  wykazywał problemy z odświeżaniem; ich przyczyna nie została potwierdzona.
- Dostęp do CDN w przeglądarce do pobrania arkusza Bootstrap. Dane aplikacji są lokalne,
  ale arkusz stylów jest pobierany z `cdn.jsdelivr.net`.
- Do tunelu VNC: klient OpenSSH, Windows PowerShell i osobny klient VNC, np. TigerVNC.
  Serwer należy uruchomić w aktywnej sesji użytkownika Windows.

Projekt korzysta z modułów wbudowanych w Node.js. **Nie wymaga `npm install`**
ani osobnej instalacji serwera bazy danych.

## Szybki start — Windows PowerShell

Zainstaluj [Node.js](https://nodejs.org/) i [Git for Windows](https://git-scm.com/downloads/win),
a następnie wykonaj:

```powershell
git clone https://github.com/Kamilowebski/lanwatch.git
cd lanwatch
node --version
npm start
```

Jeśli pobierasz projekt jako ZIP z GitHuba, rozpakuj go i otwórz PowerShell w katalogu
z plikiem `package.json`. Git nie jest wtedy potrzebny do uruchomienia.

Otwórz **http://127.0.0.1:3000** lub **http://localhost:3000** w Edge.
Zatrzymanie serwera: **Ctrl+C** w PowerShell. Nie otwieraj `public/index.html`
bezpośrednio z dysku — interfejs wymaga działającego serwera.

Przy pierwszym uruchomieniu powstają baza, domyślne kategorie i przykładowe snippety.
Kategorie i przykładowe komendy nie są odtwarzane przy każdym restarcie po ich usunięciu.

## Pierwsze użycie

1. W **Konfiguracji** dodaj lokalizacje i dostosuj kategorie.
2. W **Maszynach** wybierz „Dodaj maszynę”. Podaj host, lokalizację i kategorię;
   adres IPv4 jest opcjonalny, np. dla urządzeń z DHCP.
3. Kliknij status, aby sprawdzić maszynę, elementy jej grupy i bezpośrednie zależności.
   „Pinguj widoczne” sprawdza maszyny na bieżącej stronie bez rozszerzania zależności.
4. W menu „⋯” włącz monitorowanie wybranej maszyny. Nazwa i link pod nią w Monitorze
   otwierają raport pojedynczego urządzenia.
5. W **Komendach** dodaj własne wpisy lub skorzystaj z przykładów. „Kopiuj” przenosi
   dosłowny tekst do schowka; aplikacja go nie wykonuje ani nie podmienia parametrów.

### Adresy, grupy i podpowiedzi kategorii

- Obsługiwane są wyłącznie **IPv4**: cztery liczby 0–255, bez zer wiodących.
  Poprawny przykład: `192.168.1.10`. Puste IP jest dozwolone.
- Walidacja działa podczas wpisywania i na serwerze przy dodawaniu oraz edycji.
  IPv6, CIDR, porty i nazwy hostów w polu IP są odrzucane. Host ma osobne pole.
- Nazwa hosta i niepusty IP muszą być unikalne. Poprawny format IP nie oznacza,
  że urządzenie musi odpowiadać w chwili zapisu.
- Wspólna nazwa grupy łączy elementy urządzenia w zwijany wiersz. Wyszukiwanie
  uwzględnia także urządzenia połączone zależnościami.
- Prefiksy hosta podpowiadają kategorię: **T → Terminal, D/N → Komputer,
  P/Z → drukarka**, bez rozróżniania wielkości liter. Ręczny wybór ma pierwszeństwo;
  przy edycji istniejącej maszyny kategoria nie zmienia się automatycznie.
- Używanych kategorii i lokalizacji nie można usunąć bez zmiany przypisań maszyn.

### Monitoring i raporty

Monitoring uruchamia cykle co **15 sekund**, a widok odświeża się co **5 sekund**.
Jednocześnie wykonuje się najwyżej **8 prób pingowania**. Ręczne żądania mają
pierwszeństwo przed oczekującymi automatycznymi, bez przerywania trwających prób.
Dłuższy cykl nie nakłada się na kolejny, więc przy dużej liczbie maszyn odstęp rośnie.

Każde sprawdzenie wysyła trzy próby ICMP. Pingowanie jest ograniczone do prywatnych
oraz link-local adresów IPv4 i hostów rozpoznanych na taki adres. Aplikacja nie skanuje
portów ani nie wykonuje sond TCP/UDP w ramach monitorowania.

**„Brak odpowiedzi” nie dowodzi wyłączenia urządzenia** — ICMP może blokować firewall.
Status Online po pięciu minutach bez świeżego wyniku zmienia się na „Nieustalony”.
Samo wygaśnięcie statusu nie wykonuje pingu i nie dopisuje wyniku do historii.

Dla maszyny zachowywanych jest do **1000 ostatnich sprawdzeń**. Historia w szczegółach
jest stronicowana po 50 wpisów. Raport obejmuje zarówno próby ręczne, jak i monitoring.
**Procenty to udział zapisanych sprawdzeń, nie procent czasu działania.** Luki między
pomiarami i usunięte starsze wyniki nie są odtwarzane.

Notatka monitora ma do 1000 znaków. Przetrwa odświeżenie i restart aplikacji,
ale **wyłączenie monitorowania usuwa notatkę**. Nie zmienia to opisu maszyny w ewidencji.
Powiadomienia wymagają otwartej karty; systemowe wymagają dodatkowo zgody przeglądarki.

### SSH i tunel VNC

Dla maszyn kategorii Terminal ustaw wspólnego użytkownika SSH w Konfiguracji.
„Tunel VNC” uruchamia widoczne okno PowerShell z systemowym OpenSSH, np.:

```powershell
ssh -4 -L 5900:localhost:5900 UZYTKOWNIK@HOST
```

Klient VNC na tym samym komputerze łączy się z **`127.0.0.1:5900`**. Uwierzytelnianie
korzysta z konfiguracji OpenSSH, kluczy, agenta lub monitu w PowerShell. Lanwatch
nie przechowuje haseł SSH. Zamknięcie okna z SSH kończy tunel.
Stały port 5900 musi być wolny; aplikacja nie przydziela osobnych portów kolejnym tunelom.

### Biblioteka komend

Wpis zawiera nazwę, opis, system, powłokę, kategorię, tagi, treść i oznaczenie ulubionego.
Przykładowe `HOST` i `UZYTKOWNIK` zmień samodzielnie przed użyciem w swojej konsoli.

Eksport JSON obejmuje całą bibliotekę niezależnie od filtrów. Import wersji 1 dopisuje
do **200 wpisów** z pliku do **900 KB**; nie nadpisuje istniejących. Ponowny import
może utworzyć duplikaty. Niepoprawny import jest odrzucany przed zapisem całej partii.

## Ustawienia uruchomienia i dane

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `PORT` | `3000` | Port lokalnego serwera HTTP. |
| `DB_PATH` | `data/lanwatch.sqlite` | Ścieżka bazy; względna jest rozwiązywana względem katalogu uruchomienia. |
| `HOST` | ignorowana | Serwer jest na stałe przypisany do `127.0.0.1`. |

Przykład w PowerShell:

```powershell
$env:PORT = "4000"
$env:DB_PATH = "C:\LanwatchData\lanwatch.sqlite"
npm start
```

Ewidencja, ustawienia SSH, monitoring, notatki, historia i snippety są w SQLite.
Motyw, filtry, rozmiar strony i rozwinięte grupy są przechowywane w przeglądarce.
Katalogi `data/` i `node_modules/` są pomijane przez Git.

Aplikacja nie ma logowania. Udostępnia panel tylko lokalnie i sprawdza źródło
żądań zmieniających dane. Funkcje SSH dodatkowo wymagają żądania z lokalnego
źródła przeglądarki i adresu loopback. Nie wystawiaj panelu przez reverse proxy ani tunel sieciowy.

## Kopie zapasowe i przywracanie

Kopia całej bazy powstaje przy pierwszym uruchomieniu danego dnia. Podczas pracy
aplikacja co godzinę sprawdza, czy rozpoczął się kolejny dzień. Wyłączona aplikacja
nie wykonuje kopii. Zachowywanych jest **7 ostatnich kopii**:

```text
data/
├── lanwatch.sqlite
├── backups/lanwatch-RRRR-MM-DD.sqlite
└── logs/lanwatch.log
```

Przy własnym `DB_PATH` katalogi `backups` i `logs` powstają obok bazy. Stan i lokalizację
ostatniej kopii sprawdzisz w Konfiguracji. Kopia jest wykonywana w osobnym wątku,
przez SQLite `VACUUM INTO`; baza pracuje w trybie WAL.

Przywracanie:

1. Zatrzymaj aplikację przez Ctrl+C.
2. Zachowaj kopię całego dotychczasowego katalogu danych, łącznie z ewentualnymi
   plikami `lanwatch.sqlite-wal` i `lanwatch.sqlite-shm`.
3. Zastąp roboczy plik `lanwatch.sqlite` wybraną kopią.
4. Usuń pozostałe pliki `lanwatch.sqlite-wal` i `lanwatch.sqlite-shm` z roboczego
   katalogu — nie łącz starego WAL z przywróconą bazą.
5. Uruchom ponownie aplikację. Dla `DB_PATH` zastosuj te kroki do wskazanej bazy.

## Aktualizacja

Każda paczka `lanwatch-X.Y.Z.zip` zawiera pełny program. Wcześniejsze paczki nie są wymagane.

1. Zatrzymaj serwer i wykonaj kopię swoich danych.
2. Podmień pliki programu, **zachowując katalog `data`** lub własną bazę z `DB_PATH`.
3. Uruchom `npm start`; migracje SQLite wykonają się automatycznie.
4. Odśwież Edge przez **Ctrl+F5** i sprawdź wersję w stopce.

Dla czystej kopii repozytorium zamiast podmiany plików można użyć `git pull --ff-only`.
Patch zawierający przygotowany commit można zastosować przez `git am SCIEZKA.patch`,
a potem wysłać `git push`. Numer w `package.json` zasila stopkę, komunikat startowy,
log `server.started` i nagłówek HTTP `X-Lanwatch-Version`.

## Diagnostyka

Logi są w `data/logs/lanwatch.log`. Zachowywanych jest do 7 plików po około 5 MB.
Zawierają błędy, czasy żądań i ich `requestId`, przebieg monitorowania i kopii.
Treści formularzy nie są logowane.

Podgląd na żywo z drugiego PowerShell w katalogu projektu:

```powershell
Get-Content .\data\logs\lanwatch.log -Tail 40 -Wait
```

Jeśli interfejs nie odpowiada:

- Sprawdź, czy PowerShell z serwerem nadal działa i czy dostępne jest
  `http://127.0.0.1:3000/api/categories`.
- W Edge otwórz **F12 → Console / Network**. Włącz zachowywanie dziennika przed odświeżeniem.
- W klasycznej konsoli Windows naciśnij Esc, jeśli zaznaczenie tekstu wstrzymało zapis do konsoli.
- Zachowaj logi przed restartem. Przeglądarka przechowuje też do 100 ostatnich wpisów
  sesji w `sessionStorage` pod kluczem `lanwatch-diagnostics`.

Ostrzeżenie o opóźnieniu pętli zdarzeń powstaje po odzyskaniu możliwości wykonania
kodu; całkowicie zablokowany proces nie może zgłosić błędu w czasie blokady.

## Testy i rozwój

```powershell
npm test
```

Testy używają wbudowanego `node:test` i izolowanych baz tymczasowych.
GitHub Actions uruchamia je na Windows i Linux z Node.js 22 oraz 24.
Testy jednostkowe nie zastępują sprawdzenia rzeczywistego tunelu PowerShell na Windows.

Najważniejsze pliki:

| Plik / katalog | Odpowiedzialność |
| --- | --- |
| `server.js` | Lokalny HTTP i API, kolejka pingowania, cykle monitora. |
| `database.js` | SQLite, migracje, ewidencja i historia. |
| `ping.js`, `terminal.js` | Systemowy ping oraz uruchamianie tunelu SSH w PowerShell. |
| `backup.js`, `diagnostics.js` | Kopie w osobnym wątku i logi. |
| `snippets.js` | Przechowywanie i walidacja biblioteki komend. |
| `public/` | Interfejs HTML, CSS i JavaScript. |

Przy zmianie funkcji zaktualizuj README i `CHANGELOG.md`. Nowe wydania otrzymują
numer wersji w `package.json`, pełną paczkę ZIP i commit/patch. Poprawki podnoszą
ostatnią część numeru (`1.2.1`), nowe funkcje środkową (`1.3.0`), a niezgodne zmiany
wymagające dodatkowych kroków aktualizacji — pierwszą (`2.0.0`).

## Licencja

Kod Lanwatch jest udostępniony na licencji **MIT** — zobacz [LICENSE](LICENSE).
Copyright © 2026 Kamilowebski. Zewnętrzne narzędzia i Bootstrap zachowują własne licencje.
