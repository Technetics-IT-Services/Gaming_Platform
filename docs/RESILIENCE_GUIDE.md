# Resilience Guide (Phase 10, STEP 3)

Every pattern is a **wrapper** around an async call — you protect a call to a frozen
service / external integration without changing the callee. Module: `src/lib/resilience/`.

## Patterns

| Pattern | Wrapper | Purpose |
|---|---|---|
| Circuit breaker | `CircuitBreaker.exec(op)` | stop calling a failing dependency; fail fast; auto half-open recovery |
| Bulkhead | `Bulkhead.exec(op)` | bound concurrency + queue per dependency so one can't exhaust the process |
| Timeout | `withTimeout(op, ms)` | cap latency; never hang on a slow dependency |
| Retry budget | `RetryBudget` | cap the *rate* of retries → no retry storms amplifying an outage |
| Fallback | `withFallback(primary, fallback)` | graceful degradation of a single call |
| Adaptive rate limit | `AdaptiveRateLimiter` | AIMD: shrink rate on overload, grow when healthy |
| Backpressure | `BackpressureMonitor` | shed low-priority load first; keep money paths during shedding |
| Graceful degradation | `DegradationRegistry` | flip features into reduced modes during incidents |

## Composed wrapper

`Resilience.run(op, fallback?)` layers **timeout → bulkhead → circuit breaker → budgeted retry →
fallback** in one call. Wrap an integration adapter (payments, notifications, storage) once:

```ts
const payments = new Resilience('paypal', {
  timeoutMs: 15_000, maxConcurrent: 32, maxAttempts: 3,
  circuit: { failureThreshold: 5, openMs: 30_000 },
  isRetryable: (e) => e instanceof ProviderError && e.retryable,
});
const intent = await payments.run(() => paypal.createDepositIntent(req));
```

The frozen payment platform is unchanged — the wrapper sits on the call site.

## Priorities & guarantees

- **Money paths are `critical`** priority: never shed by backpressure, never silently fallen back to a
  wrong value. Payments/withdrawals fail *closed* (surface an error) rather than fabricating success.
- **Idempotency preserved**: retries reuse the frozen platform's idempotency keys (e.g.
  `PayPal-Request-Id`, ledger idempotency key), so a retried call credits once.
- **No new consistency model**: the ledger remains the source of truth; resilience adds availability,
  not new financial semantics.

## Failure matrix

| Failure | Detected by | Response | Money impact |
|---|---|---|---|
| Slow dependency | `withTimeout` | fail fast + retry(budget)/fallback | none (idempotent) |
| Failing dependency | `CircuitBreaker` | open circuit, fail fast, fallback | none |
| Dependency overload | `AdaptiveRateLimiter` | shrink rate; shed low-priority | none |
| Queue saturation | `BackpressureMonitor` | shed non-critical; scale workers | none |
| Leader/node crash | lease expiry | passive node takes over | none |
| Region down | `regionFailed` | regional failover | none (geo-replicated) |
| DB primary down | replica lag / probe | promote standby; repoint URL | none (`synchronous_commit`) |
| Redis primary down | Sentinel | promote replica | queues resume from AOF |

## Recovery matrix

| Component | Recovery | RTO |
|---|---|---|
| Stateless pod | reschedule / scale | seconds |
| Worker | reschedule; in-flight recovered from `processing` list | seconds |
| Singleton (leader) | passive node acquires lease on next tick | ≤ lease TTL (~15s) |
| DB primary | standby promotion | ≤ 30s (managed) |
| Redis primary | Sentinel failover | ≤ 10s |
| Region | global LB shift + backup restore | minutes |
