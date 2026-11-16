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
Lokalizację bazy można zmienić zmienną `DB_PATH`.

## Funkcje

- Dodawanie, edycja i usuwanie maszyn.
- Dane maszyny: nazwa hosta, IP, lokalizacja, kategoria, opis, numer linii,
  numerator i zależności od innych maszyn.
- Zarządzanie kategoriami; przy pierwszym uruchomieniu tworzone są kategorie:
  Terminal, Komputer, Server, drukarka, Raspberry pi, kamera, detektor, waga,
  bizerba i inne.
- Tabela z nazwą hosta, adresem IP, lokalizacją, typem i statusem.
- Wyszukiwanie maszyn oraz podsumowanie liczby maszyn, kategorii i lokalizacji.
- Jasny i ciemny motyw zapamiętywany w przeglądarce.

Status urządzeń ma obecnie wartość informacyjną „Nie sprawdzono”. Aplikacja nie
sonduje maszyn ani nie monitoruje ich dostępności.

## Bezpieczeństwo

Aplikacja nie ma logowania ani kontroli dostępu. Udostępniaj ją tylko w zaufanej
sieci; aby ograniczyć dostęp do komputera lokalnego, ustaw `HOST` na
`127.0.0.1`.

## Zasada aktualizacji dokumentacji

Przy każdej zmianie funkcjonalności lub dodaniu elementu projektu zaktualizuj
ten plik README, aby opisywał aktualny sposób działania i uruchamiania aplikacji.
