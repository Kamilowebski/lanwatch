# Historia zmian Lanwatch

## 1.5.0 — 2026-11-25

- Konfigurowalny interwał 15–3600 s (domyślnie 60 s), 1–5 prób ICMP (domyślnie 3), limit 1–16 maszyn równolegle (domyślnie 8).
- Potwierdzenie ręcznych serii od 20 maszyn z liczbą maszyn i maksymalną liczbą prób ICMP.
- Trwała pauza całego monitora lub wybranej grupy, bez utraty maszyn, notatek i powiadomień. Oczekujące automatyczne zadania respektują pauzę; trwające kończą się normalnie, ręczny ping nadal działa.
- Powiadomienie o braku odpowiedzi dopiero po 1–10 kolejnych nieudanych sprawdzeniach (domyślnie 3). Pierwszy brak odpowiedzi jest widoczny od razu; online lub błąd polecenia przerywa serię.
- Wskazówka „Sprawdź najpierw” dla nieodpowiadającej zależności, z zaznaczeniem, że nie dowodzi przyczyny awarii.
- Wyszukiwanie monitora po hoście, IP, grupie i notatce oraz filtr problemów.
- Stan cyklu, postęp, kolejka, aktywne próby i czas zakończenia poprzedniego cyklu.
- Delikatne kolory wierszy według statusu w monitorze i ewidencji, również w ciemnym motywie.

## 1.4.4 — 2026-11-25

- Krótkie oznaczenia liczników grup i zależności zamiast wielowierszowych opisów; pełne znaczenie w podpowiedzi i etykiecie dostępności.
- Uporządkowane odstępy i metadane grup w ewidencji.
- Mapa układa połączone zestawy osobno i rozmieszcza maszyny według odległości od centralnego urządzenia.
- Wskazanie maszyny myszą lub klawiaturą wyróżnia jej bezpośrednie relacje, przygaszając pozostałą część mapy.

## 1.4.3 — 2026-11-25

- Podświetlanie widocznych wierszy powiązanej maszyny po najechaniu lub ustawieniu fokusu na nazwie zależności.
- Oddzielne liczniki braku odpowiedzi i nieustalonych wyników dla maszyn grupy i zależności spoza grupy.
- Trwałe oznaczenie maszyn automatycznie dołączonych do monitora i lista aktywnych maszyn nadrzędnych, również przez zależności pośrednie.
- Naprawione odświeżanie tabeli z nagłówkami sekcji rozwiniętej grupy; liczniki aktualizują się bez przebudowania wierszy.
- Istniejące wpisy monitora zachowują dotychczasowe działanie; sposób ich wcześniejszego dodania nie jest odtwarzany.

## 1.4.2 — 2026-11-25

- Rozwinięta grupa rozdziela własne maszyny i zależności spoza grupy, bez powielania urządzeń wewnątrz rozwinięcia.
- Klikalne nazwy w kolumnie Zależności i lista „Wymagana przez” przy zewnętrznych zależnościach.
- Włączanie monitora pojedynczej maszyny również automatycznie obejmuje wszystkie zależności, z zachowaniem ich ustawień powiadomień i notatek.
- Wyłączanie monitora nadal dotyczy wyłącznie wskazanych maszyn.

## 1.4.1 — 2026-11-25

- Zbiorcze włączanie monitora dla zaznaczonych maszyn i grup dołącza wszystkie zależności, również pośrednie.
- Wspólne zależności i cykle nie powodują powtórzeń. Wyłączanie dotyczy wyłącznie zaznaczonych maszyn.
- Rozwinięta grupa pokazuje także zależności pośrednie z opisem, dla których maszyn są wymagane.
- Potwierdzenie i komunikat wyniku wyjaśniają dołączanie zależności.

## 1.4.0 — 2026-11-25

- Retencja historii pingowania: 1, 7 (domyślnie) lub 30 dni zamiast limitu 1000 wyników; usuwanie starszych danych partiami.
- Raport z zakresem 30 dni i wydrukiem do PDF przez przeglądarkę. Statystyki obejmują wszystkie pomiary, a duży wykres ma ograniczoną liczbę punktów.
- Trwałe oznaczanie ulubionych maszyn i szybki filtr w ewidencji.
- Graficzna mapa zależności ze statusami, powiększaniem i przechodzeniem do szczegółów maszyny.
- Zakładka Zmiany: historia edycji ewidencji, poprzednie i nowe wartości, filtrowanie po maszynie oraz zachowanie wpisów po usunięciu urządzenia.
- Testy retencji, dużych raportów, transakcyjności dziennika i ponownego użycia identyfikatorów usuniętych maszyn.

## 1.3.0 — 2026-11-25

- Lokalny Bootstrap 5.3.8 z licencją: interfejs nie wymaga internetu ani CDN.
- Kopiowanie hosta i IPv4 w szczegółach maszyny, również wewnątrz okna dialogowego.
- Eksport ewidencji CSV dla Excela (UTF-8 BOM, separator średnik) i import z podglądem.
- Import do 500 maszyn / 900 KB, automatyczne tworzenie kategorii i lokalizacji,
  przenoszenie zależności po nazwach hostów i transakcyjne odrzucanie błędnych plików.
- Zaznaczanie maszyn oraz całych grup, utrzymanie zaznaczeń między stronami
  i zbiorcza zmiana lokalizacji, kategorii lub stanu monitorowania.
- Import snippetów pomija duplikaty treści w tym samym systemie i powłoce,
  również w obrębie importowanego pliku, i pokazuje liczbę pominiętych wpisów.
- Usunięty zduplikowany pasek szybkich filtrów w tabeli maszyn.

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
