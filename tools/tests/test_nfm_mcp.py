import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import nfm_mcp

def test_dispatch_and_err_shape():
    r = nfm_mcp.lambda_handler({"tool_name": "bogus", "arguments": {}}, None)
    assert r["statusCode"] == 400
    assert "error" in json.loads(r["body"])
