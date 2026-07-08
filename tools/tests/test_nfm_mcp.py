import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import nfm_mcp

def test_dispatch_and_err_shape():
    r = nfm_mcp.lambda_handler({"tool_name": "bogus", "arguments": {}}, None)
    assert r["statusCode"] == 400
    assert "error" in json.loads(r["body"])

def test_handler_isolates_tool_exception(monkeypatch):
    def boom(args):
        raise RuntimeError("nfm exploded")
    monkeypatch.setitem(nfm_mcp.TOOLS, "list_nfm_monitors", boom)
    r = nfm_mcp.lambda_handler({"tool_name": "list_nfm_monitors", "arguments": {}}, None)
    assert r["statusCode"] == 400
    assert "RuntimeError" in json.loads(r["body"])["error"]
