from graph.cycle import would_create_cycle


def test_no_cycle_on_fresh_edge():
    assert would_create_cycle([], "a", "b") is False


def test_self_loop_is_cycle():
    assert would_create_cycle([], "a", "a") is True


def test_detects_transitive_cycle():
    edges = [
        {"relation": "prerequisite_for", "source": "a", "target": "b"},
        {"relation": "prerequisite_for", "source": "b", "target": "c"},
    ]
    assert would_create_cycle(edges, "c", "a") is True
    assert would_create_cycle(edges, "a", "c") is False


def test_ignores_non_prerequisite_edges():
    edges = [{"relation": "assesses", "source": "b", "target": "a"}]
    assert would_create_cycle(edges, "a", "b") is False
