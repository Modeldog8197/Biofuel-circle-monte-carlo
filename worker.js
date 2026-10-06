import { simulate } from "./model.js?v=2.1";
import { scenarioPaths } from "./analysis.js?v=2.1";
let results, targets, baseId;
self.onmessage = ({ data }) => {
  try {
    if (data.op === "scenario") {
      if (data.baseId !== baseId) return;
      const changed = Object.fromEntries(
        Object.entries(results).map(([name, s]) => [
          name,
          scenarioPaths(s.paths, {
            ...data.settings,
            unit: targets[name].unit,
            response: targets[name].scenario_response,
          }),
        ]),
      );
      self.postMessage({
        op: "scenario",
        id: data.id,
        baseId,
        results: changed,
      });
    } else {
      targets = data.targets;
      results = Object.fromEntries(
        Object.entries(targets).map(([name, target]) => [
          name,
          simulate(target, data.n, data.seed),
        ]),
      );
      baseId = data.id;
      self.postMessage({ id: data.id, results });
    }
  } catch (error) {
    self.postMessage({
      op: data.op === "scenario" ? "scenario" : undefined,
      id: data.id,
      baseId: data.baseId,
      error: error.message,
    });
  }
};
