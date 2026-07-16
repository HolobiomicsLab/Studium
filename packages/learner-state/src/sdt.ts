// packages/learner-state/src/sdt.ts
//
// Signal-detection-theory scoring for the judgment "verdict deck": a learner marks each claim in a
// mixed deck (some ground-truth FLAWED, some SOUND) as flawed or sound. Treating "flawed" as the
// signal and "flag it" as the detection response, the 2x2 confusion matrix yields two SEPARATED
// numbers the legacy single signed trust gap conflates:
//   - DISCRIMINATION (competence): how well the learner tells a real flaw from a sound claim.
//   - BIAS (trust direction): a conservative criterion (reluctant to flag) = OVER-TRUST; a liberal
//     criterion (flags everything) = OVER-DISTRUST.
//
// Small-N discipline (4-8 claims/scene): rates are corrected with the loglinear transform
// (Hautus 1995) BEFORE any z, applied to every cell — not only at the 0/1 extremes — so the estimator
// stays continuous at ceiling/floor. Parametric d'/c are reported ALONGSIDE the bounded non-parametric
// A' (the small-N-honest headline). Counts must be POOLED per concept and transformed ONCE; never
// average per-scene d', and never EWMA these numbers (unlike the legacy gap fold).

/** Minimum trials PER CLASS (flawed, and sound) for the SDT estimate to be flagged `sufficient`.
 * Below it the numbers are still returned (with variance) but marked not-yet-reliable — mirroring how
 * the calibration gates require a measured sample. v1 floor; >=20/class is preferable for a precise
 * published claim. Non-gating: this flag never withholds certification, it only qualifies a diagnostic. */
export const MIN_SDT_TRIALS_PER_CLASS = 6;

/** The four cells of the judgment confusion matrix. hits+misses = flawed claims judged (signal trials);
 * falseAlarms+correctRejections = sound claims judged (noise trials). */
export interface SdtCells {
  hits: number;             // flawed claims correctly flagged
  misses: number;           // flawed claims NOT flagged  (-> over-trust)
  falseAlarms: number;      // sound claims wrongly flagged (-> over-distrust)
  correctRejections: number;// sound claims correctly left unflagged
}

export interface SdtResult {
  /** Non-parametric discrimination A' in [0,1] (Grier 1971); 0.5 = chance. The small-N headline. */
  aPrime: number;
  /** Non-parametric response bias B''D in [-1,1] (Donaldson); >0 conservative (over-trust), <0 liberal. */
  bDoublePrime: number;
  /** Parametric sensitivity d' = z(H) - z(FA). */
  dPrime: number;
  /** Parametric criterion c = -0.5*(z(H)+z(FA)); >0 over-trust (reluctant to flag), <0 over-distrust. */
  c: number;
  /** Loglinear-corrected hit rate and false-alarm rate actually used. */
  hitRate: number;
  falseAlarmRate: number;
  /** Miller (1996) approximate variance of d' (for an honest CI at small N). */
  varDPrime: number;
  /** Total claims judged (signal + noise trials). */
  trials: number;
  /** True once BOTH classes have >= MIN_SDT_TRIALS_PER_CLASS trials. */
  sufficient: boolean;
}

// Inverse standard-normal CDF (quantile) via Acklam's rational approximation (|error| < 1.2e-9 in the
// central region). z(0.5)=0, z(0.975)=1.959964, z(0.8413447)=1.
const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

/** Standard-normal quantile z such that P(Z<=z)=p, for 0<p<1. Returns +/-Infinity at the bounds. */
export function inverseNormalCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (((((A[0]! * r + A[1]!) * r + A[2]!) * r + A[3]!) * r + A[4]!) * r + A[5]!) * q / (((((B[0]! * r + B[1]!) * r + B[2]!) * r + B[3]!) * r + B[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
}

function normalPdf(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

/** Grier (1971) non-parametric discrimination A' from a corrected hit rate and false-alarm rate. */
export function aPrimeGrier(hitRate: number, faRate: number): number {
  if (hitRate >= faRate) {
    return 0.5 + ((hitRate - faRate) * (1 + hitRate - faRate)) / (4 * hitRate * (1 - faRate));
  }
  return 0.5 - ((faRate - hitRate) * (1 + faRate - hitRate)) / (4 * faRate * (1 - hitRate));
}

/** Donaldson B''D non-parametric response bias in [-1,1]; >0 conservative, <0 liberal. */
export function bDoublePrimeDonaldson(hitRate: number, faRate: number): number {
  const h = hitRate * (1 - hitRate);
  const f = faRate * (1 - faRate);
  const sign = hitRate >= faRate ? 1 : -1;
  return (sign * (h - f)) / (h + f);
}

/** Compute pooled SDT metrics from a confusion matrix, with the loglinear (Hautus 1995) small-N
 * correction applied to every cell. Pure. Pool counts per concept and call this ONCE — do not average
 * per-scene d' and do not EWMA the result. */
export function computeSdt(cells: SdtCells): SdtResult {
  const nSignal = cells.hits + cells.misses;
  const nNoise = cells.falseAlarms + cells.correctRejections;
  const hitRate = (cells.hits + 0.5) / (nSignal + 1);
  const faRate = (cells.falseAlarms + 0.5) / (nNoise + 1);
  const zH = inverseNormalCdf(hitRate);
  const zFA = inverseNormalCdf(faRate);
  const phiH = normalPdf(zH);
  const phiFA = normalPdf(zFA);
  // Miller (1996) variance, using the loglinear effective trial counts (n+1) rather than raw n — matched
  // to the corrected rates above. Approximate + diagnostic only (never persisted, never gated).
  const varDPrime =
    (hitRate * (1 - hitRate)) / ((nSignal + 1) * phiH * phiH) +
    (faRate * (1 - faRate)) / ((nNoise + 1) * phiFA * phiFA);
  return {
    aPrime: aPrimeGrier(hitRate, faRate),
    bDoublePrime: bDoublePrimeDonaldson(hitRate, faRate),
    dPrime: zH - zFA,
    c: -0.5 * (zH + zFA),
    hitRate,
    falseAlarmRate: faRate,
    varDPrime,
    trials: nSignal + nNoise,
    sufficient: nSignal >= MIN_SDT_TRIALS_PER_CLASS && nNoise >= MIN_SDT_TRIALS_PER_CLASS,
  };
}
