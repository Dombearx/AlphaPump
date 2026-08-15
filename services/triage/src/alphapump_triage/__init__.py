"""Segregacja zgłoszeń zwrotnych AlphaPump.

Usługa czyta zgłoszenia zapisane przez backend, klasyfikuje je modelem
językowym i prowadzi je dalej: błędy trafiają prosto na GitHuba, prośby o zmianę
najpierw na Discorda, do ustalenia zakresu. Szczegóły przebiegów są w
`service.py`, wdrożenie w `deploy/docker-compose.yml`.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
