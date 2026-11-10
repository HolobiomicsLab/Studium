"""The documented command (`uvicorn analytics_collector_app:app --app-dir services/analytics-collector`) runs in the
environment `requirements.txt` builds, where `telemetry-events` is not pip-installed: the service must find the
repository's package itself, as the tools do. A bare interpreter (`-I`: no PYTHONPATH, no pytest.ini) proves it."""
import subprocess
import sys
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[2]


def test_the_app_imports_in_a_bare_interpreter(tmp_path) -> None:
    code = f"import sys; sys.path.insert(0, {str(SERVICE)!r}); import analytics_collector_app; print(analytics_collector_app.app.title)"
    done = subprocess.run([sys.executable, "-I", "-c", code], cwd=tmp_path, capture_output=True, text=True, timeout=120,
                          env={"ANALYTICS_DATA_DIR": str(tmp_path / "data")})
    assert done.returncode == 0, done.stderr[-800:]
    assert done.stdout.strip() == "analytics-collector"
