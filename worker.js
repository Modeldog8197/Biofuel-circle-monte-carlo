import { simulate } from "./model.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      result: simulate(data.target, data.n, data.seed),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
