// src/test/property/fc-config.ts
//
// Shared fast-check harness wrapper.
//
// Per Requirement 11.5 of the public-form-abuse-hardening spec, every
// property test in this repo must run at minimum 100 fast-check iterations.
// `fcAssert` resolves `numRuns` against the floor and forwards to `fc.assert`.
// The companion ESLint rule `local/no-direct-fc-assert` forbids direct
// `fc.assert(...)` calls anywhere in `src/**/*.test.ts(x)` outside this file,
// so this wrapper is the ONLY legal call site for `fc.assert` in the repo.
import fc, {
    type IAsyncProperty,
    type IProperty,
    type Parameters as FcParameters,
} from "fast-check";

const FLOOR = 100;

function resolveNumRuns(override?: number): number {
    const envVal = Number(process.env.FAST_CHECK_NUM_RUNS);
    const fromEnv = Number.isFinite(envVal) && envVal > 0 ? envVal : FLOOR;
    const requested = override && override > 0 ? override : fromEnv;
    return Math.max(FLOOR, requested);
}

/**
 * `fc.assert` wrapper that enforces a `numRuns` floor of 100.
 *
 * Resolution order for `numRuns`:
 *   1. `params.numRuns` if it is a finite positive number,
 *   2. otherwise `process.env.FAST_CHECK_NUM_RUNS` if it is a finite positive number,
 *   3. otherwise the floor of 100.
 * The final value is then clamped via `Math.max(100, requested)` so callers can
 * never reduce coverage below the spec's minimum even if they pass `numRuns: 1`.
 *
 * The ESLint rule `local/no-direct-fc-assert` flags any call to `fc.assert(...)`
 * outside this file — every property test must import and use this wrapper.
 */
export function fcAssert<Ts>(
    property: IProperty<Ts> | IAsyncProperty<Ts>,
    params: FcParameters<Ts> = {}
): void | Promise<void> {
    return fc.assert(property, { ...params, numRuns: resolveNumRuns(params.numRuns) });
}

export { fc };
