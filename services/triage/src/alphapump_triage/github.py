"""Adapter GitHuba — zakładanie issue i wykrywanie powiązanych pull requestów.

Wykrywanie PR-ki idzie przez oś czasu issue (`/timeline`), a nie przez
wyszukiwarkę. Powód jest praktyczny: oś czasu pokazuje zdarzenia `cross-referenced`
i `connected`, czyli dokładnie to, co GitHub sam uznał za powiązanie — łącznie
z tym, które powstaje z frazy „Fixes #12" w opisie PR-ki. Wyszukiwarka pełnotekstowa
znajdowałaby też PR-ki, które numer issue tylko wspominają, i ma osobny,
znacznie niższy limit zapytań.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from .models import ExistingIssue, IssueRef, PullRequestRef

logger = logging.getLogger(__name__)


class GitHubError(RuntimeError):
    """GitHub odrzucił żądanie albo odpowiedział czymś nieoczekiwanym."""


class GitHubIssues:
    def __init__(
        self,
        token: str,
        repo: str,
        api_url: str = "https://api.github.com",
        timeout: float = 30.0,
    ) -> None:
        self._repo = repo
        self._client = httpx.AsyncClient(
            base_url=api_url.rstrip("/"),
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "alphapump-triage",
            },
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Żądanie z ponowieniem przy limicie zapytań i błędach 5xx."""

        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                response = await self._client.request(method, path, **kwargs)
            except httpx.HTTPError as error:
                last_error = error
            else:
                if response.status_code < 400:
                    return response
                # 403 z zerowym licznikiem to wyczerpany limit, nie brak
                # uprawnień — GitHub używa tego samego kodu do obu rzeczy.
                rate_limited = response.status_code in (403, 429) and (
                    response.headers.get("x-ratelimit-remaining") == "0"
                )
                if not (rate_limited or response.status_code >= 500):
                    raise GitHubError(
                        f"{method} {path} → {response.status_code}: {response.text[:500]}"
                    )
                last_error = GitHubError(f"{method} {path} → {response.status_code}")

            if attempt < 3:
                delay = 5 * attempt
                logger.warning("GitHub: %s, ponawiam za %ds", last_error, delay)
                await asyncio.sleep(delay)

        raise GitHubError(f"{method} {path} nie powiodło się: {last_error!r}")

    async def create_issue(self, title: str, body: str, labels: list[str]) -> IssueRef:
        response = await self._request(
            "POST",
            f"/repos/{self._repo}/issues",
            json={"title": title, "body": body, "labels": labels},
        )
        data = response.json()
        return IssueRef(number=int(data["number"]), url=data["html_url"])

    async def list_open_issues(self, label: str) -> list[ExistingIssue]:
        """Otwarte issue z podaną etykietą, od najnowszych.

        Pull requesty są w tym samym zasobie co issue i trzeba je odsiać ręcznie
        — poznaje się je po kluczu `pull_request` w odpowiedzi.
        """

        response = await self._request(
            "GET",
            f"/repos/{self._repo}/issues",
            params={
                "state": "open",
                "labels": label,
                "per_page": 100,
                "sort": "created",
                "direction": "desc",
            },
        )
        issues: list[ExistingIssue] = []
        for item in response.json():
            if "pull_request" in item:
                continue
            issues.append(
                ExistingIssue(
                    number=int(item["number"]),
                    title=item.get("title") or "",
                    body=item.get("body") or "",
                    url=item["html_url"],
                )
            )
        return issues

    async def comment(self, issue_number: int, body: str) -> None:
        await self._request(
            "POST",
            f"/repos/{self._repo}/issues/{issue_number}/comments",
            json={"body": body},
        )

    async def linked_pull_request(self, issue_number: int) -> PullRequestRef | None:
        """Pierwszy pull request powiązany z issue albo `None`.

        „Pierwszy" znaczy najstarszy w osi czasu: gdy do jednego issue powstanie
        kilka PR-ek, ta pierwsza jest tą, o której warto powiadomić — kolejne są
        zwykle poprawkami do niej.
        """

        response = await self._request(
            "GET",
            f"/repos/{self._repo}/issues/{issue_number}/timeline",
            params={"per_page": 100},
        )
        for event in response.json():
            source = _pull_request_from_event(event)
            if source is not None:
                return source
        return None


def _pull_request_from_event(event: dict) -> PullRequestRef | None:
    """Wyciąga PR-kę ze zdarzenia osi czasu, jeśli to jest zdarzenie powiązania."""

    if event.get("event") not in {"cross-referenced", "connected"}:
        return None

    # `cross-referenced` trzyma drugą stronę powiązania w `source.issue`,
    # a to, że jest ona PR-ką, poznaje się po zagnieżdżonym `pull_request`.
    issue = (event.get("source") or {}).get("issue") or {}
    pull_request = issue.get("pull_request")
    if not pull_request:
        return None

    url = pull_request.get("html_url") or issue.get("html_url")
    if not url:
        return None
    return PullRequestRef(
        number=int(issue["number"]),
        url=url,
        title=issue.get("title") or f"PR #{issue.get('number')}",
    )
