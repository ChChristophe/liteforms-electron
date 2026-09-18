// Temporary smoke test - validates that onnxruntime-web 1.21 can create
// sessions on the three wake word models and run the full pipeline under Node.
// Mirrors the approach of the PR #339 test/verify.mjs. Deleted after validation.
import * as ort from "onnxruntime-web";

ort.env.wasm.numThreads = 1;
ort.env.logLevel = "error";

const base = "../../../public/models/wakeword/";

const t0 = Date.now();
const [melspec, embed, wakeword] = await Promise.all([
  ort.InferenceSession.create(base + "melspectrogram.onnx", { executionProviders: ["wasm"] }),
  ort.InferenceSession.create(base + "embedding_model.onnx", { executionProviders: ["wasm"] }),
  ort.InferenceSession.create(base + "hey_jarvis_v0.1.onnx", { executionProviders: ["wasm"] }),
]);
console.log(`3 sessions created: ${Date.now() - t0} ms`);

console.log("melspec    inputs:", melspec.inputNames, "outputs:", melspec.outputNames);
console.log("embedding  inputs:", embed.inputNames, "outputs:", embed.outputNames);
console.log("hey_jarvis inputs:", wakeword.inputNames, "outputs:", wakeword.outputNames);
console.log('has inputMetadata:', "inputMetadata" in wakeword);

// --- replicate AudioFeatures._getMelspectrogram ---
const audio = new Int16Array(64000); // 4 s of noise like warmup()
for (let i = 0; i < audio.length; i++) audio[i] = Math.floor(Math.random() * 2000 - 1000);

const tf = Date.now();
const x = Float32Array.from(audio);
const melOut = await melspec.run({ [melspec.inputNames[0]]: new ort.Tensor("float32", x, [1, x.length]) });
const mo = melOut[melspec.outputNames[0]];
console.log(`melspec dims: [${mo.dims.join(", ")}]`);
console.log(`melspec run: ${Date.now() - tf} ms`);

// transform x/10 + 2 and build one 76x32 window batch
const bins = mo.dims[mo.dims.length - 1];
const frames = mo.dims[mo.dims.length - 2];
const flat = mo.data;
const WINDOW_SIZE = 76;
const STEP_SIZE = 8;
const winCount = Math.floor((frames - WINDOW_SIZE) / STEP_SIZE) + 1; // same as AudioFeatures._getEmbeddings
const embData = new Float32Array(winCount * 76 * bins);
for (let w = 0; w < winCount; w++) {
  for (let r = 0; r < 76; r++) {
    const srcFrame = w * STEP_SIZE + r;
    for (let b = 0; b < bins; b++) {
      embData[w * 76 * bins + r * bins + b] = flat[srcFrame * bins + b] / 10 + 2;
    }
  }
}
const te = Date.now();
const embOut = await embed.run({ [embed.inputNames[0]]: new ort.Tensor("float32", embData, [winCount, 76, bins, 1]) });
const eo = embOut[embed.outputNames[0]];
console.log(`embedding dims: [${eo.dims.join(", ")}] (expect [${winCount}, 96])`);
console.log(`embedding run: ${Date.now() - te} ms`);

// --- wake word prediction on last 16 embeddings ---
const tw = Date.now();
const embFlat = eo.data;
const N = eo.dims[0];
const wwData = new Float32Array(16 * 96);
for (let i = 0; i < 16; i++) {
  const src = Math.max(0, N - 16 + i) * 96;
  wwData.set(embFlat.slice(src, src + 96), i * 96);
}
const wwOut = await wakeword.run({
  [wakeword.inputNames[0]]: new ort.Tensor("float32", wwData, [1, 16, 96]),
});
const wo = wwOut[wakeword.outputNames[0]];
console.log(`hey_jarvis output dims: [${wo.dims.join(", ")}] score=${wo.data[0]}`);
console.log(`wakeword run: ${Date.now() - tw} ms`);

// --- sustained throughput estimate ---
const tn = Date.now();
const RUNS = 20;
for (let i = 0; i < RUNS; i++) {
  await wakeword.run({ [wakeword.inputNames[0]]: new ort.Tensor("float32", wwData.slice(), [1, 16, 96]) });
}
const perWakeword = (Date.now() - tn) / RUNS;
console.log(`wakeword inference avg: ${perWakeword.toFixed(2)} ms/frame (budget 80 ms)`);

console.log("SMOKE TEST PASS");
