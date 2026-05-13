import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from metrics import compute_blueprint_score


def test_blueprint_single_dimension_single_metric_full_score():
    blueprint = {
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 1.0,
             "metrics": [{"endpoint": "ai_literacy", "field": "value", "weight_in_dimension": 1.0}]},
        ],
    }

    def metric_fetcher(endpoint: str, field: str):
        return 0.8

    result = compute_blueprint_score(blueprint, metric_fetcher)
    assert result["overall_weighted_score"] == 0.8
    assert result["dimensions"][0]["score"] == 0.8
    assert result["dimensions"][0]["degraded"] is False


def test_blueprint_redistributes_weight_when_null():
    blueprint = {
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 1.0,
             "metrics": [
                 {"endpoint": "ai_literacy", "field": "value", "weight_in_dimension": 0.5},
                 {"endpoint": "calibration", "field": "brier_score", "weight_in_dimension": 0.5},
             ]},
        ],
    }

    def metric_fetcher(endpoint: str, field: str):
        if endpoint == "ai_literacy":
            return None
        return 0.6

    result = compute_blueprint_score(blueprint, metric_fetcher)
    assert result["dimensions"][0]["score"] == 0.6
    assert result["dimensions"][0]["degraded"] is True


def test_blueprint_multi_dimension_weighted_sum():
    blueprint = {
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 0.7,
             "metrics": [{"endpoint": "ai_literacy", "field": "value", "weight_in_dimension": 1.0}]},
            {"id": "d2", "label": "D2", "weight": 0.3,
             "metrics": [{"endpoint": "calibration", "field": "brier_score", "weight_in_dimension": 1.0}]},
        ],
    }

    def metric_fetcher(endpoint: str, field: str):
        return {"ai_literacy": 0.8, "calibration": 0.4}[endpoint]

    result = compute_blueprint_score(blueprint, metric_fetcher)
    expected_overall = round(0.7 * 0.8 + 0.3 * 0.4, 4)
    assert result["overall_weighted_score"] == expected_overall


def test_blueprint_all_metrics_null_returns_none():
    blueprint = {
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 1.0,
             "metrics": [{"endpoint": "ai_literacy", "field": "value", "weight_in_dimension": 1.0}]},
        ],
    }

    def metric_fetcher(endpoint: str, field: str):
        return None

    result = compute_blueprint_score(blueprint, metric_fetcher)
    assert result["overall_weighted_score"] is None
    assert result["dimensions"][0]["score"] is None
