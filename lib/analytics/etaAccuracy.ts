/**
 * How good were the time estimates? Compares the FIRST estimate made for a delivery (seconds, and whether it came from a
 * road route or was only a straight-line guess) with how long the delivery really took from that moment to "Delivered".
 * Pure: no database, no clock.
 *
 * "Actual" includes any time the delivery person stopped on the way, which is exactly what the customer experiences.
 */
export interface EtaSample {
  predictedSeconds: number;
  source: "route" | "estimate";
  /** Seconds from the first estimate to the delivery person saying "Delivered". */
  actualSeconds: number;
}

export interface EtaAccuracy {
  /** Deliveries with both an estimate and an outcome. */
  measured: number;
  road: { measured: number; averageErrorMinutes: number | null; within20Percent: number; tooOptimistic: number } | null;
  estimate: { measured: number; averageErrorMinutes: number | null; tooOptimistic: number } | null;
}

const minutes = (s: number) => Math.round((s / 60) * 10) / 10;

/** Combine one delivery's numbers, or null when it cannot be judged (no estimate, or a non-positive duration). */
export function sampleOf(args: { predictedSeconds: number | null | undefined; source: string | null | undefined; firstAt: Date | null | undefined; deliveredAt: Date | null | undefined }): EtaSample | null {
  const { predictedSeconds, firstAt, deliveredAt } = args;
  if (predictedSeconds == null || predictedSeconds <= 0 || !firstAt || !deliveredAt) return null;
  const actual = (deliveredAt.getTime() - firstAt.getTime()) / 1000;
  if (!(actual > 0)) return null;
  return { predictedSeconds, source: args.source === "estimate" ? "estimate" : "route", actualSeconds: actual };
}

export function summariseEtaAccuracy(samples: EtaSample[]): EtaAccuracy {
  const group = (kind: "route" | "estimate") => {
    const list = samples.filter((s) => s.source === kind);
    if (list.length === 0) return null;
    const errors = list.map((s) => Math.abs(s.actualSeconds - s.predictedSeconds));
    return {
      measured: list.length,
      averageErrorMinutes: minutes(errors.reduce((a, b) => a + b, 0) / errors.length),
      within20Percent: list.filter((s) => Math.abs(s.actualSeconds - s.predictedSeconds) <= 0.2 * s.actualSeconds).length,
      // The customer was promised less time than it took.
      tooOptimistic: list.filter((s) => s.actualSeconds > s.predictedSeconds * 1.2).length,
    };
  };
  const road = group("route");
  const est = group("estimate");
  return {
    measured: samples.length,
    road,
    estimate: est ? { measured: est.measured, averageErrorMinutes: est.averageErrorMinutes, tooOptimistic: est.tooOptimistic } : null,
  };
}
