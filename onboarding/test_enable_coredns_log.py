from enable_coredns_log import add_log_plugin, delete_corefile, remove_log_plugin

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
