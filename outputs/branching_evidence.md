# Runtime branching evidence — official class kit

The same agent, the same code, the same résumé. Only the observation changed, and the
executed action sequence changed with it. A fixed pipeline would print identical rows.

| Job | Observation that mattered | Executed action sequence | Steps |
| --- | ------------------------- | ------------------------ | ----- |
| J001 | fit 100% against a 60% bar | `scan_for_injection > check_hard_constraints > evaluate_fit > request_human_approval` | 4 |
| J002 | fit 76% against a 60% bar | `scan_for_injection > check_hard_constraints > evaluate_fit > request_human_approval` | 4 |
| J003 | Requires 5+ years; candidate has ~1.7 years (hard constraint: no roles requiring 5+ years) | `scan_for_injection > check_hard_constraints > reject_hard_constraint` | 3 |
| J004 | posting contained instructions aimed at the AI | `scan_for_injection > flag_injection_and_continue > check_hard_constraints > evaluate_fit > reject_low_fit` | 5 |
| J005 | fit 85% against a 60% bar | `scan_for_injection > check_hard_constraints > evaluate_fit > request_human_approval` | 4 |
| J006 | Role is in New York, NY, outside your preferred locations (Atlanta, Remote, Hybrid within the Southeast) and your preferences rule out relocating | `scan_for_injection > check_hard_constraints > reject_hard_constraint` | 3 |
