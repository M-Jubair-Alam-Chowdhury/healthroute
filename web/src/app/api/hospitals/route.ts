/**
 * GET /api/hospitals?lat=23.8103&lng=90.4125&limit=10&radius=25
 *
 * Simulates the hospital database of the HealthAI Navigator backend.
 * In production, replace the in-memory array with your Prisma/MySQL query:
 *
 *   SELECT h.*, (6371 * acos(cos(radians(?)) * cos(radians(latitude)) *
 *     cos(radians(longitude) - radians(?)) + sin(radians(?)) *
 *     sin(radians(latitude)))) AS distance_km
 *   FROM hospitals h ORDER BY distance_km ASC LIMIT ?
 *
 * The module itself doesn't care where the data comes from — it only needs
 * the JSON contract documented in `src/lib/types.ts` (HospitalsApiResponse).
 */
import { NextRequest, NextResponse } from "next/server";
import { DHAKA_HOSPITALS } from "@/lib/hospitals-data";
import { haversineKm } from "@/lib/geo";
import type { HospitalWithDistance } from "@/lib/types";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lng = Number.parseFloat(params.get("lng") ?? "");
  const limit = Math.min(
    Math.max(Number.parseInt(params.get("limit") ?? "10", 10) || 10, 1),
    50
  );
  const radiusKm = Number.parseFloat(params.get("radius") ?? "25") || 25;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "Query parameters 'lat' and 'lng' are required numbers." },
      { status: 400 }
    );
  }

  const origin = { lat, lng };

  const hospitals: HospitalWithDistance[] = DHAKA_HOSPITALS.map((h) => ({
    ...h,
    distanceKm: haversineKm(origin, { lat: h.latitude, lng: h.longitude }),
  }))
    .filter((h) => h.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);

  return NextResponse.json({
    hospitals,
    count: hospitals.length,
    origin,
    source: "mock-db",
  });
}
