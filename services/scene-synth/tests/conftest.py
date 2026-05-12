import pytest


@pytest.fixture
def fixture_dir():
    from pathlib import Path
    return Path(__file__).parent.parent.parent.parent / "fixtures"
