from enable_coredns_log import add_log_plugin, remove_log_plugin

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
