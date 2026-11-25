# Historia zmian Lanwatch

## 1.2.1 — 2026-11-25

- Uporządkowane README: instalacja na Windows, wszystkie zakładki, IPv4, tunel VNC,
  kopie, przywracanie danych, aktualizacja, diagnostyka i rozwój projektu.
- Usunięte nieaktualne wzmianki o IPv6, dostępie przez LAN i dawnym układzie interfejsu.
- Dodana licencja MIT z plikiem LICENSE i oznaczeniem w package.json.
- Minimalna wersja Node.js skorygowana do 22.13.0, aby npm start działało
  z node:sqlite bez flagi eksperymentalnej; zalecana wersja to Node.js 24 LTS.
- Wydanie zawiera pełną funkcjonalność wersji 1.2.0; bez zmian schematu bazy.

## 1.2.0 — 2026-11-17

- Walidacja IPv4 w formularzu i na serwerze przy dodawaniu i edycji maszyny.
- Puste IP nadal dozwolone; błędne adresy i IPv6 blokują zapis z komunikatem.
- Rozpoznawanie hostów i pingowanie wyłącznie przez IPv4; SSH używa `-4`.
- Istniejąca ewidencja pozostaje zachowana; wcześniejsze błędne IP i IPv6 wymagają poprawienia przy edycji.

## 1.1.0 — 2026-11-17

Pierwsza numerowana pełna paczka przygotowana w tej rozmowie. Zawiera wszystkie
wcześniejsze poprawki i funkcje; nie wymaga pobierania poprzednich paczek.

### Dodane

- Wersja w stopce, komunikacie startowym, logach i nagłówkach odpowiedzi HTTP.
- Historia ostatnich 1000 sprawdzeń każdej maszyny i raport z wykresem,
  procentami wyników oraz średnim opóźnieniem.
- Tymczasowe notatki monitora, edytowane na żądanie i usuwane po wyłączeniu monitorowania.
- Lokalne dzienne kopie całej bazy, siedem ostatnich plików i status kopii w konfiguracji.
- Logi diagnostyczne przeglądarki i serwera z identyfikatorami żądań oraz rotacją plików.
- Biblioteka komend: wyłącznie kopiowanie, własne wpisy, filtry, ulubione,
  import i eksport JSON. Wpisy są objęte kopią SQLite.
- Ikony kategorii oraz podpowiedzi kategorii po prefiksie hosta:
  T — Terminal, D/N — Komputer, P/Z — drukarka.
- Szybkie filtry maszyn z licznikami i zapamiętywaniem widoku.
- Menu akcji maszyn, sekcje formularza, uporządkowana konfiguracja,
  liczniki przypisań i informacja o stanie zapisu SSH.
- Testy regresji i konfiguracja CI dla Windows oraz Linux.

### Poprawione

- Parser wyników pingowania Windows, polskie `czas=` i odpowiedzi IPv6.
- Aktualizacja filtra statusu i stabilność układu tabeli po pingowaniu.
- Kolejka pingowania z limitem ośmiu prób równoległych i priorytetem ręcznych żądań.
- Odświeżanie monitora bez przebudowy niezmienionych wierszy i rzadsze pobieranie ustawień.
- Widoczny stan połączenia, względny czas sprawdzenia i wyróżnienie maszyn bez odpowiedzi.
- Ochrona przed starszymi odpowiedziami, utratą wpisywanych danych i nieskończonym oczekiwaniem.
- Kopie bazy w osobnym wątku i SQLite WAL dla współbieżnych odczytów oraz zapisów.
- Trwałość zmian kategorii po restarcie i widoczne błędy w formularzach.

### Zasady działania

- Serwer nasłuchuje wyłącznie na `127.0.0.1`; `HOST` nie otwiera dostępu przez LAN.
- Ping, SSH i okna PowerShell nadal korzystają z narzędzi systemowych.
- Procenty w raporcie oznaczają udział zapisanych sprawdzeń, a nie procent czasu działania.

## 1.0.0 — wersja bazowa

Wersja oznaczona w pierwotnym `package.json` repozytorium. Nie była publikowana
jako oddzielna numerowana paczka w tej rozmowie.
