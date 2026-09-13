# PLAN DIRECTEUR — Liteforms, l'appliance à hologramme (Mini-PC + Looking Glass)

> Document de travail unique, issu de l'échange complet. Il sert de **base de référence** pour toute la suite du projet.
> Dernière mise à jour : 10/09/2026 — **fix persistance des réglages packagés** (voir §1.6) ; support Linux du bridge vérifié (officiel), choix mobile **RN/Expo**, flux de fabrication (image dorée), estimations de portage mobile.

---

## 0. Vision produit

Liteforms devient une **appliance** :

- un **Mini-PC Linux** branché → l'app Electron **démarre toute seule** ;
- un **Looking Glass** affiche l'avatar holographique (Clawdia) avec **lip-sync** piloté par la voix (TTS + voix temps réel) ;
- **aucun écran/UI nécessaire au quotidien** : l'app **mobile** est la source de vérité pour toute la configuration ;
- le téléphone provisionne le Mini-PC (Wi-Fi maison), le couple (devise_id/secret) puis pousse les réglages **en direct** (sans redémarrer) : modèles LLM/TTS/ASR, wake word, couleur de l'alcove, émotion, choix du VRM, etc.

Cette vision implique **3 chantiers imbriqués** :
1. **le portage web → Electron** du travail fait dans le repo web (31 commits `Jarvis:`) ;
2. **l'app mobile** (UI de configuration + provisioning) — projet séparé ;
3. **le kiosque Linux** (autostart, Wi-Fi, appairage, mise à jour auto).

Ce document couvre l'ensemble, avec états, difficultés, risques, chiffres et phasage.

---

## 1. Contexte technique (repos, environnement, validation)

### 1.1 Repos

| Repo | Rôle | Origine | État actuel |
|---|---|---|---|
| `C:\dev\liteforms-web` | Repo « web » : **31 commits `Jarvis:`** à porter | origine GitHub (ChChristophe) | HEAD = `9fc237f` (calcul realtime) |
| `C:\dev\liteforms-electron` | **Workspace de dev** (travail non commité : holo, systray, port alcove…) | origin `Looking-Glass/liteforms-web` | working tree divergent, **rien commité** |
| `C:\dev\electron\liteforms-electron` | **Fork privé / base de travail** (6 commits `Jarvis:` créés localement, **jamais poussés**) | `git@github.com:ChChristophe/liteforms-electron.git` | HEAD `52dcd05` + 6 commits locaux ; working tree propre |

**Topologie git** : ancêtre commun `7fa7670`. Puis :
- côté Electron : `5fdad0c` (fix calibration bridge) → `4dbecb1` (build ouvre une fenêtre) → `52dcd05` (fullscreen + suppression d'UI) ;
- côté web : les **31 commits `Jarvis:`** (dont l'ancêtre des deux côtés a divergé).

### 1.2 Environnement de travail

- OS : **Windows 10/11 (build 26200)**, shell PowerShell 5.1.
- Node `npm`, **electron-builder 26.8.1**, **Electron 41.7.1**, Next.js **standalone**.
- Scripts utiles (dans la paire de repos) :
  - `npm run build:electron` = `build:electron:main` (`tsc -p electron/tsconfig.json`) + `build:electron:next` (`next build` en mode `LITEFORMS_ELECTRON_BUILD=1` + `scripts/prepare-electron-next.mjs`) ;
  - `npm run dist:electron` = build + `electron-builder --config electron-builder.config.cjs` ;
  - `npm test` = `vitest run` ; `npm run lint` = `eslint .` ;
  - typecheck complet = `npx tsc --noEmit`.

### 1.3 Ce qui est déjà validé

- **Fenêtre `/hologram`** dédiée au Looking Glass : lip-sync stable via RMS, TTS + voix temps réel relayés depuis la fenêtre principale par `postMessage`, minimisation → **systray avec logo**.
- **Build Windows fonctionnel** : `release\win-unpacked\Liteforms.exe` + installateur NSIS ; ressources vérifiées : `resources\next\standalone\server.js` (fix standalone), `resources\bridge\win32-x64` (bridge natif), icônes dans l'asar.
- **Tests** : 22/22 verts pour `environmentLoader` + `environmentConfig` ; eslint propre sur les fichiers portés ; `tsc --noEmit` sans erreur sur les fichiers du port (erreurs **pré-existantes** non liées dans `electron/electronBuild.test.ts`, `lib/avatar/nativeLookingGlassBridge.test.ts`, `lib/avatar/vrmMorphTargetRepair.test.ts`).
- **11 warnings eslint pré-existants** dans `ChatPanel.tsx` (lignes non touchées).
- **Persistance** : `localStorage` (`sessionConfig.ts`, `characterConfig.ts`, clé onboarding, `environmentConfig.ts`) + **IndexedDB** (DB `liteforms` : `indexedDbCredentialRepository.ts`, `indexedDbVrmRepository.ts`). Dossier `%APPDATA%\liteforms-web` (userData). Par origine. `/hologram` n'écrit rien.

### 1.4 Les 6 commits `Jarvis:` (base du miroir)

1. `ba4f8e7` — **fix packaged Next server location** : standalone copié dans `resources/next` (`afterPack` `cpSync .next/standalone`), `resolveStandaloneDir`, excludes tsconfig.
2. `8e395fe` — **add app in systray with logo** : tray/park hors-écran/`setSkipTaskbar`, `resources/` (icon.ico, icon-256.png, icon-32.png), `scripts/generate-icons.mjs`, `win.icon`.
3. `f7a51ea` — **add diagnostics log and hologram DOM/probe instrumentation** : `diagnosticLog.ts`, preload, `writeDiagnostic`/`wireWebContentsDiagnostics`, pageLogRef.
4. `f219bf8` — **add hologram window on the Looking Glass display** : `windowOpenPolicy`, `hologramWindow.ts`, code intermédiaire du protocol/bridge/page holo.
5. `bdde1f8` — **relay TTS and realtime voice into the hologram window for lip-sync** : ChatPanel final + protocol/bridge/page holo finaux.
6. `759174d` — **add master plan for the Liteforms appliance roadmap** : ce `PLAN_DIRECTEUR.md`.

**Règle de travail** : commits `Jarvis: <sujet anglais>`, créés localement dans le miroir, **aucun push sans accord**.

### 1.5 Dernier port effectué (non encore commité nulle part)

**`a5c88bb` « Change Alcove color in UI » porté dans le workspace** `C:\dev\liteforms-electron`, adapté aux divergences (holo/`hideVrButton`) :

- nouveaux : `lib/storage/environmentConfig.ts`, `environmentConfig.test.ts` ;
- modifiés : `environmentLoader.ts` (tint + snapshot matières/WeakMap), `environmentLoader.test.ts` (+4 tests), `AvatarScene.tsx` (prop `environmentTint`, refs, apply au chargement + cleanup + `useEffect`), `ChatPanel.tsx` (props/état/handlers + rangée « Alcove color » sous Load VRM, panneau Advanced), `app/page.tsx` (état + `loadEnvironmentConfig` + handler persisté + câblage props), `app/globals.css` (`.alcove-color-label`, `.advanced-hint`) ;
- **`/hologram`** : la fenêtre holo lit `loadEnvironmentConfig()` au montage + écoute l'événement **`storage`** → le tint se met à jour **en direct** depuis la fenêtre principale (même origine `localStorage`, aucun IPC nécessaire) ; Reset → matières d'origine.

### 1.6 Fix persistance des réglages en app packagée (10/09/2026)

**Symptôme** : une clef API (ou toute autre réglage) saisie dans l'app packagée
disparaissait après chaque redémarrage de l'app.

**Cause racine** : le serveur Next embarqué écoutait sur un **port aléatoire**
(`getAvailablePort()` → `listen(0)`) à chaque lancement (`electron/main.ts`),
et la fenêtre chargeait `http://127.0.0.1:<port>` derrière. Chromium stocke
`localStorage` + IndexedDB **par origine** (host + port), donc chaque lancement
reprenait depuis une origine neuve et vide. Les données étaient bien écrites sur
disque (`%APPDATA%\liteforms-web`), juste orphelinées sous l'origine des anciens
ports — jamais relues. Sont concernés : clefs API (`liteforms.credentials`),
config de session (`liteforms.sessionConfig`), personnage
(`liteforms.characterConfig`), VRM (`liteforms` IndexedDB), via les sections
correspondantes de §1.3.

**Fix** (validé matériellement sous Windows le 10/09/2026) :

- `electron/nextServer.ts` : port **fixe** `43178` (`LITEFORMS_SERVER_PORT`),
  détection `isHttpServerUp(url)`, `getAvailablePort()` supprimée ;
- `electron/main.ts` (`startPackagedNextServer`) : si quelque chose répond déjà
  sur le port fixe (serveur orphelin d'un run crashé, ou seconde instance), on
  le **réutilise** au lieu d'en lancer un second ;
- test : le comportement de `isHttpServerUp` (serveur vivant détecté, port
  mort refusé) dans `electron/electronBuild.test.ts`.

**Limites connues** :
- le chemin dev (`npm run dev:electron`, origin `http://localhost:3000`) n'a
  jamais eu le bug (port fixe d'office) et garde son propre profil séparé ;
- les données saisies avant le fix (sous d'anciens origines à ports aléatoires)
  ne sont **pas** récupérées — à resaisir une fois ;
- le port fixe doit rester libre pour l'app ; s'il est occupé par autre chose,
  l'app réutilisera ce répondant (voir `ponytail:` dans `main.ts`).
- si le run précédent a été tué durement, un serveur orphelin peut rester en
  mémoire : le chemin « réutilisation » gère ce cas transparentement.

---

## 2. Audit du portage web → Electron (31 commits `Jarvis:`)

### 2.1 Méthode

Fichiers des commits comparés entre l'arbre Electron actuel, la base commune `7fa7670` et le HEAD web. Résultat : **tous les modules partagés ont divergé** (l'app Electron a une base plus récente : LKG + holo + systray), seul `environmentLoader.ts` est identique au HEAD web (porté). En conséquence **chaque port demande une adaptation**, mais rien ne dépend d'API OS/bridge natif → **faisabilité quasi maximale partout**.

### 2.2 Tableau d'audit complet

| # | Commit | Contenu | Diff | Faisa | Notes |
|---|---|---|---|---|---|
| 1 | `4952eed` | Init + docs `.md` | 1 | N/A | documents seulement |
| 2 | `985278b` | Update provider + erreurs système | 2 | 10 | probablement déjà couvert par la base Electron (onboarding plus riche) |
| 3 | `b124d76` | Lipsync OpenAI TTS | 3 | 9 | ≈ chaîne lip-sync LKG déjà en place (`vrmRuntimeAnimator` divergé) |
| 4 | `aba7316` | Modale vitesse d'élocution OpenAI | 2 | 10 | `OnboardingModal.tsx` à adapter |
| 5 | `95b2784` | Meilleur idle loop + foot place | 3 | 9 | équivalent déjà présent : `VrmIdleAnimator` (`vrmAnimationLoader.ts`) + `vrmFootPlantLock.ts` |
| 6 | `ff26033` | Depth VRM dans l'alcove | 2 | 10 | à retuner pour le viewport `/hologram` |
| 7 | `050c195` | Recenter hips animation | 2 | 10 | `vrmAnimationLoader.ts` |
| 8 | `a5c88bb` | **Alcove color** | ✅ | **fait** (4 effectif) | porté en workspace + `/hologram` (voir 1.5) |
| 9 | `bf978b2` | Emotion en face | 4 | 9 | nouveau `moodConfig` (storage) + `vrmExpressionController` + UI 2 fenêtres |
| 10 | `922809e` | Fix bugs core | 3 | 8 | re-corriger manuellement un `ChatPanel` fortement divergé |
| 11 | `5086b76` | **Bundle OpenWakeWord** | 7 | 8 | gros kit (moteur ort + modèles `.onnx` + worklet + featureFlags) ; `onnxruntime-web@1.21` **déjà en deps** ; threading wasm → voir §6.4 |
| 12 | `a72535d` | UI wake word + fixes activation | 3 | 9 | dépend du bundle #11 |
| 13 | `bc9d76e` | Sélection modèle + persistance | 3 | 9 | `wakeWordConfig`/store |
| 14 | `351b034` | Câblage UI wake word | 3 | 9 | `ChatPanel` divergé |
| 15 | `f0e4ee9` | POC panel étendu | 2 | 9 | composant+tests |
| 16 | `2033482` | Cue wake word (blink alcove + greeting) | 4 | 9 | à adapter à l'animator Electron (`idleChoreographer` ≠ absence Electron) |
| 17 | `bf81276` | Cue configurable | 3 | 9 | storage `wakeWordConfig` |
| 18 | `3948403` | Doc études | 1 | N/A | documents |
| 19 | `949dee2` | Sessions OpenClaw réutilisées (conversation ids) | 4 | 9 | `adapters.ts`/`types.ts` divergés |
| 20 | `a3c1f90` | Conversation id stable → LLM | 3 | 9 | `ChatPanel` |
| 21 | `a6dd16a` | Max 2 TTS concurrents | 3 | 9 | throttling dans le `ChatPanel` divergé |
| 22 | `e1e0c13` | Strip markdown (display + parlé) | 2 | 10 | logique pure (`lib/llm/output.ts`, `lib/speech/tts.ts`) |
| 23 | `21ac88a` | Doc suite | 1 | N/A | documents |
| 24 | `28cc967` | **Function calling + OpenClaw + audio utils** | 6 | 9 | routes Next **tournent dans le standalone** ✓ ; `audioUtils` ≈ `audioPlayback` existant ; tools à réinjecter dans `googleLive`/`openAiRealtime` + `ChatPanel`/holo ; `openclawGatewayToken` |
| 25 | `de2aed2` | TimerManager | 2 | 10 | module 100 % client |
| 26 | `f0884a7` | Tools timer realtime | 3 | 9 | fournisseurs realtime |
| 27 | `a9df03e` | Timers dans ChatPanel (chime + notif) | 4 | 9 | UI + audio chime |
| 28 | `e1037ce` | get_current_date | 3 | 9 | après l'infra #24 |
| 29 | `9fc237f` | calculate + parser sûr | 3 | 9 | parser pur + route |

### 2.3 Verdict du portage

- **100 % faisable** (faisabilité ≥ 8/10 partout).
- Les **2 vrais chantiers** : `5086b76` (wake word complet) et `28cc967` (function calling realtime).
- Le reste : adaptations mineures de fichiers divergés.

---

## 3. Décisions produit (établies avec l'utilisateur)

### 3.1 Configuration déléguée au smartphone

1. **Source de vérité = le téléphone.** L'UI desktop n'est pas éditée (POC).
2. **Live sans reboot** : chaque changement est appliqué immédiatement par l'app (voir §4).
3. **VRM** : le fichier `.vrm` reste **sur la machine** (déjà en IndexedDB) ; le téléphone envoie seulement le **choix du modèle** (nom/référence), pas un upload.
4. ~~**Sécurité minimale au POC** : un token d'appairage suffit~~ **[MISE À JOUR 10/09 — contrat mobile v1 verrouillé]** : la v1 délibérée avec le Mobile est **sans token** (LAN local de confiance) ; appairage (device/token) repoussé à la phase 4. Voir §4.4.

### 3.2 Parcours utilisateur cible (appliance)

```
1. Brancher le Mini-PC → ON        (Electron démarre en auto-start)
2. Electron crée le hotspot `Liteforms-Setup-XXXX`  (mode provisioning, 1er boot ;
   **contrat v1 : SSID `Liteforms-Setup-XXXX`, service sur `192.168.4.1:8080`** —
   et l'appliance n'affiche **aucun** code/QR/écran de configuration, §4.4)
3. Le mobile rejoint le hotspot via les réglages WiFi système (iOS :
   instruction + ouverture des réglages, pas de sélection programmatique)
4. L'app mobile demande le Wi-Fi maison (SSID + mot de passe) → POST à Electron
5. Electron configure le WiFi cible (Linux : NetworkManager/nmcli ;
   Windows : profil WLAN `netsh wlan add profile` ou API WinRT —
   **voir §6.2, Windows doit aussi être fonctionnel**) → le poste rejoint le Wi-Fi
   maison, abandonne son hotspot
6. Le téléphone rejoint le même Wi-Fi → communication LAN normale
   (découverte par **IP manuelle d'abord, mDNS ensuite**)
+ Sécurité d'association pendant le provisioning :
   mini PC génère DEVICE_ID + PAIRING_SECRET ; Electron garde la liste
   (Device, Paired-Phone, Token) ; toute écriture config exige le token.
   **[contrat v1 10/09 : pas de token au provisioning ni sur device-config ;
   cette association device/token est REPORTÉE phase 4]**
```

> ⚠️ Ancien texte de phasage (obsolète depuis le contrat mobile 10/09, conservé pour trace) : au POC, le provisioning manuel (IP + code à 6 chiffres affiché à l'écran) remplace les étapes 2-5. Le hotspot n'arrive qu'en phase 3.
> **Le contrat contracte le hotspot dès le flux initial** (étape 2 des priorités Electron) — et le code/QR à l'écran est désormais **interdit** (l'appliance n'affiche rien, §4.4).

---

## 4. Architecture « config téléphone → Electron » (POC)

### 4.1 Réalité d'architecture à connaître

- Toute la config vit **côté renderer** (`localStorage` + IndexedDB). Les **routes Next tournent dans le processus serveur** (Node) qui n'a pas accès au `localStorage` du renderer.
- Il faut donc un chemin **serveur → main → renderer** :

```
Téléphone ─POST /api/device-config (token)─▶ serveur Next local
       │ écrit device-config.json dans userData
       ▼
Main Electron ─fs.watch / polling─▶ webContents.send("device-config-change", json)
       ▼ (via le preload déjà en place)
Renderer ─fonction applyDeviceConfig()─▶ setters existants (rendu live)
```

- Alternative simple au POC : le renderer **polle** `GET /api/device-config` toutes les 2 s (moins de code que `fs.watch` main→IPC). Passing à un push (SSE/WebSocket ou IPC) ensuite.

### 4.2 L'application (apply live) réutilise l'existant

| Config poussée | Application côté Electron | Réalité technique |
|---|---|---|
| `alcoveColor` | `setAlcoveColor` | changement visuel immédiat (état déjà en place) |
| `character` | `setCharacter` + `saveCharacterConfig` | identité/mot d'accueil à l'écran |
| LLM/TTS/ASR (modèles…) | maj des `initialConfig` + **bump `chatPanelKey`** | remontage du ChatPanel = **le flow d'onboarding existant** (« React 18 batches these updates ») |
| `vrm` (choix modèle) | lookup **IndexedDB** par `fileName` → `setModelUrl(blobUrl)` | effet `[modelUrl]` déjà géré |
| (futur) wake word | `wakeWordSettingsStore` partagée | idem |

- **Micro-extension** nécessaire : méthode `list()`/`loadByName()` dans `indexedDbVrmRepository` (aujourd'hui `load()` seul).
- ~~**Credentials** : le téléphone les envoie pour configurer~~ **[Corrigé par le contrat v1, §4.4]** : le Mobile ne pousse **pas** de credentials provider (payload sans champ `credential`) ; les secrets restent saisis *sur* le desktop. On ne les renvoie jamais sur le réseau (§6.3), `GET /api/provider-status` expose uniquement des statuts masqués.

### 4.3 Récepteur côté app

- L'écoute réseau : le serveur Next écoute sur `127.0.0.1` aujourd'hui → à binder sur la carte LAN (`0.0.0.0`/IP locale). Conséquence Windows : **pop-up pare-feu à accepter** au 1er run (réseau privé). Sur Linux : mêmes questions.
- **Port du service de provisioning (contrat v1, résolu)** : défaut **`8080`**, **paramètre de configuration** de l'Electron (pas du Mobile) — lier 80/443 exige des privilèges admin, inacceptable pour une app Desktop utilisateur ; le port effectif est annoncé dans la réponse de `GET /api/provisioning/health` (champ `port`) puis via mDNS (plus tard).

### 4.4 Contrat LAN Mobile ↔ Electron — **verrouillé v1, app mobile prête** (10/09/2026)

Source de vérité : `C:\dev\Liteforms-Mobile-Application\docs\contract\` (README + JSON d'exemples, repris verbatim ci-dessous). L'application mobile est **déjà implémentée et terminée** ; tout le travail restant est **côté Electron**.

**Contrainde produit** : l'appliance n'affiche **que** l'avatar — aucun code, QR, menu ou écran de configuration (ce qui invalide le vieux POC « IP + code à 6 chiffres affiché à l'écran »).

**Flux complet** :

```text
Electron démarre
  -> crée le hotspot Liteforms-Setup-XXXX
  -> écoute 192.168.4.1:8080

Mobile
  -> rejoint le hotspot via les réglages WiFi système
  -> GET  /api/provisioning/health
  -> POST /api/provisioning/wifi

Electron
  -> stocke le WiFi cible dans son stockage local sécurisé
  -> arrête le hotspot temporaire
  -> rejoint le WiFi cible

Mobile
  -> retrouve Electron sur le LAN (IP manuelle d'abord, mDNS ensuite)
  -> GET  /api/health
  -> POST /api/device-config
```

**Routes** (auth v1 = **aucune**, LAN local traité comme réseau de confiance) :

| Route | Méthode | Usage | Réponse |
|---|---|---|---|
| `/api/provisioning/health` | GET | vérifier le hotspot Liteforms | `{ok, mode:"provisioning", deviceId:"desktop-8f31", name:"Liteforms Desktop", protocolVersion:"1.0", port:8080}` — l'Electron **annonce son port effectif** ici |
| `/api/provisioning/wifi` | POST | envoyer SSID/mot de passe du WiFi cible | 202 `{ok:true, restartRequired:true, message:"WiFi configuration accepted"}` ; 400 `{ok:false, code:"INVALID_WIFI_CONFIG", message}` |
| `/api/health` | GET | vérifier Electron sur le réseau normal | `{ok, name, protocolVersion, configVersions:["1.0"], networkMode:"ethernet"\|"wifi"\|"provisioning"}` |
| `/api/device-config` | POST | envoyer la configuration ordinaire | 200 `{ok, configVersion, appliedAt, warnings:[]}` ; erreurs `{ok:false, code, message}` codes min `INVALID_FIELD`, `UNSUPPORTED_CONFIG_VERSION`, `MODEL_REF_UNKNOWN` |
| `/api/provider-status` | GET | lire des statuts **masqués** | `{ok, providers:{llm,tts,stt: {provider, configured, maskedKey}}}` — `maskedKey` jamais une clé réelle |

**Règles transverses** : requêtes idempotentes ; champs inconnus ignorés ; le mot de passe WiFi n'apparaît jamais dans réponses/logs/erreurs ; la route de provisioning n'est active **que** en mode hotspot puis fermée ; le mobile n'envoie pas de config Avatar tant que `/api/health` renvoie `networkMode:"provisioning"` ; sur iOS le mobile ne promet pas de connexion WiFi automatique.

**Règles credentials (contrat v1, section « Regles credentials » du README distant)** :

- **Le Mobile est l'ÉMETTEUR** de toutes les données vers le Desktop — config ordinaire (`device-config`) et credentials WiFi (`provisioning/wifi`, envoi **unique** sur le hotspot isolé). Le Desktop ne décide jamais de la config : il la **reçoit et l'applique**.
- `device-config` ne transporte **aucun secret** : ni clé provider, ni token de pairing, ni mot de passe WiFi.
- Le mécanisme de stockage des credentials WiFi (trousse OS, fichier chiffré…) est un **détail d'implémentation** de l'Electron ; l'exigence de contrat est : jamais dans les logs, les réponses des autres routes, ou un message d'erreur.
- Les **clés API providers vivent côté Electron**. Si un jour l'utilisateur les saisit depuis le Mobile (décision **D1**, phase 8), elles passent par une route **dédiée one-shot** `POST /api/credentials` — jamais via `device-config`.
- `/api/provider-status` ne contient que `configured` et `maskedKey` (`sk-****`) — jamais une clé réelle.

**Corps de `POST /api/device-config`** (exact, v1) :

```json
{
  "configVersion": "1.0",
  "character": { "name", "pronouns": "HE"|"SHE"|"THEY", "personality", "greeting" },
  "avatar": {
    "mood": "happy",
    "modelRef": { "id": "lobsterEdit", "fileName": "lobsterEdit.vrm", "hash": null },
    "pose":    { "avatarYaw": 0, "alcoveYaw": 0, "zoom": 1, "depth": 0 }
  },
  "environment": { "alcoveColor": "#4a90d9" },
  "providers": {
    "llm": { "provider", "model", "endpoint", "voiceId": null },
    "tts": { "provider", "model", "endpoint", "voiceId" },
    "stt": { "provider", "model", "endpoint", "voiceId": null }
  }
}
```

**Mapping vers l'existant (apply live, §4.2)** :

| Champ contrat | Côté Electron | Note |
|---|---|---|
| `character.*` | `setCharacter` + `saveCharacterConfig` | identique |
| `environment.alcoveColor` | `setAlcoveColor` | identique |
| `avatar.modelRef` | lookup IndexedDB par `fileName` (`list()`/`loadByName()` manquants, §8) | `hash` peut être `null` → le desktop ne doit pas l'exiger pour valider |
| `avatar.mood` | mood controller (port commit 9 §2.2, pas encore porté) | dépendance au port #9 |
| `avatar.pose` (avatarYaw/alcoveYaw/zoom/depth) | retunes alal/hips + viewport (ports 6/7) + `environmentLoader` | **nouveau champ sans équivalent storage actuel** |
| `providers.{llm,tts,stt}` | `SessionConfig` (`saveSessionConfig`) + remontage ChatPanel (`chatPanelKey`) | **`stt` ≈ `asr` côté Electron** (renommage au mapping) ; **pas de champ `credential`** dans le payload |

**Ce qui change vs le plan initial** (deltas à retenir) :

1. **Pas de token en v1** : ni sur `device-config` ni sur le provisioning. Le « token minimal » du POC (§5 Phase 2, §6.3) est reporté phase 4. Contrat assumé : LAN de confiance.
2. **Pas de credentials dans le payload** : le téléphone ne pousse *que* la config ordinatoire (`providers` sans clé API) — cohérent avec « secrets au desktop, jamais sur le téléphone ». L'ancienne ligne §4.2 « Credentials : le téléphone les envoie pour configurer » est **corrigée par ce contrat**.
3. **Provisioning hotspot dès le flux initial** (pas phase 3) : SSID `Liteforms-Setup-XXXX` (ex `JARVIS-XXXX`), service sur `192.168.4.1:8080`.
4. **Pas de QR ni de code affiché à l'écran** — l'appliance n'affiche rien.
5. `GET /api/provider-status` remplace `GET /api/device-config` (lecture) ; `configVersions:["1.0"]` présent dans `/api/health`.
6. Nouveaux blocs de config auparavant non identifiés dans le plan : `avatar.mood`, `avatar.pose`, `voiceId` par provider, `stt` (vs `asr`).
7. Router captive-portal : le contrat évite la page captive (réglages WiFi système depuis le mobile) — les sondes `/generate_204` sont donc **hors du chemin critique** (§6.6 reste valable comme robustesse).

**Priorités Electron** (ordre du contrat, à reporter dans §8) :

1. Créer le hotspot temporaire `Liteforms-Setup-XXXX` et écouter `192.168.4.1:8080` ;
2. `GET /api/provisioning/health` ;
3. `POST /api/provisioning/wifi` + transition vers le WiFi cible ;
4. Fermer le mode provisioning après configuration acceptée ;
5. `GET /api/health` sur le réseau normal ;
6. `POST /api/device-config` + `GET /api/provider-status`.

---

## 5. Feuille de route phasée (critères de sortie, difficulté, risques)

### Phase 0 — Portage web → Electron
**Objectif** : récupérer la valeur des 31 commits `Jarvis:` du web.
**Ordre suggéré** (du plus sûr au plus structurant) :
1. Logique pure / modules autonomes : 22 (strip markdown), 25 (TimerManager), 26, 28, 29 (function calling + parser), 6, 7 (retunes) ;
2. ChatPanel (20, 21, 3, 10, 27) ;
3. Providers/adapters (2, 19, 24 core) ;
4. Émotion (9) ;
5. **Wake word** (11→17) en dernier (gros bloc, plus d'incertitude).
**Vérif** : après chaque groupe — `npm test`, `npm run lint`, `npx tsc --noEmit`, build.
**Difficulté cumulée** : ~2/10 (logique pure) à 7/10 (wake word). **Faisabilité : 9/10.**

### Phase 1 — L'holo sur Linux (à tester en premier — risque **rétrogradé**)
**Objectif** : preuve que le Looking Glass rend correctement depuis un Mini-PC **Linux**.
**⚠ État 30/08/2026** : le chemin **officiel existe** (voir §6.1/§6.10). Le Bridge Looking Glass a une **version Linux 2.6.3** (installateur Ubuntu `.sh`), exige **X11** (Wayland non supporté). Plus le SDK natif était Win/Mac ; on dispose désormais de **bridge.js** (websocket, OS-indépendant, déjà embarqué dans l'app) et du **Bridge-Python-SDK officiel** (wheels manylinux x86-64/arm64 avec driver embarqué). Reste **3 validations** (week-end) :
1. Ubuntu **24.04 LTS X11** + build **AppImage/.deb sur Linux** (x86_64) ;
2. **Bridge 2.6.3** opérationnel + le **probe natif** échoue gracieusement → le path **websocket JS** prend le relais (`bridge.js`) ; vérifier compat version du `@lookingglass/bridge@0.0.8-alpha.4` embarqué ;
3. **Énumération du LKG en affichage DRM** via le port USB-C (DP alt mode) — la pièce hardware à vérifier.
**Fallback en secours** : HLD (compositor logiciel, déjà en place) → sinon Bridge-Python-SDK.
**Critère de sortie** : qualité d'image/sync acceptable sur l'appareil.
**Difficulté : 3–4/10 (configuration, plus un pari). Faisabilité : 9,5/10.**

### Phase 2 — POC config téléphone → live (⚠️ périmètre redéfini par le contrat mobile v1, §4.4)

> **STATUT : TERMINÉ ET VALIDÉ TERRAIN (12/09/2026)** — voir `POC.md` §13
> pour le bilan complet, les enseignements et la répartition
> gardé/rejetté en architecture finale. Résumé :
>
> * **Fait et validé** : `GET /api/health` (bind LAN opt-in
>   `LITEFORMS_SERVER_HOST`, port 43178), `POST /api/device-config`
>   (validation sans confiance, idempotence, secrets rejetés, warnings
>   mood/pose), apply renderer à chaud (character, alcove via
>   `environmentConfig` + propagation `/hologram`, providers via mapping
>   `stt->asr`/`endpoint->baseUrl` + bump `chatPanelKey`, VRM via
>   bibliothèque locale `<userData>/vrm-library/`), lecture Mobile de la
>   bibliothèque VRM réelle, swap VRM à chaud **sur le Looking Glass**
>   (avec fix teardown session XR — invariant à conserver, `POC.md` §13.2).
> * **Non fait (reporté, hors POC)** : provisioning hotspot (priorités 1–4
>   ci-dessous), mood/pose (warnings), mDNS.
> * **Choix de périmètre notables** : port renderer `43178` conservé
>   (invariant d'origine Chromium pour la persistance — `POC.md` §13.3.2) ;
>   `8080` reste le port de provisioning du contrat final, décision
>   d'intégration ultérieure.
> * **Suite naturelle (vers Phase 3)** : persistance durable
>   device-config dans `userData` (le park en mémoire était POC),
>   provisioning hotspot, détection automatique du token OpenClaw local
>   (`POC.md` §7.1).

**Objectif** : config maîtrisée depuis le téléphone, appliquée en direct.
**Livrables** (contrat v1 verrouillé — l'app mobile existe déjà, tout le reste est côté Electron) :
- provisioning **hotspot** (`Liteforms-Setup-XXXX`, `192.168.4.1:8080`, `POST /api/provisioning/wifi` + transition WiFi — cf. §4.4, priorités 1–4) ;
- route `POST /api/device-config` **sans token** (v1 LAN de confiance) ;
- `GET /api/health` + `GET /api/provider-status` (statuts masqués) ;
- watcher ou polling → événement IPC → `applyDeviceConfig()` ;
- app mobile : **déjà prête** (sélection WiFi via réglages système, IP manuelle puis mDNS).
**Critère de sortie** : provisioning WiFi via hotspot puis pousser `character`, `alcoveColor`, provider LLM/TTS/stt, `mood`/`pose`, un `modelRef` depuis le téléphone → appliqués **à chaud**.
**Difficulté côté Electron : 3–4/10. Faisabilité : 9–10/10.**
~~Preview 3D sur le téléphone~~ : hors périmètre du contrat v1 (aucune exigence de preview dans `docs/contract` ; le mobile livré s'appuie sur `modelRef` + statuts).

### Phase 3 — Le confort appliance
**Objectif** : l'expérience « on le branche, ça marche ».
**Livrables** :
- **autostart** Linux (`.desktop` → `~/.config/autostart`), mode provisioning sur 1er boot (machine à états `provisioned ?`) ;
- **provisioning hotspot** — **double cible (décision 13/09/2026 : Linux principal, Windows fonctionnel requis)** :
  - **Linux** : `nmcli device wifi hotspot` / `nmcli con up` → **helper privilégié (polkit ou service systemd + dialogue socket)** ;
  - **Windows** : Mobile Hotspot WinRT (`NetworkOperatorTetheringManager`, §6.2) + fallback **LAN direct sans hotspot** (PC déjà sur le WiFi maison → `device-config` direct) ;
  - interface commune derrière un même service de provisioning (détecter la plateforme, mêmes routes contrat v1).
- **mDNS** (`jarvis.local`, avahi/bonjour-service) ;
- **pairing complet** : génération `DEVICE_ID` + `PAIRING_SECRET`, stockage devices/phones/token dans `userData`, middleware de token ;
- **auto-update** (AppImage/.deb, sign).
**Difficulté : 5–6/10 (concentrée sur le helper privilégié + machine à états). Faisabilité : 9/10.**

### Phase 4 — Sécurité durcie
**Objectif** : fermer les failles du POC.
**Livrables** : TLS local (certificat auto-signé éphémère) ; **rotation de token** ; gestion propriétaire/devices (le téléphone qui provisionne est l'owner ; les autres doivent se re-pairer) ; **jamais de retour des credentials** sur le réseau ; rate-limiting ; nettoyage du secret après appairage.
**Difficulté : 3/10. Faisabilité : 9/10.**

---

## 6. Points de difficulté & risques (détaillés)

### 6.1 (Rétrogradé) Driver/affichage Looking Glass sous Linux — voir Phase 1
- **Élément clos à 30/08/2026** : le support Linux est **officiel** (voir §6.10). Looking Glass Bridge **2.6.3** sort en installateur Ubuntu ; le SDK natif (samples C++/C#) exige **X11, Wayland non supporté** ; la note vaut aussi pour les chemins JS et Python.
- Chemins disponibles sur Linux, du préféré au repli :
  1. **bridge.js** (websocket localhost) — l'app Electrons embarque déjà `@lookingglass/bridge` → **0 ligne à écrire**, à valider sur Linux (§6.10) ;
  2. **Bridge-Python-SDK** (`pip install bridge-python-sdk`) — wheels manylinux x86-64/arm64, **driver Bridge embarqué** (exemples `RotatingCube`, `SolarSystem`, `DisplayQuilt`, `DisplayRGBD`) ;
  3. **HLD** (compositor logiciel, déjà dans le code) — fallback pur.
- **Restent à valider** (semaine/week-end Phase 1) : distro Ubuntu éligible, énumération DRM du LKG en USB-C (DP alt mode), bascule du probe natif vers le websocket.

### 6.2 Privilèges Wi-Fi / NetworkManager
- `nmcli` (hotspot, rejoindre un réseau) = **root**.
- Archive propre : règle **polkit** mini PC ou **service systemd** launcher que l'app pilote. Si bricolé → cassure en prod.
- **Windows — solution fonctionnelle requise (décision 13/09/2026)** : la cible de production reste Linux, mais l'étape provisioning doit **aussi fonctionner sous Windows** (machine de dev + déploiements Windows éventuels). Deux chemins :
  1. **Hotspot Windows** : `netsh wlan hostednetwork` est **mort** (pilotes modernes ne le supportent plus). Le chemin moderne est le **Mobile Hotspot WinRT** (`Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager`, via projection PowerShell depuis l'Electron ou module natif) : SSID/passphrase configurables (`ConfigureAccessPointAsync`), activation/désactivation programmatiques. Sous-réseau ICS par défaut **`192.168.137.1/24`** (le contrat `192.168.4.1` est le cas Linux ; le client mobile prend l'hôte en **paramètre** — aucune rupture de contrat, l'Electron annonce/binder sur l'interface hotspot réelle). Requiert un adaptateur Wi-Fi compatible Wi-Fi Direct (la plupart des adaptateurs modernes).
  2. **Fallback LAN direct** : si le hotspot Windows échoue (adaptateur incompatible, politique machine), le provisioning Windows se fait **sans hotspot** — PC déjà connecté au WiFi maison, le téléphone rejoint le même LAN et envoie directement `POST /api/device-config` (flux déjà validé terrain au POC). Le hotspot reste la voie « premier boot sans écran » ; sous Windows dev, le LAN direct est la voie pragmatique.
  - Dans les deux cas : pop-up pare-feu à accepter (réseau privé), bind du serveur sur l'interface concernée.

### 6.3 Sécurité du POC (⚠️ écarté pour la v1 par le contrat mobile, §4.4)
- **Contrat v1 (10/09)** : **deux routes sans auth** (`/api/provisioning/wifi` côté hotspot isolé ; `/api/device-config` et `/api/provider-status` sur le LAN local de confiance). Le token d'appairage planifié ici devient **phase 4** (avec TLS local, rotation, owner/devices).
- **Invariants qui restent de mise** dès la v1 : mot de passe WiFi jamais dans réponses/logs/erreurs ; storage WiFi **sécurisé** (`safeStorage`) ; provisioning fermé après usage ; `maskedKey` jamais une clé réelle.
- **Credentials provider** (OpenClaw…) : acceptés une fois côté local, **jamais réémis** en clair sur le LAN.
- Bound du service au **LAN** (pas d'exposition WAN), port dédié.
- `fs.watch` sur `userData` OK (Windows) ; sinon polling 2 s.

### 6.4 Threading `onnxruntime-web` (wake word)
- En Electron, la page servie par le serveur Next local n'a **pas de cross-origin isolation** (COOP/COEP absents) → **`SharedArrayBuffer` indisponible** → les builds `*-threaded.wasm` d'onnxruntime **échouent**.
- **Solution recommandée** : utiliser le build **single-thread** (`ort-wasm-simd`) — inference 30–80 ms, sans impact perceptible pour un wake word. Évite d'ajouter COOP/COEP (qui restreint d'autres ressources locales).
- Alternative (plus de travail) : ajouter COOP/COEP sur le serveur Next local et garder le threaded.

### 6.5 Micro du wake word
- `getUserMedia` fonctionne en Electron **sans popup** la plupart du temps (page de confiance).
- Deux points à tester sous Windows : **conflit d'exclusivité micro** avec d'autres applis ; et **deux flux simultanés** (wake word + voix live) → **partager le même `MediaStream`** via `lib/speech/microphone.ts` existant (ne pas ouvrir un second flux).
- Le **TTS de réponse repart via le relais holo déjà en place** (fenêtre principale → `postMessage` → `/hologram` joue + lip-sync RMS pendant que la fenêtre principale est minimisée en tray). **Zéro friction** : le wake word appelle le même chemin `handleTtsForHologram`. Le **chime** de confirmation, lui, peut jouer dans la fenêtre principale.

### 6.6 Captive portal / mDNS / isolation des routeurs
- iOS/Android ouvrent la page « captive » en se connectant au hotspot → il faut répondre `200` aux sondes (`/generate_204`, `captive.apple.com`, etc.) ou **URL manuelle** en fallback.
- Certains routeurs font de l'**isolation client** → garder le **QR avec l'IP** + « saisir l'IP à la main » en second plan.
- mDNS parfois capricieux → `jarvis.local` + IP en fallback.

### 6.7 Recovery (appliance sans écran)
- Téléphone perdu/cassé → il faut un chemin de réassociation : ex. **maintenir le bouton × 10 s → mode provisioning**, ou accès direct sur l'écran principal (le LKG affiche la config ?) au premier setup.
- Prévoir un **état de réinitialisation** propre (remise à zéro pairing + retour du hotspot).

### 6.8 Chaîne de build/sign/update Linux
- Build **obligatoirement sur Linux** (AppImage/.deb, x86_64).
- Signature (optionnel au POC, à planifier) + **auto-update** (compatible electron-builder target `AppImage` → `update-server` ou repo GitHub Releases).

### 6.9 Mobile : stack choisie + preview 3D (décision 30/08/2026)
- **Choix techno : React Native (Expo, managed workflow)** — **pas Flutter**. Raison décisive : le pipeline avatar (~5 000 lignes testées de three.js/VRM dans `lib/avatar/`) s'exécute **tel quel** via `expo-gl` ; Flutter imposerait une réécriture totale du pipeline 3D en Dart. Toute la pile produit reste en **TS/React** (web + Electron + mobile partagent `lib/avatar/`, `lib/storage/`, zustand).
- **Builds** : **Android** via `eas build -p android` → **APK** (direct) et **AAB** (Play Store) ; **iOS** → **IPA** via **EAS Build cloud (sans Mac)**, distribution App Store/TestFlight avec compte Apple (99 $/an). Développement de l'app sur device via **Expo Go** (zéro build).
- **Ce qu'on porte** (config UI, ~4/10) : panneau « Character » de `ChatPanel.tsx` (nom, pronoms, personnalité), humeur (`MOOD_OPTIONS`), couleur alcove (`HEX_COLOR_PATTERN`), choix VRM (document-picker + upload binaire), + **nouveau picker d'animation** (la liste existe déjà dans `animationOptions.ts`, pas d'UI web). Les validateurs de `lib/storage/*` sont du TS pur → reproduits tels quels.
- **Preview 3D (difficulté ~6/10, faisabilité 8/10 — c'est le « waou » démo)** : port du **noyau** d'`AvatarScene.tsx` (scène, lumières, `GLTFLoader` + VRM + choration, `environmentLoader` pour l'alcove en direct, mood, animations) sur **`expo-gl` + three** ; on **jette** la partie exécutive LKG (webxr polyfill, `VRButton`, `hologramWindow`, HLD shadow compositor, événements fenêtre) et on la remplace par « preview perspective » + drag rotation (`PanResponder` + `modelDragRotation`). Assets servis par l'Electron sur le LAN (`fetch`). Plan de repli si MToon/WebGL2 foire : **snapshot live** renderé par l'Electron renvoyé en image.
- **Attention build native** : permissions **LAN** — iOS `NSLocalNetworkUsageDescription` (« app would like to find and connect to devices… »), Android `NEARBY_WIFI_DEVICES`/mDNS ; caler le color picker (pas de `<input type="color">` natif RN) et `react-native-document-picker` pour le `.vrm` tôt.
- **Périmètre exclu du mobile** : `ChatPanel` exécutif (streaming/micro/wake word — reste dans l'Electron), `OnboardingModal` providers/credentials (**secrets au desktop, jamais sur le téléphone**), tous les modules `lib/speech`, `lib/llm`.
- **Note** : pas besoin de porter les 31 commits web pour le POC mobile — juste le contrat d'API §4 + les setters déjà existants côté Electron.

### 6.10 Chemins officiels bridge (vérifiés 30/08/2026)
- **Looking Glass Bridge (runtime) — Linux ✓** : téléchargeable page officielle (bouton « Linux Download » → `https://look.glass/bridge-linux`) ; v2.6.3 en `LookingGlassBridge-2.6.3-Ubuntu.sh` (installer : `chmod +x` ; `./`.sh) ; doc « Looking Glass Bridge … is available for Windows, MacOS (M1/Intel) and **Linux-based systems** » + page dédiée « Display Settings on Linux ». **Contrainte : X11 requis, Wayland non supporté** (confirmé aussi par le README du SDK natif).
- **bridge-sdk-samples** (`github.com/Looking-Glass/bridge-sdk-samples`) : SDK **natif** (C++/C#), headers dans `BridgeRuntime/`, samples CMake/GLFW ; requis pour le « bridge natif » Win/Mac ; même note X11/Wayland. Le Bridge installé fournit les libs requises.
- **bridge.js** (`github.com/Looking-Glass/bridge.js` → npm `@looking-glass/bridge`, MIT) : client **JS via websocket localhost** vers Bridge 2.2+. **OS-indépendant**. C'est **le `@looking-glass/bridge` déjà embarqué** dans l'app Electron (`^0.0.8-alpha.4`) → valider la compat avec Bridge 2.6.3, éventuellement bump vers la version officielle stable.
- **Bridge-Python-SDK** (`github.com/Looking-Glass/Bridge-Python-SDK`, MIT) : `pip install bridge-python-sdk` ; **wheels Windows (x86-64), macOS (universal2), manylinux (x86-64/arm64)** ; **le driver Bridge est embarqué dans le wheel** → `pip install` + OpenGL + quilt + X11. Exemples inclus ; bémol documenté : sample *video* « not at full speed » (sans impact pour la scène 3D temps-réel). = le **fallback Python officiel** (plus besoin de bridge Python artisanal).
- **Looking Glass Go (USB-C unique)** : conforme au design « que le LKG en USB-C 3.2 » — le câble transporte power + video ; à confirmer comme affichage DRM sous Linux (Phase 1).

### 6.11 Fabrication des unités (image dorée + provisioning)
- **Schéma de production** : **image dorée pour l'usine + script versionné pour la fabriquer**, et **provisioning par unité pour l'individualisation**.
  1. Valider le pipeline UNE fois (avec un écran) : install OS + drivers + Xorg + Bridge 2.6.3 + app Electron + services ;
  2. Générer l'**image dorée** (Clonezilla/rescuezilla) depuis l'unité de référence ;
  3. Chaque unité : **flash image → boot → provisioning (hotspot + téléphone)** fournit Wi-Fi + appairage + `device_id` → **plus jamais d'écran** ;
  4. SSH couvre le dépannage.
- **Pièges** : **jamais cuire le Wi-Fi perso, les tokens ou les secrets dans l'image** (tout est fourni au premier boot par unité) ; l'image suppose un **hardware identique** (changer de mini-PC → régénérer) → d'où le script versionné conservé.
- **Reco Linux : Ubuntu 24.04 LTS, session X11** (pas Wayland : tray/appindicator + fenêtres plein écran fiables), **GPU Intel/AMD intégré** (éviter NVIDIA), NetworkManager (nmcli) + avahi par défaut. Version **appliance minimale** pour l'image : Ubuntu Server + `xorg openbox tint2 xinit dbus` (tint2 héberge le tray où l'app se cache). Tester d'abord en Ubuntu Desktop (GNOME, X11) pour le debug, puis slimmer l'image dorée. **Vigilance hardware** : le port USB-C du mini-PC doit supporter **DisplayPort Alt Mode**, sinon aucune image possible.

---

## 7. Mémento technique (à garder sous la main)

- **Standalone** : `afterPack` copie `.next/standalone` → `resources/next/standalone` ; `resolveStandaloneDir({appPath, resourcesPath})` retourne `resources/next/standalone` si `appPath` absent.
- **userData** : `%APPDATA%\liteforms-web` (localStorage/IndexedDB par origine).
- **Relais holo** : `postMessage` avec origine `hologramMessageOrigin` ; protocole dans `lib/avatar/hologramMessageProtocol.ts` ; frames RMS via `lipSyncEvents.ts`/`createRmsLipSyncFrame`.
- **Cross-window config** : événement `storage` (même origine) — utilisé pour l'alcove ; `saveEnvironmentConfig` → l'événement `storage` déclenche dans `/hologram`.
- **Bridge natif** : `electron/nativeBridge.ts` spawn `nativeBridgeProbe.js` (JSON sur fd 3) ; calibration par `applyNativeLookingGlassBridgeCalibration`. Pattern réutilisable pour un probe Python sous Linux.
- **Bridge Linux (official)** : looking-glass-bridge 2.6.3 `.sh` (X11) → `https://look.glass/bridge-linux` ; chemin JS via websocket localhost (`@looking-glass/bridge`, 0 ligne à écrire) ; fallback `pip install bridge-python-sdk` (wheels manylinux).
- **Mobile** : `eas build -p android` → APK/AAB ; `-p ios` → IPA via EAS cloud (compte Apple pour disctribution/TestFlight) ; preview 3D = `expo-gl` + three + noyau `lib/avatar` ; assets servis par l'Electron sur le LAN.
- **Nommage commits** : `Jarvis: <sujet anglais descriptif>`.
- **Règles** : **jamais de push** sans accord ; ne rien supprimer ; demander en cas de doute ; commit seulement sur demande explicite (miroir).
- **Tests de non-régression** : `npm test`, `npm run lint`, `npx tsc --noEmit` (ignorer les erreurs pré-existantes listées §1.3), puis `npm run build:electron:main` / `npm run dist:electron`.

---

## 8. Backlog des prochaines actions concrètes

**Portage (workspace `C:\dev\liteforms-electron`)**
- [ ] Portendre 22 (strip markdown) + 25/26/28/29 (parser + timers + function calling), groupe « logique pure ».
- [ ] Port `6`/`7` (retunes Alacove/hips) dans la scène Electron + `/hologram`.
- [ ] Port `19`/`20` (conversation ids OpenClaw) puis `2`.
- [ ] Port `9` (emotion : `moodConfig` + controller + UI).
- [ ] Port du wake word `11`→`17` (bundles + UI + cue + config), build **single-thread** ort (§6.4), partage du `MediaStream` micro (§6.5).
- [ ] À chaque groupe : tests + lint + tsc + build.

**Appliance / POC config**
- [ ] **Prioritaire** : week-end Phase 1 — Bridge 2.6.3 sur Ubuntu 24.04 X11, bascule du probe natif → websocket JS, énumération DRM du LKG Go en USB-C, build AppImage/.deb sur Linux.

**Contrat mobile v1 (app mobile prête, §4.4, ordre du contrat)**
- [x] Hotspot temporaire `Liteforms-Setup-XXXX` + service provisioning sur `192.168.4.1:8080` (port = paramètre de config Electron, défaut 8080, annoncé dans `provisioning/health` — §4.3). **FAIT (13/09/2026)** : `electron/wifi/` — hotspot WinRT Windows validé terrain (gateway `192.168.137.1`), Linux nmcli implémenté (helper privilégié §6.2 restant à valider terrain), fallback LAN-direct automatique.
- [x] **Variante Windows du provisioning (fonctionnelle, §6.2)** : hotspot WinRT (`192.168.137.1`) ou fallback LAN direct — mêmes routes contrat v1. **FAIT + validé terrain 13/09/2026** (start/stop/join échec propre ; pattern AsTask obligatoire, voir §13).
- [x] `GET /api/provisioning/health`. **FAIT (13/09/2026)** — serveur dédié main process, actif uniquement en mode provisioning.
- [x] `POST /api/provisioning/wifi` + stockage WiFi sécurisé (`safeStorage`) + transition vers le WiFi cible (Linux `nmcli` / Windows profil WLAN) + fermeture du mode provisioning. **FAIT (13/09/2026)** — persistance AVANT arrêt hotspot ; relance auto après acceptation ; join Windows à retester avec réseau réel (netsh wlan connect exige l'autorisation de localisation Win11).
- [x] `GET /api/health` (réseau normal, `networkMode`, `configVersions`). **FAIT (13/09/2026)** — `networkMode` via `LITEFORMS_NETWORK_MODE` décidé par la machine à états.
- [ ] API `POST /api/device-config` (v1 sans token, idempotent, champs inconnus ignorés) + `GET /api/provider-status` (statuts masqués).
- [ ] `indexedDbVrmRepository` : `list()`/`loadByName()` (le payload n'a que `fileName`/`id`, `hash` nullable).
- [ ] `applyDeviceConfig()` (réutilise setters + remontage ChatPanel) + événement live (polling d'abord).
- [ ] Port commit 9 (mood) et ports 6/7 (pose) nécessaires au champ `avatar.*` (mapping §4.4).
- [ ] Serveur Next en écoute LAN + gestion pare-feu (test Windows puis Linux).

**App mobile (Expo/React Native — ✅ PRÊTE, contrat `docs/contract` verrouillé, rien à faire côté mobile)** ce bloc devient un rappel de l'existant :
- ✔️ Écrans config + provisioning (réglages WiFi système, iOS = instruction + ouverture réglages).
- ✔️ Découverte : IP manuelle d'abord, mDNS ensuite.
- ✍️ à arbitrer plus tard (hors contrat v1) : preview 3D (`expo-gl` + noyau `lib/avatar` — la question MToon/WebGL2 de §6.9 reste vraie si un jour on la veut).

**Kiosque Linux (plus tard)**
- [ ] Build AppImage/.deb sur Linux, autostart, mDNS, provisioning hotspot (nmcli + polkit), pairing complet, auto-update (Phases 3–4).
- [ ] Fabrication : image dorée + script versionné + provisioning par unité (jamais de secrets/Wi-Fi dans l'image, §6.11).

---

## 9. Synthèse des chiffres

| Élément | Difficulté | Faisabilité |
|---|---|---|
| Portage global web→Electron | cumulée 2→7 selon les blocs | 9/10 |
| API config téléphone (POC) | 3–4/10 | 9–10/10 |
| Live apply (sans reboot) | 2/10 | 10/10 (settlers existants) |
| Provisioning hotspot + pairing | 5–6/10 | 9/10 |
| **Holo sur Linux (chemin officiel — §6.1/§6.10)** | **3–4/10** | **9,5/10** |
| **Mobile config UI (Expo)** | **4/10** | 9–10/10 |
| **Mobile preview 3D (expo-gl)** | **6/10** | **8/10** |
| Sécurité durcie (phase 4) | 3/10 | 9/10 |
| App mobile (hors Electron) | projet séparé | 2–3 semaines d'agent |

**Risques actualisés (30/08/2026)** : le driver LKG sous Linux n'est **plus** un pari (chemin officiel) — reste l'**énumération USB-C du LKG** et la meta de l'**image dorée**/hardware. Risque n°2 conservé : robustesse privilèges Wi-Fi. **Piège de portée** : 3 projets imbriqués → POC strict = Phase 1 + Phase 2.

---

## 10. Post-mortem provisioning WiFi contrat v1 (13/09/2026)

* **Fait/validé** : routes provisioning (`electron/wifi/provisioningServer.ts`, main process, port configurable, actives UNIQUEMENT en mode provisioning), machine à états (`provisioningService.ts`, persistance AVANT arrêt hotspot, idempotente), stockage `safeStorage` (`wifiCredentialsStore.ts`), `networkMode` dans `/api/health`. Tests : 766 verts, lint 0 erreur, tsc OK.
* **Validé terrain Windows** : hotspot WinRT réel start→stop (SSID `Liteforms-Setup-XXXX`, gateway ICS `192.168.137.1`), via le code compilé (`scripts/provisioning-live-check.cjs`).
* **Pièges découverts** : (1) WinRT `IAsyncOperation` = `__ComObject` en PS 5.1, `.GetAwaiter()` n'existe PAS — passer par la projection `AsTask` de `System.Runtime.WindowsRuntime` (backtick dans single quotes) ; (2) le XML de profil WLAN exige `<connectionType>ESS</connectionType>` (sinon erreur schéma 0x80001 — l'ordre des éléments est forcé) ; (3) `netsh wlan connect` exige l'autorisation de localisation Windows 11 (sinon erreur 5) — la reconnexion WiFi réelle reste à tester avec un réseau présent ; (4) fichier partagé main/Next : la source canonique doit vivre sous `electron/` (contrainte `rootDir`), `lib/` ne fait que réexporter.
* **Reste** : valider le join WiFi Windows sur un réseau réel + la transition complète Mobile→hotspot→WiFi maison ; helper privilégié Linux (polkit) avant le déploiement appliance ; détection Ethernet (actuellement `wifi` par défaut après provisioning).