# Lanwatch

Aktualna wersja: **1.2.0**. Zmiany opisuje [CHANGELOG.md](CHANGELOG.md).

Lanwatch to desktopowa aplikacja do prowadzenia ewidencji maszyn w lokalnej
sieci. Serwer działa w Node.js, interfejs korzysta z HTML, JavaScript i
Bootstrap, a dane są przechowywane w SQLite.

## Wymagania

- Node.js w wersji 22.5 lub nowszej (wymagana wbudowana obsługa `node:sqlite`)
- npm
- Dostęp do internetu w przeglądarce, aby pobrać arkusz stylów Bootstrap z CDN
- Windows PowerShell i klient OpenSSH na komputerze z serwerem (dla tunelu VNC)

## Uruchomienie

W katalogu projektu wykonaj:

```bash
npm start
```

Testy można uruchomić poleceniem `npm test`.

Otwórz `http://localhost:3000`. Serwer domyślnie nasłuchuje tylko na `127.0.0.1`. Dostęp przez LAN jest wyłączony; zmienna `HOST` jest ignorowana.

Port można zmienić przez `PORT`. Interfejs jest na stałe ustawiony na `127.0.0.1`.
Przykład w PowerShell:

```powershell
$env:PORT=4000
$env:HOST="127.0.0.1"
npm start
```

Domyślna baza SQLite tworzy się automatycznie w `data/lanwatch.sqlite`.
Lokalizację bazy można zmienić zmienną `DB_PATH`. Przy aktualizacji istniejące
lokalizacje maszyn są automatycznie dodawane do listy lokalizacji.
Baza w katalogu `data/` oraz zależności w `node_modules/` są pomijane przez Git.

## Funkcje

- Dodawanie, edycja i usuwanie maszyn.
- Dane maszyny: nazwa hosta, opcjonalny adres IP (np. dla urządzeń z DHCP),
  opcjonalna nazwa urządzenia/grupy, lokalizacja, kategoria, opis, numer linii
  i numerator. Wspólna nazwa grupy łączy elementy jednego urządzenia, np.
  głowice Bizerby; wyszukiwarka znajduje wszystkie elementy tej grupy.
- Zależności można dodać podczas tworzenia maszyny. Dla istniejącej maszyny
  przycisk „Zależności” otwiera osobny edytor, w którym można wyszukać i dodać
  inne maszyny, usuwać obecne relacje oraz zapisać same zależności bez zmiany
  pozostałych danych maszyny.
- Nazwa hosta i niepusty adres IP muszą być unikalne (bez rozróżniania wielkości
  liter). Formularz sprawdza duplikaty podczas wpisywania, a serwer ponownie
  weryfikuje je przy zapisie.
- Zarządzanie kategoriami i lokalizacjami w zakładce „Ustawienia”. Nazwę użytej
  lokalizacji można zmienić, a jej usunięcie jest zablokowane, gdy przypisane są
  do niej maszyny.
- Przy pierwszym uruchomieniu tworzone są kategorie: Terminal, Komputer, Server,
  drukarka, Raspberry pi, kamera, detektor, waga, bizerba i inne.
- Tabela z nazwą hosta, adresem IP, lokalizacją, typem i statusem.
- Lista grupuje elementy o tej samej nazwie w jeden zwijany wiersz; wyszukiwanie
  i filtry typu, lokalizacji oraz statusu dotyczą całej grupy.
- Wyszukiwanie maszyny pokazuje także wszystkie maszyny połączone z nią
  zależnościami, również wtedy, gdy wskazują na nią inne maszyny.
- Stronicowanie pokazuje domyślnie 20 pozycji (grup lub pojedynczych maszyn).
  Ustawienie 10, 20, 50 albo 100 pozycji znajduje się w „Ustawieniach” i jest
  zapamiętywane w przeglądarce.
- Wybór zależności ma wyszukiwarkę po nazwie hosta, grupie, IP, lokalizacji
  i typie; zaznaczenia pozostają wybrane podczas filtrowania wyników.
- Przyciski zapisu pozostają widoczne na dole przewijanego formularza maszyny.
- Przy dodawaniu kolejnych elementów można użyć „Zapisz i dodaj następną”;
  formularz zachowuje wtedy grupę, lokalizację i kategorię.
- Enter w formularzu maszyny zapisuje bieżącą maszynę; „Zapisz i dodaj następną”
  pozostaje osobną akcją.
- Ręczne sprawdzanie dostępności po kliknięciu statusu maszyny. Aplikacja używa
  wyłącznie systemowego polecenia `ping` (ICMP), wysyła trzy próby i sprawdza
  także pozostałe elementy tej samej grupy oraz ich bezpośrednie zależności.
  Przycisk „Pinguj widoczne” sprawdza osobno maszyny z bieżącej strony wyników,
  bez sprawdzania ich zależności i bez otwierania raportu.
- Wyniki pingowania i czas ostatniego sprawdzenia są zapisywane w bazie oraz
  pokazywane w tabeli i dashboardzie. Status „Brak odpowiedzi” oznacza brak
  odpowiedzi na wszystkie trzy próby ICMP, nie pewność, że urządzenie jest
  wyłączone (np. firewall może blokować ICMP).
- Status Online wygasa po 5 minutach od ostatniego sprawdzenia i zmienia się na
  „Nieustalony”. Widok odświeża się po upływie tego czasu; nie uruchamia to
  kolejnych pingów.
- Monitoring pojedynczej maszyny włącza się przyciskiem „Monitor” w jej wierszu
  zakładki „Maszyny”; nie włącza on monitorowania grupy ani zależności. Zakładka
  „Monitor” pokazuje tylko wybrane maszyny, ich status i opóźnienie. Aktywne
  maszyny są sprawdzane w cyklach uruchamianych co 15 sekund,
  z limitem 8 równoczesnych prób. Długi cykl nie nakłada się na następny;
  przy dużej liczbie maszyn odstęp między próbami może przekroczyć 15 sekund.
  Ręczne próby korzystają z tej samej kolejki, a trwająca próba dla tej samej
  maszyny jest współdzielona. Widok odświeża się co 5 sekund. Dla każdej maszyny można osobno włączyć
  powiadomienia o przejściu online i braku odpowiedzi. Powiadomienia wymagają
  otwartej karty Lanwatch, a systemowe dodatkowo zgody przeglądarki.
- Dla kategorii „Terminal” wspólnego użytkownika SSH konfiguruje się w
  „Ustawieniach”; nie trzeba podawać go osobno dla każdej maszyny. Połączenie
  używa nazwy hosta, np. `ssh użytkownik@nazwa-hosta`. Uwierzytelnienie
  korzysta ze standardowej konfiguracji OpenSSH, kluczy/ssh-agent lub monitu
  SSH w PowerShell. Lanwatch nie zapisuje haseł SSH.
- Przycisk „Tunel VNC” otwiera okno PowerShell i uruchamia w nim OpenSSH;
  przeglądarka nie wykonuje poleceń SSH ani nie pokazuje zdalnego terminala.
  Uruchamiana komenda SSH zawiera tylko przekierowanie i cel, np.
  `ssh -4 -L 5900:localhost:5900 użytkownik@nazwa-hosta`; połączenie
  pozostaje interaktywne w PowerShell. Mały komunikat w aplikacji potwierdza
  uruchomienie okna. Zamknij okno PowerShell, aby zakończyć tunel. TigerVNC
  uruchom na tym samym komputerze i połącz z `127.0.0.1:5900`.
- Przed uruchomieniem Lanwatch sprawdza, czy nazwa hosta wskazuje na adres
  lokalny. Samo SSH działa bez dodatkowych parametrów i korzysta z domyślnych
  ustawień OpenSSH oraz `known_hosts`; ewentualne potwierdzenie klucza hosta
  lub hasła wpisz w oknie PowerShell. Widoczne okno wymaga uruchomienia
  Lanwatch w aktywnej sesji użytkownika Windows, nie jako usługi systemowej.
- Jasny i ciemny motyw zapamiętywany w przeglądarce.

Ping jest uruchamiany po kliknięciu lub cyklicznie dla maszyn z włączonym
monitoringiem, wyłącznie do adresów lokalnych: prywatnych i link-local adresów IPv4 lub nazw hostów rozpoznanych na taki adres IPv4. Bez adresu
IP systemowy resolver rozpoznaje nazwę hosta (może użyć DNS); same próby
diagnostyczne są wyłącznie ICMP. Aplikacja nie wykonuje sond TCP/UDP ani
skanowania portów.

## Bezpieczeństwo

Aplikacja nie ma logowania ani kontroli dostępu. Domyślnie jest dostępna
wyłącznie na komputerze serwera. Żądania zmieniające dane z innego źródła
przeglądarki są odrzucane; dane w treści żądania wymagają `application/json`. Serwer jest na stałe ograniczony do `127.0.0.1`; nie udostępnia API przez LAN. Uruchamianie tunelu SSH i zmiana globalnego użytkownika SSH
odrzucają żądania spoza loopbacku i żądania bez lokalnego źródła przeglądarki.
Używaj adresu `http://localhost:3000`, aby otwierać okna PowerShell z tunelami.

## Zasada aktualizacji dokumentacji

Przy każdej zmianie funkcjonalności lub dodaniu elementu projektu zaktualizuj
ten plik README, aby opisywał aktualny sposób działania i uruchamiania aplikacji.


## Poprawki niezawodności i testy

Kategorie domyślne są dodawane tylko podczas tworzenia tabeli kategorii.
Usunięcie lub zmiana nazwy pozostaje zachowana po restarcie, także w istniejącej bazie.
Parser ping nie uznaje samego kodu zakończenia 0 za odpowiedź hosta;
obsługuje opóźnienie `czas=` polskiego Windows oraz odpowiedzi IPv6.
Automatyczne odświeżanie przelicza listę i stronicowanie przy aktywnym filtrze statusu.
Wynik próby dla poprzedniego hosta lub IP nie nadpisuje statusu zmienionej maszyny.

GitHub Actions uruchamia testy na Windows i Linux z Node.js 22 i 24.
Testy interfejsu sprawdzają logikę odświeżania bez przeglądarki;
nie zastępują sprawdzenia wyglądu i rzeczywistego tunelu PowerShell na Windows.

## Historia dostępności

W szczegółach maszyny znajduje się historia rzeczywistych sprawdzeń ping:
czas, status, docelowy adres, liczba odpowiedzi, opóźnienie i komunikat.
Zapisywane są próby ręczne i monitoring. Historia jest trwała w SQLite,
wyświetlana od najnowszych po 50 wpisów z przyciskiem „Pokaż starsze”.
Dla każdej maszyny zachowywane jest ostatnie 1000 wyników. Usunięcie maszyny
usuwa jej historię. Zmiana IP zachowuje stare wpisy z poprzednim adresem.
Wcześniejsze sprawdzenia nie są odtwarzane; historia zaczyna się po aktualizacji.
Wygaśnięcie statusu Online nie tworzy wpisu, ponieważ nie wykonuje nowego pingu.

Historia w szczegółach maszyny ma przewijaną tabelę ze stałym nagłówkiem,
kolorowe etykiety statusów, osobne daty i godziny oraz wyrównane opóźnienia.
Widok obsługuje jasny i ciemny motyw, stany ładowania, pustej historii i błędu z ponowieniem.

## Automatyczne kopie bazy

Aplikacja tworzy lokalną kopię SQLite przy pierwszym uruchomieniu danego dnia.
Podczas pracy sprawdza co godzinę, czy rozpoczął się kolejny dzień; wtedy tworzy
nową kopię. Gdy aplikacja jest wyłączona, kopie nie powstają.
Kopia obejmuje całą bazę: ewidencję, ustawienia i historię sprawdzeń.

Kopie znajdują się w `data/backups/lanwatch-RRRR-MM-DD.sqlite`.
Przy własnym `DB_PATH` katalog `backups` powstaje obok pliku bazy.
Zachowywanych jest siedem ostatnich dziennych kopii. Ponowny start tego samego
dnia nie nadpisuje istniejącej kopii. Błąd kopii jest wypisywany w konsoli;
aplikacja działa dalej i ponowi próbę przy następnym sprawdzeniu.
Snapshot SQLite jest tworzony przez `VACUUM INTO`, a gotowy plik jest przenoszony
na docelową nazwę przed usunięciem najstarszych kopii.

Aby przywrócić dane: zatrzymaj aplikację, zachowaj kopię aktualnego katalogu
`data`, zastąp `lanwatch.sqlite` wybraną kopią i usuń ewentualne pozostałe pliki
`lanwatch.sqlite-wal` oraz `lanwatch.sqlite-shm` z katalogu roboczej bazy.
Następnie uruchom aplikację ponownie. Dla `DB_PATH` wykonaj te kroki przy wskazanym pliku.

Zapis maszyny ma limit oczekiwania na odpowiedź serwera (15 sekund).
Błędy są pokazywane wewnątrz formularza, a przyciski są odblokowywane.
Błąd odświeżenia listy po udanym zapisie jest zgłaszany osobno; nie wymaga ponownego dodania maszyny.

## Odporność na zawieszenia

Kopia bazy jest wykonywana w osobnym wątku z osobnym połączeniem SQLite.
Baza pracuje w trybie WAL, aby kopia nie kolidowała z zapisem ewidencji i historii.
Rozpoznawanie nazwy hosta ma limit 5 sekund, a uruchomienie okna PowerShell — 10 sekund.
Dłuższe pingowanie wielu maszyn ma limit dopasowany do liczby maszyn i kolejki,
nie krótki limit używany przy zwykłym zapisie danych.

Starsze odpowiedzi odświeżania nie nadpisują nowszych danych. Przesunięcie zegara
nie powoduje natychmiastowej pętli odświeżania. Odmowa dostępu do pamięci ustawień
przeglądarki nie blokuje startu aplikacji. Błędy działań w otwartym oknie są
pokazywane w tym oknie. Niezapisana nazwa użytkownika SSH nie znika przy odświeżaniu.
Zapis ustawień monitora nie czeka na decyzję w oknie zgody na powiadomienia.

## Diagnostyka zawieszeń

Logi serwera znajdują się w `data/logs/lanwatch.log` (przy własnym `DB_PATH`:
`logs` obok bazy). To pliki tekstowe JSON, jeden wpis na linię. Zapisywane są:
rozpoczęcie i zakończenie żądania API, jego status HTTP, czas wykonania,
błędy oraz ostrzeżenia po 8 sekundach oczekiwania. Wpisy `request.waiting`
zawierają też długość kolejki pingowania i informację o trwającej kopii.
`requestId` łączy wpisy przeglądarki i serwera. Treści formularzy nie są logowane.
Logowanie plików jest asynchroniczne. Plik ma limit około 5 MB, zachowywanych
jest maksymalnie 7 plików (bieżący i 6 poprzednich).

Przeglądarka zgłasza błędy JavaScript, nieobsłużone odrzucenia Promise, błędy
żądań API i przekroczenia czasu w konsoli F12. Próbuje również zapisać je
na lokalnym serwerze; jeśli ten nie odpowiada, wpisy pozostają w konsoli
i w pamięci sesji przeglądarki (`lanwatch-diagnostics`, maksymalnie 100 wpisów).
Przesyłanie logów nie ponawia samo siebie przy błędzie.

Opóźnienia pętli serwera powyżej 2 sekund oraz przeglądarki powyżej 10 sekund
są zgłaszane po odzyskaniu możliwości wykonania kodu. Zamrożony proces nie może
sam wypisać komunikatu w trakcie blokady. Po problemie zachowaj `data/logs`
przed restartem; w F12 włącz zachowywanie dziennika przed odświeżeniem.

Kolumna statusu rezerwuje miejsce na datę jeszcze przed pierwszym pingiem, aby wynik nie zmieniał wysokości wiersza ani szerokości kolumny.

Nazwy maszyn mają lokalne ikony SVG odpowiadające kategorii (bez pobierania ikon z internetu). Nieznane kategorie i grupy mieszane mają ikonę ogólną. Kliknięcie nazwy w monitorze otwiera szczegóły i historię sprawdzeń; działa też z klawiatury.

Monitor zachowuje niezmienione wiersze i aktualizuje status, czas oraz opóźnienie bez przebudowy tabeli.
Co 5 sekund pobierana jest lista maszyn. Kategorie, lokalizacje i ustawienia są
pobierane przy pełnym odświeżeniu po operacji oraz co minutę podczas pracy w tle.
Nagłówek pokazuje stan połączenia i czas ostatniego udanego odświeżenia.
Ręczny ping wyprzedza oczekujące sprawdzenia automatyczne; nie przerywa trwających prób.
Ponowne żądanie dla maszyny już w kolejce podnosi jej priorytet bez dublowania próby.

## Raport i notatki monitora

Przycisk „Raport” i nazwa maszyny w Monitorze otwierają raport jednej maszyny.
Zakresy: 1 godzina, 24 godziny, 7 dni oraz cała zachowana historia (do 1000 wyników).
Wykres pokazuje faktyczne chwile sprawdzeń i ich statusy. Karty pokazują procent
sprawdzeń Online, bez odpowiedzi i nieustalonych oraz średnie opóźnienie Online.
Procenty nie oznaczają czasu działania — przerwy między pomiarami nie są mierzone.
Raport obejmuje zarówno ręczne sprawdzenia, jak i monitoring. Odświeża się przy otwarciu,
zmianie zakresu lub po użyciu przycisku „Odśwież raport”.

Każda monitorowana maszyna ma osobną notatkę (do 1000 znaków), zapisywaną przyciskiem
„Zapisz notatkę”. Notatka przetrwa odświeżenie i restart aplikacji, dopóki maszyna jest
monitorowana. Wyłączenie monitora usuwa ją; nie zmienia opisu w ewidencji ani historii.
Monitor nie ma osobnej kolumny IP; adres pozostaje dostępny w szczegółach maszyny.

Monitor pokazuje raport pod nazwą maszyny, a wyłączenie monitora na końcu wiersza.
Notatka jest domyślnie tekstem; „Edytuj” lub „Dodaj notatkę” otwiera edytor z zapisem
oraz anulowaniem. Odświeżanie zachowuje wpisywany tekst. Powiadomienia mają etykiety
„Powrót online” i „Brak odpowiedzi”. Wiersze bez odpowiedzi są delikatnie wyróżniane;
opcja „Bez odpowiedzi na początku” jest zapamiętywana w przeglądarce.
Czas sprawdzenia ma postać względną (np. „12 s temu”) i aktualizuje się lokalnie
co sekundę; dokładna data jest dostępna po najechaniu. Nie uruchamia to pingowania.

## Maszyny i konfiguracja

Tabela maszyn oferuje szybkie filtry Wszystkie / Bez odpowiedzi / Monitorowane z licznikami
maszyn (grupy pozostają wyświetlane w całości). Przeglądarka zapamiętuje wyszukiwanie,
filtry, stronę i rozwinięte grupy. „Szczegóły” jest główną akcją wiersza, a menu „⋯”
zawiera monitoring, tunel VNC dla terminali, zależności, edycję i usuwanie.
Formularz dzieli się na dane podstawowe, lokalizację i klasyfikację oraz dane dodatkowe.

Konfiguracja ma sekcje kategorii, lokalizacji, SSH, wyglądu i kopii zapasowych.
Kategorie i lokalizacje pokazują liczbę przypisanych maszyn. Usuwanie używanych pozycji
jest zablokowane z wyjaśnieniem; serwer nadal niezależnie sprawdza ograniczenie.
SSH sygnalizuje niezapisane zmiany, zapis, sukces i błąd. Pole nie traci nowego wpisu,
jeśli użytkownik zmieni go w trakcie zapisu. Motyw i rozmiar strony są ustawieniami
przeglądarki. Sekcja kopii pokazuje czas i lokalizację ostatniego gotowego pliku oraz
liczbę kopii, odświeżaną przy otwarciu Konfiguracji, pełnym odświeżeniu i na żądanie.

Przy dodawaniu maszyny pierwsza litera nazwy hosta automatycznie podpowiada kategorię:
T — Terminal, D/N — Komputer, P/Z — drukarka (bez rozróżniania wielkości liter).
Ręczny wybór ma pierwszeństwo. „Zastosuj podpowiedź” pozwala ponownie użyć sugestii.
Przy edycji istniejącej maszyny kategoria nie zmienia się automatycznie.
Brak kategorii w konfiguracji wyświetla komunikat; aplikacja jej sama nie tworzy.

## Komendy i snippety — wyłącznie kopiowanie

Zakładka „Komendy” to lokalna biblioteka tekstów w SQLite: nazwa, opis, system,
powłoka, kategoria, tagi, treść oraz ulubione. Dostępne są wyszukiwanie, filtry,
dodawanie, edycja, usuwanie oraz „Kopiuj”. Komenda jest kopiowana dosłownie;
aplikacja nigdy nie uruchamia wpisów z biblioteki ani nie podmienia ich parametrów.
Przykładowe HOST i UZYTKOWNIK należy zmienić samodzielnie przed użyciem w konsoli.
Sześć przykładowych wpisów jest tworzonych tylko przy pierwszej inicjalizacji biblioteki.

Eksport JSON zapisuje całą bibliotekę, niezależnie od aktywnych filtrów.
Import JSON wersji 1 dopisuje do 200 wpisów (plik do 900 KB); nie nadpisuje istniejących.
Wszystkie wpisy są walidowane przed transakcyjnym importem. Ponowny import może
utworzyć duplikaty. Biblioteka jest objęta automatyczną kopią całej bazy SQLite.

## Wersje i aktualizacja

Obecne pełne wydanie to `lanwatch-1.2.0.zip`. Wersja w `package.json` jest
źródłem numeru pokazywanego w stopce, komunikacie startowym PowerShell,
logu `server.started` i nagłówku HTTP `X-Lanwatch-Version`.
Schemat: `1.1.1` — poprawki, `1.2.0` — nowe funkcje, `2.0.0` — zmiany wymagające
szczególnych kroków przy aktualizacji. Przy następnym wydaniu zmień `package.json`,
aktualną wersję w README i `CHANGELOG.md`, a pełną paczkę nazwij zgodnie z numerem.

Aby zaktualizować: zatrzymaj serwer, zachowaj własny katalog `data` (lub plik
wskazany w `DB_PATH` wraz z kopiami), zastąp pliki programu z pełnej paczki,
uruchom `npm start` i odśwież stronę przez Ctrl+F5. Nowy numer pojawi się w stopce.
Migracje SQLite są wykonywane automatycznie przy starcie. Paczka nie zawiera
bazy użytkownika, logów ani kopii zapasowych.

## Adresy IPv4

Pole IP jest opcjonalne i sprawdzane podczas wpisywania oraz na serwerze przy
każdym dodawaniu i edycji. Wymagane są cztery liczby 0–255 rozdzielone kropkami,
bez zer wiodących (np. `192.168.1.10`). Spacje na końcach są usuwane.
Adresy IPv6, CIDR, adresy z portem i nazwy hostów w polu IP są odrzucane.
Nazwy hostów wpisuje się w osobnym polu; resolver używa tylko IPv4.
SSH używa `-4`. Ograniczenie pingowania do lokalnych adresów IPv4 pozostaje.
Walidacja formatu przy zapisie nie wymaga, aby maszyna była dostępna.
Istniejące rekordy nie są usuwane; stare niepoprawne IP lub IPv6 należy poprawić
przy edycji. Historia wcześniejszych sprawdzeń pozostaje do wglądu.
