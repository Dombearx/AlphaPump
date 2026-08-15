#!/usr/bin/env bash
#
# Zakłada w repozytorium etykiety, których używa segregacja zgłoszeń zwrotnych.
#
# Uruchom raz, zanim usługa `triage` po raz pierwszy założy issue. GitHub
# odrzuca żądanie z nieznaną etykietą, więc bez tego kroku pierwszy przebieg
# zakończyłby się błędem na każdym zgłoszeniu.
#
# Wymaga zalogowanego `gh` (`gh auth login`).
#
#   scripts/triage-labels.sh [właściciel/repozytorium]

set -euo pipefail

REPO="${1:-Dombearx/AlphaPump}"

# Nazwy muszą się zgadzać z `TRIAGE_LABEL_*` w `deploy/.env` **i** z warunkiem
# w `.github/workflows/agent-issue.yml`. Trzy miejsca, jedna prawda — zmiana
# w jednym bez pozostałych oznacza issue, którego nikt nie podejmie.
etykieta() {
  local nazwa="$1" kolor="$2" opis="$3"
  if gh label create "$nazwa" --repo "$REPO" --color "$kolor" --description "$opis" 2>/dev/null; then
    echo "utworzono: $nazwa"
  else
    # Etykieta o tej nazwie zwykle już istnieje (`bug` i `enhancement` GitHub
    # zakłada sam przy tworzeniu repozytorium) — wtedy tylko wyrównujemy opis.
    gh label edit "$nazwa" --repo "$REPO" --color "$kolor" --description "$opis" >/dev/null
    echo "zaktualizowano: $nazwa"
  fi
}

etykieta ai-triage 5319e7 \
  "Zgłoszenie założone automatycznie z opinii użytkownika; uruchamia agenta w Akcjach"
etykieta bug d73a4a \
  "Coś działa niezgodnie z oczekiwaniem"
etykieta enhancement a2eeef \
  "Nowa funkcja lub zmiana zachowania, po ustaleniu zakresu na Discordzie"

echo
echo "Gotowe. Etykiety w $REPO:"
gh label list --repo "$REPO" --search ai-triage
