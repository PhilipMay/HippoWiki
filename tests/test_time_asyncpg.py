"""Pin the asyncpg and PostgreSQL time behaviour that spec/time.md relies on, against a real server."""

import asyncio
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest
from testcontainers.community.postgres import PostgresContainer

pytestmark = pytest.mark.podman

# Fully qualified, because Podman does not assume docker.io for short image names.
POSTGRES_IMAGE = "docker.io/library/postgres:16-alpine"


@pytest.fixture(scope="module")
def database_url() -> Iterator[str]:
    with PostgresContainer(POSTGRES_IMAGE, driver=None) as postgres:
        yield postgres.get_connection_url()


@pytest.fixture
def host_in_tokyo(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    with monkeypatch.context() as patch:
        patch.setenv("TZ", "Asia/Tokyo")
        time.tzset()
        yield
    time.tzset()


def fetch_datetime(url: str, query: str, *args: object, session_time_zone: str = "UTC") -> datetime:
    async def run() -> datetime:
        connection = await asyncpg.connect(url, server_settings={"timezone": session_time_zone})
        try:
            value = await connection.fetchval(query, *args)
        finally:
            await connection.close()
        assert isinstance(value, datetime)
        return value

    return asyncio.run(run())


@pytest.mark.parametrize("session_time_zone", ["UTC", "Europe/Berlin", "Asia/Tokyo"])
def test_timestamptz_is_returned_as_aware_utc(database_url: str, session_time_zone: str) -> None:
    value = fetch_datetime(
        database_url,
        "SELECT '2026-10-30 14:05:09.123456+02'::timestamptz",
        session_time_zone=session_time_zone,
    )
    assert value.utcoffset() == timedelta(0)
    assert value == datetime(2026, 10, 30, 12, 5, 9, 123456, tzinfo=UTC)


@pytest.mark.usefixtures("host_in_tokyo")
def test_naive_parameter_is_read_as_host_local_time(database_url: str) -> None:
    naive = datetime.fromisoformat("2026-10-30T14:05:09")
    value = fetch_datetime(database_url, "SELECT $1::timestamptz", naive)
    assert value == datetime(2026, 10, 30, 5, 5, 9, tzinfo=UTC)


def test_aware_parameter_keeps_its_instant(database_url: str) -> None:
    aware = datetime.fromisoformat("2026-10-30T14:05:09+02:00")
    value = fetch_datetime(database_url, "SELECT $1::timestamptz", aware)
    assert value == datetime(2026, 10, 30, 12, 5, 9, tzinfo=UTC)


def test_infinity_is_returned_naive(database_url: str) -> None:
    assert fetch_datetime(database_url, "SELECT 'infinity'::timestamptz").tzinfo is None


def test_now_is_fixed_within_a_transaction_only(database_url: str) -> None:
    async def run() -> tuple[object, object, object]:
        connection = await asyncpg.connect(database_url)
        try:
            async with connection.transaction():
                first = await connection.fetchval("SELECT now()")
                await asyncio.sleep(0.01)
                same_transaction = await connection.fetchval("SELECT now()")
            next_transaction = await connection.fetchval("SELECT now()")
        finally:
            await connection.close()
        return first, same_transaction, next_transaction

    first, same_transaction, next_transaction = asyncio.run(run())
    assert first == same_transaction
    assert first != next_transaction
