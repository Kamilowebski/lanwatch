# Lanwatch

Lanwatch to desktopowa aplikacja do prowadzenia ewidencji maszyn w lokalnej
sieci. Serwer działa w Node.js, interfejs korzysta z HTML, JavaScript i
Bootstrap, a dane są przechowywane w SQLite.

## Wymagania

- Node.js w wersji 22.5 lub nowszej (wymagana wbudowana obsługa `node:sqlite`)
- npm
- Dostęp do internetu w przeglądarce, aby pobrać arkusz stylów Bootstrap z CDN

## Uruchomienie

W katalogu projektu wykonaj:

```bash
npm start
```

Testy można uruchomić poleceniem `npm test`.

Otwórz `http://localhost:3000`. Serwer domyślnie nasłuchuje na wszystkich
interfejsach sieciowych, więc można też otworzyć aplikację z innego urządzenia
w zaufanej sieci lokalnej, używając adresu IP komputera z serwerem.

Port można zmienić przez `PORT`, a interfejs nasłuchiwania przez `HOST`.
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
  opcjonalna nazwa urządzenia/grupy, lokalizacja, kategoria, opis, numer linii,
  numerator i zależności od innych maszyn. Wspólna nazwa grupy łączy elementy
  jednego urządzenia, np. głowice Bizerby; wyszukiwarka znajduje wszystkie
  elementy tej grupy.
- Zarządzanie kategoriami i lokalizacjami w zakładce „Ustawienia”. Nazwę użytej
  lokalizacji można zmienić, a jej usunięcie jest zablokowane, gdy przypisane są
  do niej maszyny.
- Przy pierwszym uruchomieniu tworzone są kategorie: Terminal, Komputer, Server,
  drukarka, Raspberry pi, kamera, detektor, waga, bizerba i inne.
- Tabela z nazwą hosta, adresem IP, lokalizacją, typem i statusem.
- Lista grupuje elementy o tej samej nazwie w jeden zwijany wiersz; wyszukiwanie
  i filtry typu, lokalizacji oraz statusu dotyczą całej grupy.
- Stronicowanie pokazuje domyślnie 20 pozycji (grup lub pojedynczych maszyn).
  Ustawienie 10, 20, 50 albo 100 pozycji znajduje się w „Ustawieniach” i jest
  zapamiętywane w przeglądarce.
- Wybór zależności ma wyszukiwarkę po nazwie hosta, grupie, IP, lokalizacji
  i typie; zaznaczenia pozostają wybrane podczas filtrowania wyników.
- Przy dodawaniu kolejnych elementów można użyć „Zapisz i dodaj następną”;
  formularz zachowuje wtedy grupę, lokalizację i kategorię.
- Ręczne sprawdzanie dostępności po kliknięciu statusu maszyny. Aplikacja używa
  wyłącznie systemowego polecenia `ping` (ICMP), wysyła trzy próby i sprawdza
  także pozostałe elementy tej samej grupy oraz ich bezpośrednie zależności.
- Wyniki pingowania i czas ostatniego sprawdzenia są zapisywane w bazie oraz
  pokazywane w tabeli i dashboardzie. Status „Brak odpowiedzi” oznacza brak
  odpowiedzi na wszystkie trzy próby ICMP, nie pewność, że urządzenie jest
  wyłączone (np. firewall może blokować ICMP).
- Jasny i ciemny motyw zapamiętywany w przeglądarce.

Ping jest uruchamiany wyłącznie po kliknięciu i tylko do adresów lokalnych:
prywatnych adresów IPv4, lokalnych adresów IPv6 lub nazw hostów rozpoznanych
na taki adres. Bez adresu IP systemowy resolver rozpoznaje nazwę hosta (może
użyć DNS); same próby diagnostyczne są wyłącznie ICMP. Aplikacja nie wykonuje
sond TCP/UDP ani skanowania portów, nie ma też automatycznego odpytywania w tle.

## Bezpieczeństwo

Aplikacja nie ma logowania ani kontroli dostępu. Udostępniaj ją tylko w zaufanej
sieci; aby ograniczyć dostęp do komputera lokalnego, ustaw `HOST` na
`127.0.0.1`.

## Zasada aktualizacji dokumentacji

Przy każdej zmianie funkcjonalności lub dodaniu elementu projektu zaktualizuj
ten plik README, aby opisywał aktualny sposób działania i uruchamiania aplikacji.
