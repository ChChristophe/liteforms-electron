# Bundle `wakeword` — « Hey Jarvis » (POC phase 1)

Détection de mot-clé **« Hey Jarvis »** 100 % client via ONNX Runtime Web,
adaptée du port navigateur d'[openWakeWord](https://github.com/dscripka/openWakeWord)
([PR #339](https://github.com/dscripka/openWakeWord/pull/339), commit `1c76cd9`,
Apache-2.0 — voir [LICENSE](./LICENSE)).

Ce bundle est le port Electron fidèle du bundle web `liteforms-web/bundles/wakeword/`.
**Tranche 1 = noyau autonome uniquement** : `bridge/`, `storage/` et
`components/WakeWordSettingsSelect.*` ne sont **pas** portés (phases 2/3).

## Pipeline

```
microphone (getUserMedia, mono, echo/noise/AGC)
  └─ AudioWorklet public/worklets/pcm-worklet.js   Int16 @16 kHz, frames de 1280 échantillons (80 ms)
       └─ engine/audioFeatures.ts                  melspectrogram.onnx → embedding_model.onnx → 96-dim
            └─ engine/openWakeWordEngine.ts        hey_jarvis_v0.1.onnx (fenêtre de 16 embeddings ≈ 1,28 s)
                 └─ controller + store + hook      états, cooldown, événements typés, Zustand
                      └─ components/WakeWordPocPanel.tsx   UI POC (/poc-wakeword)
```

Modèles auto-hébergés dans `public/models/wakeword/` (les releases GitHub n'envoient
pas les en-têtes CORS). Binaires wasm ORT dans `public/ort/`.

## Threading wasm — correction du plan web (§6.4 obsolète)

Le plan web prévoyait de chasser un build ORT single-thread à cause de
`crossOriginIsolated === false`. **Ce n'est pas le cas dans Electron** :
`next.config.ts` envoie déjà `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp` (vérifié en interrogeant le
serveur standalone), donc `crossOriginIsolated === true` dans le renderer.

Le port réutilise donc **exactement** l'ORT self-hosté de la web :

- import dynamique **`onnxruntime-web/wasm`** (build wasm-only, importé
  uniquement côté client) ;
- artefacts `ort-wasm-simd-threaded.mjs` / `.wasm` servis depuis `public/ort/` ;
- `ort.env.wasm.wasmPaths = "/ort/"` ;
- `numThreads: 1` (comportement déterministe ; des threads multiples sont
  possibles plus tard puisque `crossOriginIsolated` est vrai).

`scripts/prepare-electron-next.mjs` copie déjà `public/` dans le standalone
packagé → `public/ort`, `public/models/wakeword` et `public/worklets` sont bien
servis dans l'appliance.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `engine/microphone.ts` | Capture mic → frames PCM 16 bits @16 kHz (AudioWorklet) |
| `engine/audioFeatures.ts` | Extracteur streaming melspectrogramme + embeddings |
| `engine/modelsRegistry.ts` | Registre restreint aux modèles self-hostés (`hey_jarvis` + 3) |
| `engine/openWakeWordEngine.ts` | Sessions ORT + prédiction multi-modèles |
| `controller/wakeWordController.ts` | Machine à états, cooldown 2 s, file bornée (5 frames) |
| `store/wakeWordStore.ts` | État UI Zustand (aucune donnée audio ne transite) |
| `hooks/useWakeWord.ts` | Branchement React (StrictMode-safe), start/stop/setThreshold |
| `components/WakeWordPocPanel.tsx` | Panneau POC autonome (styles inline, zéro modif core) |
| `types.ts` / `config.ts` | Contrat public et défauts |
| `types/onnxruntime-web.d.ts` | Déclaration ambiante minimale (ORT 1.21 sans condition "types") |

## Essayer

```bash
npm run dev
# puis http://localhost:3000/poc-wakeword
```

Autoriser le micro, dire « Hey Jarvis » : le score doit dépasser ~0,5 et une
détection apparaît dans l'historique. Le seuil est réglable en live.

## Hors périmètre (tranches suivantes)

- `bridge/` (intégration ChatPanel, CustomEvent, gate vocal) — phase 2.
- `storage/wakeWordConfig.ts`, `store/wakeWordSettingsStore.ts`,
  `components/WakeWordSettingsSelect.tsx` (sélection persistante + cue) — phase 3.
- `features.json` (`{ "wakeword": true }`) et `lib/core/featureFlags.ts` sont
  créés dès maintenant pour garder la parité, mais ne sont consommés qu'en
  tranche 3.

## Limites connues

- Le toggle d'écoute n'est pas persisté (réinitialisé à chaque rechargement).
- ort-web 1.21 n'expose pas les métadonnées de session : la taille d'entrée
  (16 frames) et le nombre de sorties (1) utilisent des valeurs par défaut
  correctes pour `hey_jarvis_v0.1`.
- Dans Electron, l'entrée micro passe par le renderer ; accès micro dépendant
  des permissions OS/navigateur embarqué.
