import { createFixtureCreditServices } from "../db/fixtures.js";
import { getCreditBackend } from "../credit-context.js";
import type { FastifyInstance } from "fastify";
import { EvidenceError, type EvidenceService } from "@shellfish/evidence";
import { CompatibilityError, type CompatibilityService } from "@shellfish/compatibility";
import { RegistryError, type CreditRegistry } from "@shellfish/registry";
import { BorrowingMandate, EvidencePassport, LenderFacilityOffer } from "@shellfish/schemas";
export interface GitaRouteOptions {
    services?: {
        evidence: EvidenceService;
        credit: CompatibilityService;
        registry?: CreditRegistry;
    };
    mode?: "SIMULATED_LOAN" | "LIVE_DEVNET";
}
/** Gita's read/evaluate/match boundary. No authorization, signing or raw performance writes. */
export async function gitaRoutes(app: FastifyInstance, options: GitaRouteOptions = {}) {
    const mode = options.mode ?? process.env.NETWORK_MODE ?? "SIMULATED_LOAN";
    if (mode !== "SIMULATED_LOAN" && mode !== "LIVE_DEVNET")
        throw new Error("Invalid credit route mode");
    const fallbackServices: GitaRouteOptions["services"] = options.services ?? (mode === "SIMULATED_LOAN" ? createFixtureCreditServices() : undefined);
    /** Prefer the live credit backend after demo reset so facility/evidence stay current. */
    const resolveServices = () => getCreditBackend()?.services ?? fallbackServices;
    const unavailable = () => ({ code: "CREDIT_SOURCE_NOT_CONFIGURED", message: "Inject the verified evidence and registry services for native mode", mode });
    const requireMode = (payload: {
        mode: string;
    }) => { if (payload.mode !== mode)
        throw new CompatibilityError("DENY_UNSUPPORTED_NETWORK", "Credit data must use the configured execution mode"); };
    function error(reply: {
        code: (status: number) => unknown;
    }, err: unknown) {
        if (err instanceof EvidenceError || err instanceof CompatibilityError || err instanceof RegistryError) {
            reply.code(err.code === "DENY_IDENTITY" || err.code === "NOT_FOUND" ? 404 : 400);
            return { code: err.code, message: err.message, mode };
        }
        if (err instanceof Error && err.name === "ZodError") {
            reply.code(400);
            return { code: "DENY_TRANSACTION_MISMATCH", message: "Payload does not match the shared contract", mode };
        }
        throw err;
    }
    app.get<{
        Params: {
            id: string;
        };
    }>("/v1/evidence/:id", async (req, reply) => {
        const services = resolveServices();
        if (!services) {
            reply.code(503);
            return unavailable();
        }
        try {
            const passport = await services.evidence.getEvidencePassport(req.params.id);
            requireMode(passport);
            return passport;
        }
        catch (err) {
            return error(reply, err);
        }
    });
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            subject_id?: string;
            evidence?: unknown;
        };
    }>("/v1/lenders/:id/evaluate", async (req, reply) => {
        const services = resolveServices();
        if (!services) {
            reply.code(503);
            return unavailable();
        }
        try {
            const body = req.body ?? {};
            const passport = body.evidence ? EvidencePassport.parse(body.evidence) : body.subject_id ? await services.evidence.getEvidencePassport(body.subject_id) : undefined;
            if (!passport) {
                reply.code(400);
                return { code: "DENY_IDENTITY", message: "Provide subject_id or evidence", mode };
            }
            requireMode(passport);
            return await services.credit.evaluateLender(req.params.id, passport);
        }
        catch (err) {
            return error(reply, err);
        }
    });
    app.post<{
        Body: {
            mandate?: unknown;
            offers?: unknown[];
            evidence?: unknown;
        };
    }>("/v1/offers/match", async (req, reply) => {
        const services = resolveServices();
        if (!services) {
            reply.code(503);
            return unavailable();
        }
        try {
            const body = req.body ?? {};
            const mandate = BorrowingMandate.parse(body.mandate);
            requireMode(mandate);
            if (!Array.isArray(body.offers)) {
                reply.code(400);
                return { code: "DENY_NO_OVERLAP", message: "Provide a firm offers array", mode };
            }
            const offers = body.offers.map(raw => LenderFacilityOffer.parse(raw));
            return services.credit.matchOffers({ mandate, offers, ...(body.evidence ? { evidence: EvidencePassport.parse(body.evidence) } : {}) });
        }
        catch (err) {
            return error(reply, err);
        }
    });
    app.get<{
        Params: {
            id: string;
        };
    }>("/v1/facilities/:id", async (req, reply) => {
        const services = resolveServices();
        if (!services?.registry) {
            reply.code(503);
            return unavailable();
        }
        try {
            requireMode(services.registry.getCreditStatus(req.params.id));
            return services.registry.getFacility(req.params.id);
        }
        catch (err) {
            return error(reply, err);
        }
    });
    app.get<{ Params: { id: string } }>("/v1/facilities/:id/credit-status", async (req, reply) => {
        const registry = resolveServices()?.registry ?? getCreditBackend()?.registry;
        if (!registry) { reply.code(503); return unavailable(); }
        try {
            const status = registry.getCreditStatus(req.params.id);
            requireMode(status);
            return status;
        } catch (err) { return error(reply, err); }
    });
    app.post<{ Params: { id: string }; Body: unknown }>("/v1/facilities/:id/quote", async (req, reply) => {
        const registry = resolveServices()?.registry ?? getCreditBackend()?.registry;
        if (!registry) { reply.code(503); return unavailable(); }
        try {
            const quote = registry.quoteCredit(req.params.id, req.body);
            requireMode(quote);
            return quote;
        } catch (err) { return error(reply, err); }
    });
}
