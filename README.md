# Lanwatch

Minimalny szkielet aplikacji z serwerem Node.js.

## Wymagania

- Node.js w wersji 18 lub nowszej
- npm

## Uruchomienie

W katalogu projektu wykonaj:

```bash
npm start
```

Serwer nasłuchuje domyślnie na porcie `3000`. Możesz zmienić port, ustawiając
zmienną środowiskową `PORT`, na przykład w PowerShell:

```powershell
$env:PORT=4000
npm start
```

Po uruchomieniu otwórz `http://localhost:3000` (lub adres z wybranym portem).
Serwer odpowiada tekstem `Serwer Lanwatch działa.`

## Zasada aktualizacji dokumentacji

Przy każdej zmianie funkcjonalności lub dodaniu elementu projektu zaktualizuj
ten plik README, aby opisywał aktualny sposób działania i uruchamiania aplikacji.
