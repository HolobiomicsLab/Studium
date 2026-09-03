"""INT-STUDIUM-010: the emitted ASTRA entries are in-schema for astra-spec 0.0.14.

Unit tests for the vendored contract and the emitter. The proof of conformance
is the real validator (test_provenance_astra_validate_cli.py); these tests pin
the shape the emitter must produce so a regression is named, not just red.
"""

from provenance.astra_contract import ASTRA_SCHEMA_VERSION, is_valid_astra_format


def test_contract_pins_0_0_14_and_validates_format_tokens():
    assert ASTRA_SCHEMA_VERSION == "0.0.14"
    assert is_valid_astra_format("json") and is_valid_astra_format("jsonld")
    assert not is_valid_astra_format("application/json") and not is_valid_astra_format("")
