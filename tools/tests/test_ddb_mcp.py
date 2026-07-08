import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import ddb_mcp

def test_unknown_tool_returns_err():
    r = ddb_mcp.lambda_handler({"tool_name": "nope", "arguments": {}}, None)
    assert r["statusCode"] == 400

def test_top_talkers_sorts_by_metric(monkeypatch):
    topo = {"edges": [
        {"id": "e1", "metrics": {"DATA_TRANSFERRED": 10}},
        {"id": "e2", "metrics": {"DATA_TRANSFERRED": 99}}], "nodes": []}
    monkeypatch.setattr(ddb_mcp, "_get_topology", lambda: topo)
    r = ddb_mcp.lambda_handler({"tool_name": "get_top_talkers",
                                "arguments": {"limit": 1}}, None)
    body = json.loads(r["body"])
    assert body["edges"][0]["id"] == "e2"
