# Runtime branching evidence — official class kit

The same agent, the same code, the same résumé. Only the observation changed, and the
executed action sequence changed with it. A fixed pipeline would print identical rows.

| Job | Observation that mattered | Executed action sequence | Steps |
| --- | ------------------------- | ------------------------ | ----- |
| J001 | fit 100% against a 60% bar | `scan_for_injection > evaluate_fit > check_hard_constraints > request_human_approval` | 4 |
| J002 | fit 67% against a 60% bar | `scan_for_injection > evaluate_fit > check_hard_constraints > request_human_approval` | 4 |
| J003 | Requires 5+ years; candidate has ~1.7 years (hard constraint: no roles requiring 5+ years) | `scan_for_injection > evaluate_fit > check_hard_constraints > reject_hard_constraint` | 4 |
| J004 | posting contained instructions aimed at the AI | `scan_for_injection > flag_injection_and_continue > evaluate_fit > check_hard_constraints > request_human_approval` | 5 |
| J005 | fit 100% against a 60% bar | `scan_for_injection > evaluate_fit > check_hard_constraints > request_human_approval` | 4 |
| J006 | Role is in New York, NY, outside your preferred locations (Atlanta, Remote, Hybrid within the Southeast) and your preferences rule out relocating | `scan_for_injection > evaluate_fit > check_hard_constraints > reject_hard_constraint` | 4 |
