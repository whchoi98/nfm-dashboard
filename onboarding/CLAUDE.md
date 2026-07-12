# onboarding — NFM / CoreDNS Onboarding Scripts (Python)

## Role
Python scripts that onboard clusters/accounts into the observability pipeline: register CloudWatch Network Flow Monitor coverage and enable CoreDNS query logging (reversibly) so the collector can gather flow + DNS data. Complements the `NfmDash-Onboarding` stack; run out-of-band when adding a new monitored cluster/monitor.

## Key Files
- `onboard_nfm.py` — set up NFM monitors / agent coverage for a target
- `enable_coredns_log.py` — enable the CoreDNS `log` plugin on EKS clusters (reversible: backs up the prior ConfigMap so it can be restored on disable)

## Rules
- Reversibility: `enable_coredns_log.py` must preserve the ability to restore the original CoreDNS config (backup annotation) — do not make one-way changes.
- These scripts touch live cluster/AWS config; run deliberately, not as part of a build. Region `ap-northeast-2`, account `<ACCOUNT_ID>`.
- Tests co-located (`test_*.py` / pytest).
- Operational context for what the collector then does with this data lives in `collector/CLAUDE.md` and `docs/reference/data.md`.
