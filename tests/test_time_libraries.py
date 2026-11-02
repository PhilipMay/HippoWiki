"""Pin the library time behaviour that spec/time.md relies on."""

from datetime import UTC, date, datetime, timedelta

import pytest
import yaml
from pydantic import AwareDatetime, TypeAdapter, ValidationError

AWARE = TypeAdapter(AwareDatetime)
YAML_TIMESTAMP_TAG = "tag:yaml.org,2002:timestamp"


class NoTimestampLoader(yaml.SafeLoader):
    """Safe loader that keeps dates and times as strings."""


NoTimestampLoader.yaml_implicit_resolvers = {
    first_char: [(tag, regexp) for tag, regexp in resolvers if tag != YAML_TIMESTAMP_TAG]
    for first_char, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


@pytest.mark.parametrize("value", [1793000000, 1793000000.5, 1793000000000, "1793000000"])
def test_aware_datetime_accepts_unix_timestamps_as_utc(value: float | str) -> None:
    assert AWARE.validate_python(value).utcoffset() == timedelta(0)


def test_strict_json_still_accepts_numeric_strings() -> None:
    assert AWARE.validate_json('"1793000000"', strict=True).utcoffset() == timedelta(0)


def test_aware_datetime_keeps_the_offset() -> None:
    assert AWARE.validate_python("2026-10-30T14:05:09+02:00").utcoffset() == timedelta(hours=2)


@pytest.mark.parametrize("value", ["2026-10-30T14:05:09", "2026-10-30"])
def test_aware_datetime_rejects_values_without_offset(value: str) -> None:
    with pytest.raises(ValidationError, match="timezone"):
        AWARE.validate_python(value)


@pytest.mark.parametrize("value", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"])
def test_converting_an_extreme_value_to_utc_overflows(value: str) -> None:
    parsed = AWARE.validate_python(value)
    with pytest.raises(OverflowError):
        parsed.astimezone(UTC)


def test_aware_datetime_truncates_to_six_fractional_digits() -> None:
    truncated = datetime(2026, 10, 30, 14, 5, 9, 123456, tzinfo=UTC)
    assert AWARE.validate_python("2026-10-30T14:05:09.123456789Z") == truncated


@pytest.mark.parametrize("value", ["2026-10-30t14:05:09z", "2026-10-30 14:05:09Z", "2026-10-30T14:05Z"])
def test_aware_datetime_accepts_formats_utc_datetime_has_to_reject(value: str) -> None:
    assert AWARE.validate_python(value).utcoffset() == timedelta(0)


@pytest.mark.parametrize(
    ("microsecond", "expected"),
    [
        (123456, b'"2026-10-30T14:05:09.123456Z"'),
        (120000, b'"2026-10-30T14:05:09.120000Z"'),
        (0, b'"2026-10-30T14:05:09Z"'),
    ],
)
def test_pydantic_omits_the_fraction_only_when_microseconds_are_zero(microsecond: int, expected: bytes) -> None:
    assert AWARE.dump_json(datetime(2026, 10, 30, 14, 5, 9, microsecond, tzinfo=UTC)) == expected


def test_pyyaml_parses_a_date() -> None:
    assert yaml.safe_load("d: 2026-10-30")["d"] == date(2026, 10, 30)


@pytest.mark.parametrize("value", ["2026-10-30T14:05:09", "2026-10-30 14:05:09"])
def test_pyyaml_returns_naive_datetime_without_offset(value: str) -> None:
    parsed = yaml.safe_load(f"d: {value}")["d"]
    assert isinstance(parsed, datetime)
    assert parsed.tzinfo is None


def test_pyyaml_keeps_the_offset() -> None:
    assert yaml.safe_load("d: 2026-10-30T14:05:09+02:00")["d"].utcoffset() == timedelta(hours=2)


@pytest.mark.parametrize("value", ["2026-10-30", "2026-10-30T14:05:09", "2026-10-30T14:05:09+02:00"])
def test_loader_without_timestamp_parsing_keeps_strings(value: str) -> None:
    loader = NoTimestampLoader(f"d: {value}")
    try:
        assert loader.get_single_data() == {"d": value}
    finally:
        loader.dispose()
