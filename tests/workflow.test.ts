import { describe, expect, it } from "vitest";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

import {
  canTransition,
  isTerminalStatus,
  roleCanTransition,
  STATUS_LABELS_EN,
  STATUS_LABELS_FR,
  STATUS_TRANSITIONS,
} from "@/lib/orders/workflow";

describe("order workflow (pure rules)", () => {
  it("allows the happy path in order", () => {
    expect(canTransition(S.EN_COURS, S.EN_PREPARATION)).toBe(true);
    expect(canTransition(S.EN_PREPARATION, S.EXPEDIEE)).toBe(true);
    expect(canTransition(S.EXPEDIEE, S.EN_LIVRAISON)).toBe(true);
    expect(canTransition(S.EN_LIVRAISON, S.LIVREE)).toBe(true);
  });

  it("rejects skipping steps and moving backwards", () => {
    expect(canTransition(S.EN_COURS, S.LIVREE)).toBe(false);
    expect(canTransition(S.EN_COURS, S.EXPEDIEE)).toBe(false);
    expect(canTransition(S.EXPEDIEE, S.EN_COURS)).toBe(false);
    expect(canTransition(S.LIVREE, S.EN_LIVRAISON)).toBe(false);
  });

  it("allows cancelling only before the order is out for delivery", () => {
    expect(canTransition(S.EN_COURS, S.ANNULEE)).toBe(true);
    expect(canTransition(S.EN_PREPARATION, S.ANNULEE)).toBe(true);
    expect(canTransition(S.EXPEDIEE, S.ANNULEE)).toBe(true);
    expect(canTransition(S.EN_LIVRAISON, S.ANNULEE)).toBe(false);
  });

  it("treats delivered and cancelled as terminal", () => {
    expect(isTerminalStatus(S.LIVREE)).toBe(true);
    expect(isTerminalStatus(S.ANNULEE)).toBe(true);
    expect(isTerminalStatus(S.EN_COURS)).toBe(false);
  });

  it("covers every status with transitions and both label sets", () => {
    for (const s of Object.values(S)) {
      expect(STATUS_TRANSITIONS[s]).toBeDefined();
      expect(STATUS_LABELS_EN[s]).toBeTruthy();
      expect(STATUS_LABELS_FR[s]).toBeTruthy();
    }
  });

  it("lets the admin perform every legal transition", () => {
    for (const from of Object.values(S)) {
      for (const to of STATUS_TRANSITIONS[from]) {
        expect(roleCanTransition(R.ADMIN, from, to)).toBe(true);
      }
    }
  });

  it("limits delivery personnel to the two delivery steps", () => {
    expect(roleCanTransition(R.LIVREUR, S.EXPEDIEE, S.EN_LIVRAISON)).toBe(true);
    expect(roleCanTransition(R.LIVREUR, S.EN_LIVRAISON, S.LIVREE)).toBe(true);
    expect(roleCanTransition(R.LIVREUR, S.EN_COURS, S.EN_PREPARATION)).toBe(false);
    expect(roleCanTransition(R.LIVREUR, S.EN_PREPARATION, S.EXPEDIEE)).toBe(false);
    expect(roleCanTransition(R.LIVREUR, S.EXPEDIEE, S.ANNULEE)).toBe(false);
  });

  it("gives customers and vendors no status-change rights", () => {
    expect(roleCanTransition(R.CLIENT, S.EN_COURS, S.ANNULEE)).toBe(false);
    expect(roleCanTransition(R.VENDEUR, S.EN_COURS, S.EN_PREPARATION)).toBe(false);
  });
});
