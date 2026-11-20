import { CommandeStatut, UserRole, type PrismaClient } from "@prisma/client";

import { analyseTrack, findingsFor, type TrackAnalysis, type TrackPoint } from "@/lib/analytics/trackAnalysis";
import { sampleOf, summariseEtaAccuracy, type EtaSample } from "@/lib/analytics/etaAccuracy";
import { OrderError, type StatusActor } from "@/lib/services/orderService";

/** Most points sent for one replay (a very long delivery is thinned evenly, keeping the first and last). */
export const MAX_REPLAY_POINTS = 4000;
/** Deliveries looked at for the analytics page. */
export const ANALYTICS_MAX_DELIVERIES = 200;

const FINISHED: CommandeStatut[] = [CommandeStatut.LIVREE, CommandeStatut.RECUE];

const routeOf = (value: unknown): [number, number][] | null =>
  Array.isArray(value) && value.length >= 2 && value.every((p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") ? (value as [number, number][]) : null;

function owner(actor: StatusActor) {
  if (actor.role !== UserRole.ADMIN) throw new OrderError("FORBIDDEN", "Access denied.");
}

/**
 * The owner's report on one delivery: the full movement (for playback), what the GPS did, where the driver stopped,
 * and where they left the planned road. Owner only: it exposes a person's whole movement.
 */
export async function getDeliveryReport(db: PrismaClient, params: { orderId: string; actor: StatusActor }) {
  owner(params.actor);
  const order = await db.commande.findUnique({
    where: { id: params.orderId },
    select: {
      id: true,
      statut: true,
      adresse: { select: { rue: true, ville: true, latitude: true, longitude: true } },
      livraison: { select: { livreur: { select: { id: true, prenom: true, nom: true } }, routePlanifiee: true, etaSecondes: true, etaSource: true } },
      historique: { where: { nouveauStatut: { in: [CommandeStatut.EN_LIVRAISON, CommandeStatut.LIVREE, CommandeStatut.RECUE] } }, orderBy: { date: "asc" }, select: { nouveauStatut: true, date: true } },
    },
  });
  if (!order || !order.livraison) throw new OrderError("ORDER_NOT_FOUND", "No delivery found for this order.");

  const rows = await db.positionLivraison.findMany({
    where: { commandeId: params.orderId },
    orderBy: { date: "asc" },
    select: { latitude: true, longitude: true, precision: true, date: true, backfilled: true },
  });
  const points: TrackPoint[] = rows.map((r) => ({ latitude: r.latitude, longitude: r.longitude, accuracy: r.precision, at: r.date.getTime(), backfilled: r.backfilled }));
  const planned = routeOf(order.livraison.routePlanifiee);
  const analysis = analyseTrack(points, planned);

  const step = points.length > MAX_REPLAY_POINTS ? points.length / MAX_REPLAY_POINTS : 1;
  const replay = step === 1 ? points : Array.from({ length: MAX_REPLAY_POINTS }, (_, i) => points[Math.min(points.length - 1, Math.round(i * step))]).concat(points.at(-1)!);
  const at = (s: CommandeStatut) => order.historique.find((h) => h.nouveauStatut === s)?.date ?? null;

  return {
    orderId: order.id,
    status: order.statut,
    driver: { id: order.livraison.livreur.id, name: `${order.livraison.livreur.prenom} ${order.livraison.livreur.nom}` },
    destination: order.adresse?.latitude != null && order.adresse.longitude != null ? { latitude: order.adresse.latitude, longitude: order.adresse.longitude } : null,
    address: order.adresse ? `${order.adresse.rue}, ${order.adresse.ville}` : null,
    startedAt: at(CommandeStatut.EN_LIVRAISON),
    deliveredAt: at(CommandeStatut.LIVREE),
    receivedAt: at(CommandeStatut.RECUE),
    plannedRoute: planned,
    points: replay.map((p) => ({ latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, at: p.at, backfilled: p.backfilled })),
    analysis,
    findings: findingsFor(analysis),
  };
}

export interface DriverStats {
  driverId: string;
  name: string;
  deliveries: number;
  averageMinutes: number | null;
  averageKm: number | null;
  averageSpeedKmh: number | null;
  withGpsProblems: number;
  withDeviations: number;
}

/**
 * Delivery analytics for the owner: how long deliveries take, how far, how often the GPS had problems or the driver left
 * the planned road, per delivery person. Looks at the most recent finished deliveries (optionally since a date).
 */
export async function getDeliveryAnalytics(db: PrismaClient, params: { actor: StatusActor; since?: Date; limit?: number }) {
  owner(params.actor);
  const limit = Math.min(params.limit ?? 100, ANALYTICS_MAX_DELIVERIES);
  const orders = await db.commande.findMany({
    where: { statut: { in: FINISHED }, livraison: { isNot: null }, ...(params.since ? { date: { gte: params.since } } : {}) },
    orderBy: { date: "desc" },
    take: limit,
    select: {
      id: true,
      livraison: { select: { livreur: { select: { id: true, prenom: true, nom: true } }, routePlanifiee: true, etaInitialeSecondes: true, etaInitialeSource: true, etaInitialeAt: true } },
      historique: { where: { nouveauStatut: CommandeStatut.LIVREE }, orderBy: { date: "asc" }, take: 1, select: { date: true } },
      positions: { orderBy: { date: "asc" }, select: { latitude: true, longitude: true, precision: true, date: true, backfilled: true } },
    },
  });

  const etaSamples: EtaSample[] = [];
  const rows = orders.map((o) => {
    const sample = sampleOf({ predictedSeconds: o.livraison?.etaInitialeSecondes, source: o.livraison?.etaInitialeSource, firstAt: o.livraison?.etaInitialeAt, deliveredAt: o.historique[0]?.date });
    if (sample) etaSamples.push(sample);
    const points: TrackPoint[] = o.positions.map((r) => ({ latitude: r.latitude, longitude: r.longitude, accuracy: r.precision, at: r.date.getTime(), backfilled: r.backfilled }));
    const a: TrackAnalysis = analyseTrack(points, routeOf(o.livraison?.routePlanifiee));
    const kinds = findingsFor(a).map((f) => f.kind);
    return {
      orderId: o.id,
      driverId: o.livraison!.livreur.id,
      driver: `${o.livraison!.livreur.prenom} ${o.livraison!.livreur.nom}`,
      minutes: a.points > 1 ? Math.round(a.durationSeconds / 60) : null,
      km: a.points > 1 ? Math.round(a.distanceMetres / 100) / 10 : null,
      speedKmh: a.averageSpeedKmh,
      gpsProblems: kinds.some((k) => k === "gps_gap" || k === "gps_poor" || k === "gps_jump" || k === "few_points"),
      deviations: (a.deviations?.length ?? 0) > 0,
      tooFewPoints: a.points < 5,
    };
  });

  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
  };
  const byDriver = new Map<string, typeof rows>();
  for (const r of rows) byDriver.set(r.driverId, [...(byDriver.get(r.driverId) ?? []), r]);
  const drivers: DriverStats[] = [...byDriver.entries()].map(([driverId, list]) => ({
    driverId,
    name: list[0].driver,
    deliveries: list.length,
    averageMinutes: avg(list.map((r) => r.minutes)),
    averageKm: avg(list.map((r) => r.km)),
    averageSpeedKmh: avg(list.map((r) => r.speedKmh)),
    withGpsProblems: list.filter((r) => r.gpsProblems).length,
    withDeviations: list.filter((r) => r.deviations).length,
  })).sort((a, b) => b.deliveries - a.deliveries);

  return {
    deliveries: rows.length,
    averageMinutes: avg(rows.map((r) => r.minutes)),
    averageKm: avg(rows.map((r) => r.km)),
    withGpsProblems: rows.filter((r) => r.gpsProblems).length,
    withDeviations: rows.filter((r) => r.deviations).length,
    tooFewPoints: rows.filter((r) => r.tooFewPoints).length,
    drivers,
    etaAccuracy: summariseEtaAccuracy(etaSamples),
    recent: rows.slice(0, 20),
  };
}
