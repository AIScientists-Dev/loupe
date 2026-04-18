# Planted bugs — sample_paper.pdf (5 pages)

Ground truth for M3 (verify_proofs) and M5 (visual localize) evaluation. Each bug is planted deliberately; the surrounding math is otherwise correct. The target is **5/5 detections** with **≤1 false positive** on the control items below.

---

## Bug 1 — Arithmetic error
- **Location:** Page 3, Lemma 1 (Telescoping identity), equation (2)
- **Expected `issue_type`:** `arithmetic`
- **Expected `severity`:** `high` (propagates into Theorem 1 via Lemma 1)
- **What's wrong:** The displayed equation claims
  \[
    \sum_{k=1}^{n} k \;=\; \frac{n^2}{2}
  \]
  The correct identity is $\sum_{k=1}^{n} k = n(n+1)/2$. The stated form is off by $n/2$ — tight asymptotically but incorrect as a bound and certainly as an equality.
- **Subtlety:** Plausible at a glance; correct leading-order behavior.

## Bug 2 — Flipped inequality / logic
- **Location:** Page 3, Theorem 1 (Convergence in probability), equation (4)
- **Expected `issue_type`:** `logic`
- **Expected `severity`:** `high`
- **What's wrong:** The stated bound
  \[
    \Pr\!\left( \min_{0 \le t \le n-1} \|\nabla f(x_t)\| \le \epsilon \right) \;\le\; \exp(-n\epsilon^2/(2\sigma^2))
  \]
  reads "probability of **finding** a near-stationary iterate is exponentially **small**". That is the opposite of a convergence guarantee; a proper statement would either flip the inequality ($\ge 1 - \exp(\ldots)$) or flip the event (to $> \epsilon$).
- **Subtlety:** The form of the right-hand side is the Hoeffding-style expression a reader expects to see — the mismatch is in *which side of the inequality* it belongs on.

## Bug 3 — Unstated assumption
- **Location:** Page 3, Proof of Theorem 1 (mid-proof)
- **Expected `issue_type`:** `unstated_assumption`
- **Expected `severity`:** `medium` (proof is invalid but easy to fix by adding or removing the step)
- **What's wrong:** The proof invokes "By Assumption 4 (uniform boundedness of the iterates) we have $\|x_t\| \le R$ for all $t$". Only Assumptions 1–3 are declared in Section 2; Assumption 4 does not exist in the paper. The abstract and Section 2 explicitly disavow this assumption ("We do not assume uniform boundedness of the iterates").
- **Subtlety:** The cited label reads naturally; checking requires cross-referencing against the assumption list.

## Bug 4 — Wrong constant in concentration bound
- **Location:** Page 4, Lemma 2 (Hoeffding-type bound), equation (6)
- **Expected `issue_type`:** `wrong_constant`
- **Expected `severity`:** `high`
- **What's wrong:** The stated bound is
  \[
    \Pr\!\left( \left| \sum_{i=1}^n X_i \right| \ge n\epsilon \right) \;\le\; 2\exp(-n\epsilon/(2\tau^2)).
  \]
  The correct Hoeffding bound for mean-zero sub-Gaussian variables with parameter $\tau$ is $2\exp(-n\epsilon^2/(2\tau^2))$ — the exponent is quadratic in $\epsilon$, not linear. The paper's version is vacuous for small $\epsilon$ (of order $\tau^2$) and is linear rather than quadratic in deviation.
- **Subtlety:** The proof sketch that follows optimizes $\lambda$ correctly, which would yield the $\epsilon^2$ form — so the **stated bound is inconsistent with its own proof**. A verifier that reads both should flag this.

## Bug 5 — Quantifier scope swap
- **Location:** Page 4, Corollary 1 (Uniform high-probability rate), equation (7) and its proof
- **Expected `issue_type`:** `quantifier_scope`
- **Expected `severity`:** `medium`
- **What's wrong:** The corollary claims "there exists $\delta_0 > 0$ such that for all $\delta \in (0, \delta_0)$ and all $n \ge 1$, $\Pr(\|\nabla f(x_n)\|^2 \ge \delta) \le C/(n\delta)$" — i.e. a single constant $C$ uniform in $\delta$ and $n$. The proof, however, establishes only that **for each fixed $\delta$ there exists $N(\delta)$** above which the bound holds. The quantifier order in the proof is $\forall \delta\, \exists N(\delta)$, not $\forall n \ge 1$ as stated.
- **Subtlety:** The proof openly contradicts the corollary's "for all $n \ge 1$" clause in its very first sentence, but the mismatch requires the reader to compare the two carefully.

---

## Controls (correct items — should NOT be flagged)

| Item | Location | What's correct |
|------|----------|----------------|
| Cauchy–Schwarz, eq. (3) | Page 3 | $(\sum a_i)^2 \le n \sum a_i^2$ — standard, correctly stated |
| Jensen's inequality remark | Page 4 | $(\E X)^2 \le \E X^2$ — convex form, correctly stated |
| Descent lemma, eq. (5) | Page 3 | Standard $L$-smoothness descent inequality, correctly stated (before bug 3 is introduced downstream) |
| Chernoff optimization, proof of Lemma 2 | Page 4 | The displayed Cramér–Chernoff step $\exp(n\lambda^2\tau^2/2 - n\epsilon\lambda)$ and its optimization in $\lambda$ are correct (and, as noted, inconsistent with the bugged statement in (6)) |
| Assumption 1 (Smoothness) | Page 1 | Standard $L$-Lipschitz gradient definition, correctly stated |
| Assumption 2 (Bounded $p$-th moment) | Page 1/2 | Well-formed; conditional expectation, $p \in (1, 2]$ |
| Assumption 3 (Lower-bounded objective) | Page 2 | Well-formed |

## Success criteria for M3 / M5

- **M3 (verify_proofs) — text-only detection:** all 5 bugs surface as Findings with correct `issue_type`, ≤1 false positive on controls, each Finding cites the correct `proof_block_id` and quotes the offending passage.
- **M5 (visual localize) — page-level verification:** each finding's bbox lands on page 3 or 4 (matching the table above); the `evidence_quote` is confirmed present in the rendered page image; no finding is spuriously `dropped` due to parser munging (unless we manually induce one).
