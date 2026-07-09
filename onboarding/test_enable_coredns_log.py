import json

from enable_coredns_log import add_log_plugin, cfn_outcome, delete_corefile, remove_log_plugin

COREFILE = """.:53 {
    errors
    health
    kubernetes cluster.local in-addr.arpa ip6.arpa { pods insecure fallthrough in-addr.arpa ip6.arpa }
    forward . /etc/resolv.conf
    cache 30
}"""

def test_add_log_is_idempotent():
    once = add_log_plugin(COREFILE)
    assert "\n    log\n" in once
    assert add_log_plugin(once) == once   # idempotent, no double insert

def test_remove_restores():
    assert remove_log_plugin(add_log_plugin(COREFILE)).strip() == COREFILE.strip()

def test_delete_skips_without_backup():
    # no backup annotation → this CR never modified the cluster → skip (None)
    assert delete_corefile("x", None) is None

def test_delete_restores_exact_original_from_backup():
    assert delete_corefile(add_log_plugin(COREFILE), COREFILE) == COREFILE

def test_delete_preserves_user_owned_log_line():
    # backup captured a Corefile that already had a user's own `log` → restored verbatim
    assert delete_corefile("anything", "orig-with-log\n    log\n") == "orig-with-log\n    log\n"

def test_add_log_noop_warns_when_block_not_matched(capsys):
    # no `{\n` anchor and no existing `log` → silent no-op must emit a structured warning
    corefile = "no server block here"
    assert add_log_plugin(corefile) == corefile
    out = capsys.readouterr().out.strip()
    warn = json.loads(out)
    assert warn["level"] == "warn"
    assert "no-op" in warn["msg"]

def test_add_log_idempotent_path_does_not_warn(capsys):
    add_log_plugin(add_log_plugin(COREFILE))  # already has log → early return, no warn
    assert capsys.readouterr().out == ""

def test_cfn_outcome_create_all_failed_is_failed():
    status, reason = cfn_outcome("Create", 2, ["a", "b"])
    assert status == "FAILED"
    assert "a,b" in reason

def test_cfn_outcome_update_all_failed_is_failed():
    assert cfn_outcome("Update", 1, ["a"])[0] == "FAILED"

def test_cfn_outcome_partial_failure_stays_success_with_reason():
    status, reason = cfn_outcome("Create", 3, ["b"])
    assert status == "SUCCESS"
    assert "failed clusters: b" in reason

def test_cfn_outcome_delete_all_failed_stays_success():
    assert cfn_outcome("Delete", 2, ["a", "b"])[0] == "SUCCESS"

def test_cfn_outcome_no_failures_or_no_clusters_is_success_ok():
    assert cfn_outcome("Create", 3, []) == ("SUCCESS", "ok")
    assert cfn_outcome("Create", 0, []) == ("SUCCESS", "ok")
