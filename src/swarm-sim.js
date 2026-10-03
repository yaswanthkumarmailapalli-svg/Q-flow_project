/* =========================================================
   Q-FLOW — SWARM SIMULATION: 2D particle swarm used for the animated "swarm" panels
   Pure logic, no DOM. UMD: in the browser it defines the globals
   qflowCreateSwarm / qflowSwarmStep (as before); in Node, require() it.
   Math.random is intentional here (decorative simulation, not the VRP engine).
   ========================================================= */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const api = factory();
    root.QFlowSwarmSim = api;
    root.qflowCreateSwarm = api.qflowCreateSwarm;
    root.qflowSwarmStep = api.qflowSwarmStep;
    root._qflowLandscape2D = api.landscape2D; // kept global, as in the old app.js
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 2D PARTICLE SWARM OPTIMIZATION (PSO) ---------- */
  function qflowCreateSwarm(n = 16) {
    const particles = [];
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * 10 - 5,
        y: Math.random() * 10 - 5,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        bestX: 0,
        bestY: 0,
        bestCost: Infinity
      });
    }
    return {
      particles,
      globalBestX: 0,
      globalBestY: 0,
      globalBestCost: Infinity,
      iter: 0,
      bump: 0,
      history: []
    };
  }

  function _qflowLandscape2D(x, y, bump) {
    const base = (x * x + y * y) * 0.08;
    const obstacle = bump ? bump * Math.exp(-(Math.pow(x - 2.2, 2) + Math.pow(y - 1.8, 2)) / 3.0) : 0;
    return base + obstacle;
  }

  function qflowSwarmStep(swarm) {
    const w = 0.65,
      c1 = 0.8,
      c2 = 1.1;
    swarm.particles.forEach((p) => {
      const cost = _qflowLandscape2D(p.x, p.y, swarm.bump);
      if (cost < p.bestCost) {
        p.bestCost = cost;
        p.bestX = p.x;
        p.bestY = p.y;
      }
      if (cost < swarm.globalBestCost) {
        swarm.globalBestCost = cost;
        swarm.globalBestX = p.x;
        swarm.globalBestY = p.y;
      }
    });

    swarm.particles.forEach((p) => {
      const r1 = Math.random(),
        r2 = Math.random();
      p.vx = w * p.vx + c1 * r1 * (p.bestX - p.x) + c2 * r2 * (swarm.globalBestX - p.x);
      p.vy = w * p.vy + c1 * r1 * (p.bestY - p.y) + c2 * r2 * (swarm.globalBestY - p.y);
      p.x += p.vx * 0.2;
      p.y += p.vy * 0.2;
    });

    swarm.iter++;
    const spread = Math.sqrt(
      swarm.particles.reduce(
        (s, p) => s + Math.pow(p.x - swarm.globalBestX, 2) + Math.pow(p.y - swarm.globalBestY, 2),
        0
      ) / swarm.particles.length
    );
    const convergencePct = Math.max(0, Math.min(100, Math.round(100 - spread * 14)));
    const exploring = swarm.particles.filter(
      (p) => Math.hypot(p.x - swarm.globalBestX, p.y - swarm.globalBestY) > 0.8
    ).length;

    swarm.history.push(swarm.globalBestCost);
    if (swarm.history.length > 30) swarm.history.shift();

    return { convergencePct, exploring, iter: swarm.iter, cost: swarm.globalBestCost };
  }

  return { qflowCreateSwarm, qflowSwarmStep, landscape2D: _qflowLandscape2D };
});
