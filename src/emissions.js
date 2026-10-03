/* =========================================================
   Q-FLOW — CO2 EMISSIONS MODEL (estimate)
   The single place where CO2 per km is parameterised. UMD: browser global
   QFlowEmissions; require()-able in Node (used by vrp-engine.js and tests).

   Speed-dependent factor, an APPROXIMATION in the style of COPERT
   (EMEP/EEA air pollutant emission inventory guidebook, chapter 1.A.3.b
   "Road transport"), whose CO2 / fuel curves for passenger cars are U-shaped
   in average trip speed: high in slow stop-and-go traffic, lowest around
   60-80 km/h, rising again at motorway speeds.

   Form:   EF(v) = A / v + B + C * v^2      [g CO2 per km, v in km/h]
   A, B, C are fitted to three anchor points for a typical petrol passenger
   car: ~290 g/km at 10 km/h, ~120 g/km at 60 km/h, ~140 g/km at 120 km/h.
   These anchors are rounded, indicative values chosen to match the general
   shape of COPERT curves; they are NOT the published COPERT coefficients and
   were not checked against the guidebook tables. Treat every output as an
   estimate. Speed is clamped to 10-130 km/h, the range such curves are
   normally used for (the A/v term is unrealistic below that).

   Other vehicles are scaled by baseGPerKm / 120 (e.g. a two-wheeler at
   42 g/km uses 0.35 x the car curve). Vehicles with speedCurve: false
   (EVs, whose consumption does not follow a combustion-engine curve) use
   their flat base factor. If speed is unavailable, the flat base factor is
   used: 120 g/km for the reference car, the old constant.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowEmissions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODEL = {
    referenceGPerKm: 120, // old flat constant; also the fallback when speed is unknown
    A: 2188.7,
    B: 70.78,
    C: 0.003541,
    minSpeedKmh: 10,
    maxSpeedKmh: 130,
    source: 'Approximate COPERT-style speed curve (EMEP/EEA guidebook 1.A.3.b shape; not official coefficients)'
  };

  // g CO2/km for the reference petrol car at average speed v (km/h).
  function curveGPerKm(speedKmh) {
    const v = Math.min(MODEL.maxSpeedKmh, Math.max(MODEL.minSpeedKmh, speedKmh));
    return MODEL.A / v + MODEL.B + MODEL.C * v * v;
  }

  const validSpeed = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

  // g CO2/km. opts.baseGPerKm: the vehicle's flat factor (default 120);
  // opts.speedCurve: false -> always flat (e.g. EV).
  function gPerKm(speedKmh, opts) {
    const base = opts && opts.baseGPerKm !== undefined ? opts.baseGPerKm : MODEL.referenceGPerKm;
    if ((opts && opts.speedCurve === false) || !validSpeed(speedKmh)) return base;
    return curveGPerKm(speedKmh) * (base / MODEL.referenceGPerKm);
  }

  // Grams of CO2 for a trip of distanceKm driven in driveMinutes.
  // Falls back to the flat factor when the driving time is missing or zero.
  function tripGrams(distanceKm, driveMinutes, opts) {
    if (!(distanceKm > 0)) return 0;
    const speed = driveMinutes > 0 ? distanceKm / (driveMinutes / 60) : NaN;
    return distanceKm * gPerKm(speed, opts);
  }

  // Sum over routes that carry { distKm, driveTimeMin } (as produced by the VRP
  // evaluator). Each route uses its own average driving speed.
  function routesGrams(routes, opts) {
    return (routes || []).reduce((s, r) => s + tripGrams(r.distKm, r.driveTimeMin, opts), 0);
  }

  return { MODEL, curveGPerKm, gPerKm, tripGrams, routesGrams };
});
