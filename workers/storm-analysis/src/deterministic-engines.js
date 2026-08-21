import '../../../analysis/storm-analysis-core.js';
import '../../../analysis/hk-impact-engine.js';
import '../../../analysis/hko-signal-risk-inputs.js';
import '../../../analysis/hko-signal-risk-calibration.js';
import '../../../analysis/basic-hk-signal-forecast.js';

export function getDeterministicEngines() {
  const snapshot = globalThis.StormAnalysisCore;
  const impact = globalThis.StormHongKongImpactEngine;
  const signal = globalThis.StormHkoSignalRiskInputs;
  const signalCalibration = globalThis.StormHkoSignalRiskCalibration;
  const basicSignalForecast = globalThis.StormBasicHkSignalForecast;
  if (typeof snapshot?.buildStormAnalysisSnapshot !== 'function'
      || typeof impact?.buildHongKongImpact !== 'function'
      || typeof signal?.buildHkoSignalRiskInputs !== 'function'
      || typeof signalCalibration?.estimateHkoSignalRisk !== 'function'
      || typeof basicSignalForecast?.buildBasicHkSignalForecast !== 'function') {
    throw new Error('deterministic analysis engines are unavailable');
  }
  return Object.freeze({ snapshot, impact, signal, signalCalibration, basicSignalForecast });
}
